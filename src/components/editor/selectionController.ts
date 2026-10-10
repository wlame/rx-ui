/**
 * Selecting lines in the editor with the mouse and the keys.
 *
 * The controller hears a Monaco editor and turns what the user does into
 * a selection of whole file lines (`utils/lineSelection.ts`), which it
 * hands to its host; the host keeps it in the tab and the editor draws it
 * as decorations. Monaco's own selection is read while a gesture runs
 * and collapsed to a cursor once the gesture is committed (below).
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
 *
 * The modifiers are read at mouse down, so a gesture keeps its meaning
 * after paging, which clears Monaco's selections. A gesture is committed
 * once, on mouse up (or on the window's mouse up, for a release outside
 * the editor), and a key's selection on key up. A click that only places
 * the cursor changes nothing.
 *
 * Monaco's own selection is the gesture's working copy only. Once a
 * gesture is committed it is collapsed to a cursor at the start of the
 * line after the gesture, so only the selection's decorations show what
 * is selected, and a line taken out is not painted or brought back by
 * the next key. The selection keys then extend from that cursor: a run
 * of them keeps the tab's selection from the run's first key and adds
 * the lines Monaco's selection covers. A selection change Monaco makes
 * itself (a page load, the API, its own Esc) is never committed.
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
}

/** The parts of a Monaco editor the controller hears and reads. */
export type SelectionEditor = Pick<
  Monaco.editor.ICodeEditor,
  | 'onMouseDown'
  | 'onMouseUp'
  | 'onDidChangeCursorSelection'
  | 'onKeyUp'
  | 'getSelections'
  | 'setSelection'
  | 'getPosition'
  | 'getDomNode'
>;

/**
 * Monaco's MouseTargetType values where a press selects lines: the
 * glyph margin, the line numbers and the line decorations (the gutter),
 * and the text and the empty space after it.
 */
const GUTTER_TARGETS: ReadonlySet<number> = new Set([2, 3, 4]);
const TEXT_TARGETS: ReadonlySet<number> = new Set([6, 7]);

/** A mouse gesture between its press and its release. */
interface Gesture {
  isGutter: boolean;
  /** Cmd or Ctrl was down at the press: the gesture adds. */
  isAdding: boolean;
  /** Shift was down at the press: a gesture in the gutter extends. */
  isExtending: boolean;
  /** The file line pressed on. */
  line: number;
  /** The tab's selection at the press. */
  base: readonly LineRange[];
  /** Monaco's selections just after the press; an adding gesture takes only the new ones. */
  before: readonly MonacoSelectionLike[];
}

function isSameSelection(a: MonacoSelectionLike, b: MonacoSelectionLike): boolean {
  return (
    a.startLineNumber === b.startLineNumber &&
    a.startColumn === b.startColumn &&
    a.endLineNumber === b.endLineNumber &&
    a.endColumn === b.endColumn
  );
}

/** The selections of `after` that `before` does not hold. */
function newSelections(
  before: readonly MonacoSelectionLike[],
  after: readonly MonacoSelectionLike[],
): MonacoSelectionLike[] {
  return after.filter((selection) => !before.some((held) => isSameSelection(held, selection)));
}

/** The selection a gesture in the gutter ends with; `lines` holds the lines it touched. */
function gutterResult(gesture: Gesture, upLine: number, lines: LineRange[]): LineRange[] {
  if (gesture.isExtending) return extendLast(gesture.base, upLine);
  if (!gesture.isAdding) return lines;
  const isClick = lines.length === 1 && lines[0].start === lines[0].end;
  if (!isClick) return normalize([...gesture.base, ...lines]);
  const isSelected = gesture.base.some((r) => r.start <= gesture.line && gesture.line <= r.end);
  const line = { start: gesture.line, end: gesture.line };
  return isSelected ? removeLine(gesture.base, gesture.line) : addRange(gesture.base, line);
}

/**
 * Hear `editor` and keep `host`'s selection as the user makes it.
 * Returns what stops hearing.
 */
