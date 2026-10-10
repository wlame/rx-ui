/**
 * Selecting lines in the editor with the mouse and the keys.
 *
 * The controller hears a Monaco editor and turns what the user does into
 * a selection of whole file lines (`utils/lineSelection.ts`), which it
 * hands to its host; the host keeps it in the tab and the editor draws it
 * as decorations.
 *
 * | Gesture                              | Effect                                  |
 * | ------------------------------------ | --------------------------------------- |
 * | click a line number                  | replace with that line                  |
 * | Shift+click a line number            | extend the last range to that line      |
 * | Cmd/Ctrl+click a line number         | add that line; on a selected line, take it out |
 * | drag in the text or the line numbers | replace with the lines touched          |
 * | Cmd/Ctrl+drag                        | add the lines touched                   |
 * | Shift+↑/↓ and the editor's other selection keys | extend with the lines selected |
 * | Esc                                  | clear, when anything is selected        |
 * | Cmd/Ctrl+C with no text selected     | copy the selected lines (`host.copy`)   |
 *
 * The line numbers belong to the controller: Monaco does not select on
 * them (`selectOnLineNumbers` is off), so it neither selects nor scrolls
 * there. A gesture there takes its lines from the pointer: the line
 * pressed, the lines it moves over and the line released on; a press and
 * release at one place is a click on the line pressed, even when the view
 * moved under the pointer between them. The text belongs to Monaco: a
 * drag there is Monaco's selection, read as the whole lines it touches,
 * and it stays, so Cmd/Ctrl+C copies the text as in any editor.
 *
 * Monaco's selection never shows a line that is not selected. After a
 * gesture on the line numbers, on Esc, and when the tab's selection
 * changes elsewhere (the header's ×, a link), the controller collapses
 * Monaco's selection to a cursor: after a gesture, at the start of the
 * line after it, where the selection keys go on from. Those keys extend:
 * a run of them keeps the tab's selection from the run's first key and
 * adds the lines Monaco's selection covers. A selection change Monaco
 * makes itself (a page load, the API, its own Esc) is never committed.
 *
 * The modifiers are read at mouse down. A gesture is committed once, on
 * mouse up (or on the window's mouse up, for a release outside the
 * editor), and a key's selection on key up. A click in the text that only
 * places the cursor changes nothing.
 *
 * The controller uses Monaco's types only: the mouse target kinds are
 * spelled out as numbers, so it runs in tests without Monaco.
 */
import type * as Monaco from 'monaco-editor';
import {
  addRange,
  extendLast,
  fromMonacoSelections,
  normalize,
  removeLine,
  type LineRange,
  type MonacoSelectionLike,
} from '$lib/utils/lineSelection';
import { acceptsTyping } from '$lib/utils/keyTargets';
import { isShortcut } from '$lib/utils/shortcuts';

/** What the controller reads and sets: the tab's selection and the window it shows. */
export interface SelectionHost {
  /** The file line on the editor's line 1. */
  windowStart(): number;
  /** The tab's selection now. */
  selection(): readonly LineRange[];
  /** Make `ranges` the tab's selection. */
  select(ranges: LineRange[]): void;
  /** Copy the tab's selection as the header's Copy does; false when the tab cannot. */
  copy(): boolean;
}

/** The parts of a Monaco editor the controller hears and reads. */
export type SelectionEditor = Pick<
  Monaco.editor.ICodeEditor,
  | 'onMouseDown'
  | 'onMouseMove'
  | 'onMouseUp'
  | 'onDidChangeCursorSelection'
  | 'onKeyUp'
  | 'getSelections'
  | 'setSelection'
  | 'getPosition'
  | 'getDomNode'
  | 'focus'
>;

/** What the pane holds of a controller. */
export interface SelectionController {
  /**
   * Hear the tab's selection as the store holds it. A selection the
   * controller did not set (the header's ×, a link, Back) collapses
   * Monaco's selection, which may show other lines.
   */
  followSelection(ranges: readonly LineRange[]): void;
  /** Stop hearing the editor, its keys and the window. */
  dispose(): void;
}

/**
 * Monaco's MouseTargetType values where a press selects lines: the
 * glyph margin, the line numbers and the line decorations (the gutter),
 * and the text and the empty space after it.
 */
const GUTTER_TARGETS: ReadonlySet<number> = new Set([2, 3, 4]);
const TEXT_TARGETS: ReadonlySet<number> = new Set([6, 7]);

/** How far the pointer may move between press and release for a click, in CSS pixels. */
const CLICK_SLOP_PX = 3;

/** A mouse gesture between its press and its release. */
interface Gesture {
  isGutter: boolean;
  /** Cmd or Ctrl was down at the press: the gesture adds. */
  isAdding: boolean;
  /** Shift was down at the press: a gesture in the gutter extends. */
  isExtending: boolean;
  /** The file line pressed on. */
  line: number;
  /** The last file line the pointer was over, for a release outside the editor. */
  lastLine: number;
  /** Where the press was on the page, to tell a click from a drag. */
  x: number;
  y: number;
  /** The tab's selection at the press. */
  base: readonly LineRange[];
  /** Monaco's selections just after the press; an adding gesture takes only the new ones. */
  before: readonly MonacoSelectionLike[];
}

/** Where a gesture was released: the editor line and the place on the page, or null outside the editor. */
type Release = { line: number | null; x: number; y: number } | null;

function isSameMonacoSelection(a: MonacoSelectionLike, b: MonacoSelectionLike): boolean {
  return (
    a.startLineNumber === b.startLineNumber &&
    a.startColumn === b.startColumn &&
    a.endLineNumber === b.endLineNumber &&
    a.endColumn === b.endColumn
  );
}

function isEmptyMonacoSelection(selection: MonacoSelectionLike): boolean {
  return (
    selection.startLineNumber === selection.endLineNumber &&
    selection.startColumn === selection.endColumn
  );
}

function isSameRanges(a: readonly LineRange[], b: readonly LineRange[]): boolean {
  return a.length === b.length && a.every((r, i) => r.start === b[i].start && r.end === b[i].end);
}

/** The selections of `after` that `before` does not hold. */
function newSelections(
  before: readonly MonacoSelectionLike[],
  after: readonly MonacoSelectionLike[],
): MonacoSelectionLike[] {
  return after.filter(
    (selection) => !before.some((held) => isSameMonacoSelection(held, selection)),
  );
}

/** The selection a gesture on the line numbers ends with, released on file line `upLine`. */
function gutterResult(gesture: Gesture, upLine: number): LineRange[] {
  if (gesture.isExtending) return extendLast(gesture.base, upLine);
  const span = { start: Math.min(gesture.line, upLine), end: Math.max(gesture.line, upLine) };
  if (!gesture.isAdding) return [span];
  if (span.start !== span.end) return addRange(gesture.base, span);
  const isSelected = gesture.base.some((r) => r.start <= gesture.line && gesture.line <= r.end);
  return isSelected ? removeLine(gesture.base, gesture.line) : addRange(gesture.base, span);
}

/**
 * Hear `editor` and keep `host`'s selection as the user makes it.
 * Returns what the pane tells it and what stops hearing.
 */