export function attachSelectionController(
  editor: SelectionEditor,
  host: SelectionHost,
): { dispose(): void } {
  let gesture: Gesture | null = null;
  /** The tab's selection when the current run of selection keys began; null outside a run. */
  let keyRunBase: readonly LineRange[] | null = null;
  /** A key changed Monaco's selection since the last key up. */
  let hasKeyboardSelection = false;
  /** The last key pressed was Esc: Monaco's selection changes on it are its own, not the user's. */
  let isAfterEscape = false;

  const monacoSelections = (): readonly MonacoSelectionLike[] => editor.getSelections() ?? [];
  const fileLine = (editorLine: number) => host.windowStart() + editorLine - 1;

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

  /** Commit `ranges` for a gesture whose last file line is `lastLine`, and leave Monaco a cursor after it. */
  function commitAfter(ranges: LineRange[], lastLine: number) {
    host.select(ranges);
    collapseAt(lastLine - host.windowStart() + 2);
  }

  function startGesture(e: Monaco.editor.IEditorMouseEvent) {
    gesture = null;
    endKeyRun();
    const position = e.target.position;
    const isGutter = GUTTER_TARGETS.has(e.target.type);
    if (!e.event.leftButton || !position || !(isGutter || TEXT_TARGETS.has(e.target.type))) return;
    gesture = {
      isGutter,
      isAdding: e.event.metaKey || e.event.ctrlKey,
      isExtending: e.event.shiftKey,
      line: fileLine(position.lineNumber),
      base: host.selection(),
      before: monacoSelections(),
    };
  }

  /** Commit the gesture in progress, released over `upEditorLine` when the editor knows it. */
  function commitGesture(upEditorLine: number | null) {
    const done = gesture;
    gesture = null;
    if (!done) return;
    const selections = done.isAdding
      ? newSelections(done.before, monacoSelections())
      : monacoSelections();
    const touched = fromMonacoSelections(selections, host.windowStart());
    if (done.isGutter) {
      const upLine = upEditorLine === null ? done.line : fileLine(upEditorLine);
      const pressed = { start: Math.min(done.line, upLine), end: Math.max(done.line, upLine) };
      const lines = normalize([pressed, ...touched]);
      commitAfter(gutterResult(done, upLine, lines), lines[lines.length - 1].end);
      return;
    }
    if (touched.length === 0) return;
    const ranges = done.isAdding ? normalize([...done.base, ...touched]) : touched;
    commitAfter(ranges, touched[touched.length - 1].end);
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
    host.select(normalize([...keyRunBase, ...touched]));
  }

  /**
   * Esc in the editor's text clears a selection and leaves Monaco a
   * cursor; with nothing selected, or in a field that takes typing (the
   * find widget's box), the key is left alone. Either way Monaco's own
   * response to Esc, which collapses its selections, is not committed.
   */
  function handleKeyDown(e: KeyboardEvent) {
    isAfterEscape = isShortcut('clearSelection', e);
    if (!isAfterEscape) return;
    endKeyRun();
    if (acceptsTyping(e.target as HTMLElement) || host.selection().length === 0) return;
    e.preventDefault();
    host.select([]);
    const cursor = editor.getPosition();
    if (cursor) collapseAt(cursor.lineNumber, cursor.column);
  }

  const onWindowMouseUp = () => commitGesture(null);
  const domNode = editor.getDomNode();
  const view = domNode?.ownerDocument.defaultView ?? null;
  const subscriptions = [
    editor.onMouseDown(startGesture),
    editor.onMouseUp((e) => commitGesture(e.target.position?.lineNumber ?? null)),
    editor.onDidChangeCursorSelection(noteSelectionChange),
    editor.onKeyUp(commitKeyboardSelection),
  ];
  // Capture: every key reaches the controller before Monaco handles it.
  domNode?.addEventListener('keydown', handleKeyDown, true);
  view?.addEventListener('mouseup', onWindowMouseUp);

  return {
    dispose() {
      for (const subscription of subscriptions) subscription.dispose();
      domNode?.removeEventListener('keydown', handleKeyDown, true);
      view?.removeEventListener('mouseup', onWindowMouseUp);
      gesture = null;
    },
  };
}