export function attachSelectionController(
  editor: SelectionEditor,
  host: SelectionHost,
): SelectionController {
  let gesture: Gesture | null = null;
  /** The tab's selection when the current run of selection keys began; null outside a run. */
  let keyRunBase: readonly LineRange[] | null = null;
  /** A key changed Monaco's selection since the last key up. */
  let hasKeyboardSelection = false;
  /** The last key pressed was Esc: Monaco's selection changes on it are its own, not the user's. */
  let isAfterEscape = false;
  /** The selection the controller last set, which the store hands back as its own copy. */
  let committed: readonly LineRange[] | null = null;
  /** The selection `followSelection` last heard. */
  let followed: readonly LineRange[] | null = null;

  const monacoSelections = (): readonly MonacoSelectionLike[] => editor.getSelections() ?? [];
  const fileLine = (editorLine: number) => host.windowStart() + editorLine - 1;

  function select(ranges: LineRange[]) {
    committed = ranges;
    host.select(ranges);
  }

  function endKeyRun() {
    keyRunBase = null;
    hasKeyboardSelection = false;
  }

  /** Leave Monaco an empty selection at `column` of editor line `editorLine`; Monaco clamps it to its text. */
  function collapseAt(editorLine: number, column = 1) {
    editor.setSelection({
      startLineNumber: editorLine,
      startColumn: column,
      endLineNumber: editorLine,
      endColumn: column,
    });
  }

  /** Collapse Monaco's selections to its cursor, when they select anything. */
  function collapseToCursor() {
    const selections = monacoSelections();
    if (selections.length <= 1 && selections.every(isEmptyMonacoSelection)) return;
    const cursor = editor.getPosition();
    if (cursor) collapseAt(cursor.lineNumber, cursor.column);
  }

  function startGesture(e: Monaco.editor.IEditorMouseEvent) {
    gesture = null;
    endKeyRun();
    const position = e.target.position;
    const isGutter = GUTTER_TARGETS.has(e.target.type);
    if (!e.event.leftButton || !position || !(isGutter || TEXT_TARGETS.has(e.target.type))) return;
    const line = fileLine(position.lineNumber);
    gesture = {
      isGutter,
      isAdding: e.event.metaKey || e.event.ctrlKey,
      isExtending: e.event.shiftKey,
      line,
      lastLine: line,
      x: e.event.posx,
      y: e.event.posy,
      base: host.selection(),
      before: monacoSelections(),
    };
    // Monaco does not take the focus for a press in the gutter; the keys
    // (Esc, Shift+↓, Cmd/Ctrl+C) work in the editor after one.
    if (isGutter) editor.focus();
  }

  /** Follow the pointer over the lines during a gesture on the line numbers. */
  function followPointer(e: Monaco.editor.IEditorMouseEvent) {
    const position = e.target.position;
    if (gesture?.isGutter && position) gesture.lastLine = fileLine(position.lineNumber);
  }

  /** Commit a gesture on the line numbers and leave Monaco a cursor on the line after it. */
  function commitGutterGesture(done: Gesture, release: Release) {
    const isClick =
      release !== null &&
      Math.abs(release.x - done.x) <= CLICK_SLOP_PX &&
      Math.abs(release.y - done.y) <= CLICK_SLOP_PX;
    const releasedLine = release?.line == null ? done.lastLine : fileLine(release.line);
    const upLine = isClick ? done.line : releasedLine;
    select(gutterResult(done, upLine));
    collapseAt(Math.max(done.line, upLine) - host.windowStart() + 2);
  }

  /** Commit the gesture in progress; Monaco's selection stays after a drag in the text. */
  function commitGesture(release: Release) {
    const done = gesture;
    gesture = null;
    if (!done) return;
    if (done.isGutter) {
      commitGutterGesture(done, release);
      return;
    }
    const selections = done.isAdding
      ? newSelections(done.before, monacoSelections())
      : monacoSelections();
    const touched = fromMonacoSelections(selections, host.windowStart());
    if (touched.length === 0) return;
    select(done.isAdding ? normalize([...done.base, ...touched]) : touched);
  }

  /** A selection change: one a selection key made starts or goes on with a run of them. */
  function noteSelectionChange(e: Monaco.editor.ICursorSelectionChangedEvent) {
    if (e.source !== 'keyboard' || isAfterEscape) {
      endKeyRun();
      return;
    }
    keyRunBase ??= host.selection();
    hasKeyboardSelection = true;
  }

  /**
   * On key up, the run's first selection with the lines Monaco's
   * selection covers. A key that leaves only a cursor ends the run and
   * changes nothing.
   */
  function commitKeyboardSelection() {
    if (!hasKeyboardSelection || keyRunBase === null) return;
    hasKeyboardSelection = false;
    const touched = fromMonacoSelections(monacoSelections(), host.windowStart());
    if (touched.length === 0) {
      keyRunBase = null;
      return;
    }
    select(normalize([...keyRunBase, ...touched]));
  }

  /**
   * Esc in the editor's text clears a selection and collapses Monaco's;
   * with nothing selected, or in a field that takes typing (the find
   * widget's box), the key is left alone. Either way Monaco's own response
   * to Esc, which collapses its selections, is not committed.
   */
  function handleEscape(e: KeyboardEvent) {
    endKeyRun();
    if (acceptsTyping(e.target as HTMLElement) || host.selection().length === 0) return;
    e.preventDefault();
    select([]);
    collapseToCursor();
  }

  /**
   * Cmd/Ctrl+C with no text selected in Monaco copies the tab's selected
   * lines, and the key is cancelled only then. With text selected, Monaco
   * copies it; in the find widget's box the box does.
   */
  function handleCopy(e: KeyboardEvent) {
    if (acceptsTyping(e.target as HTMLElement) || host.selection().length === 0) return;
    if (!monacoSelections().every(isEmptyMonacoSelection)) return;
    if (host.copy()) e.preventDefault();
  }

  function handleKeyDown(e: KeyboardEvent) {
    isAfterEscape = isShortcut('clearSelection', e);
    if (isAfterEscape) handleEscape(e);
    else if (isShortcut('copySelection', e)) handleCopy(e);
  }

  function releaseOf(e: Monaco.editor.IEditorMouseEvent): Release {
    return { line: e.target.position?.lineNumber ?? null, x: e.event.posx, y: e.event.posy };
  }

  const onWindowMouseUp = () => commitGesture(null);
  const domNode = editor.getDomNode();
  const view = domNode?.ownerDocument.defaultView ?? null;
  const subscriptions = [
    editor.onMouseDown(startGesture),
    editor.onMouseMove(followPointer),
    editor.onMouseUp((e) => commitGesture(releaseOf(e))),
    editor.onDidChangeCursorSelection(noteSelectionChange),
    editor.onKeyUp(commitKeyboardSelection),
  ];
  // Capture: every key reaches the controller before Monaco handles it.
  domNode?.addEventListener('keydown', handleKeyDown, true);
  view?.addEventListener('mouseup', onWindowMouseUp);

  return {
    followSelection(ranges) {
      if (ranges === followed) return;
      followed = ranges;
      if (committed !== null && isSameRanges(ranges, committed)) return;
      committed = null;
      collapseToCursor();
    },
    dispose() {
      for (const subscription of subscriptions) subscription.dispose();
      domNode?.removeEventListener('keydown', handleKeyDown, true);
      view?.removeEventListener('mouseup', onWindowMouseUp);
      gesture = null;
    },
  };
}
