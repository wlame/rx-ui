/**
 * A stand-in for the Monaco editor in component tests, which jsdom cannot
 * run: the calls the editor pane makes on the editor `MonacoEditor` hands
 * it, with each decorations collection it creates recorded, and the
 * mouse, key and selection events a test fires at its listeners.
 */
import type * as Monaco from 'monaco-editor';
import type { MonacoSelectionLike } from '$lib/utils/lineSelection';

/** Monaco's MouseTargetType values a test points at. */
export const MOUSE_TARGET = { lineNumbers: 3, text: 6, scrollbar: 11 } as const;

/** What a test gives for a mouse event: where, which modifiers, which button. */
export interface FakeMouse {
  /** Monaco's target type (`MOUSE_TARGET`). */
  type: number;
  /** The editor line under the pointer, or null where Monaco gives no position. */
  line: number | null;
  column?: number;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  /** The left button; true unless set. */
  leftButton?: boolean;
}

export interface FakeMonacoEditor {
  /** The decorations of each collection the pane created, oldest first. */
  decorationSets: Monaco.editor.IModelDeltaDecoration[][];
  /** Each list of gutter labels the pane passed `MonacoEditorStub`, oldest first. */
  passedLabels: (readonly string[] | null)[];
  /** How many times the pane focused the editor. */
  focusCount: number;
  /** The editor as the pane reads it. */
  editor: Monaco.editor.IStandaloneCodeEditor;
  /** Monaco's selections as a test sets them; `getSelections` returns them. */
  selections: MonacoSelectionLike[];
  /** Fire a mouse press at the listeners. */
  mouseDown(mouse: FakeMouse): void;
  /** Fire a mouse release over the editor at the listeners. */
  mouseUp(mouse: FakeMouse): void;
  /** Set Monaco's selections and fire the change, from `source` (`mouse`, `keyboard`, `api`). */
  changeSelections(selections: MonacoSelectionLike[], source: string): void;
  /** Fire a key release at the listeners. */
  keyUp(key: string): void;
  /** How many listeners are attached to the editor's events. */
  listenerCount(): number;
}

/** A fake editor whose text is `lines`. */
export function createFakeMonacoEditor(lines: readonly string[] = []): FakeMonacoEditor {
  const decorationSets: Monaco.editor.IModelDeltaDecoration[][] = [];
  const listeners = {
    mouseDown: new Set<(e: unknown) => void>(),
    mouseUp: new Set<(e: unknown) => void>(),
    selection: new Set<(e: unknown) => void>(),
    keyUp: new Set<(e: unknown) => void>(),
  };
  /** Monaco's `onX(listener)`: add the listener, and give back what removes it. */
  const event = (set: Set<(e: unknown) => void>) => (listener: (e: unknown) => void) => {
    set.add(listener);
    return { dispose: () => set.delete(listener) };
  };
  const domNode = document.createElement('div');
  const mouseEvent = (mouse: FakeMouse) => ({
    target: {
      type: mouse.type,
      position: mouse.line === null ? null : { lineNumber: mouse.line, column: mouse.column ?? 1 },
    },
    event: {
      leftButton: mouse.leftButton ?? true,
      shiftKey: mouse.shiftKey ?? false,
      metaKey: mouse.metaKey ?? false,
      ctrlKey: mouse.ctrlKey ?? false,
      altKey: false,
    },
  });

  const fake: FakeMonacoEditor = {
    decorationSets,
    passedLabels: [],
    focusCount: 0,
    editor: null as unknown as Monaco.editor.IStandaloneCodeEditor,
    selections: [],
    mouseDown: (mouse) => listeners.mouseDown.forEach((l) => l(mouseEvent(mouse))),
    mouseUp: (mouse) => listeners.mouseUp.forEach((l) => l(mouseEvent(mouse))),
    changeSelections: (selections, source) => {
      fake.selections = selections;
      listeners.selection.forEach((l) => l({ selection: selections[0], source }));
    },
    keyUp: (key) => listeners.keyUp.forEach((l) => l({ browserEvent: { key } })),
    listenerCount: () => Object.values(listeners).reduce((count, set) => count + set.size, 0),
  };
  const model = {
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? '',
    onDidChangeContent: () => ({ dispose: () => {} }),
  };
  const editor = {
    getModel: () => model,
    createDecorationsCollection: (decorations: Monaco.editor.IModelDeltaDecoration[]) => {
      decorationSets.push(decorations);
      return { clear: () => {} };
    },
    getVisibleRanges: () => [],
    getScrollTop: () => 0,
    getScrollLeft: () => 0,
    focus: () => {
      fake.focusCount += 1;
    },
    getDomNode: () => domNode,
    getSelections: () => fake.selections,
    onMouseDown: event(listeners.mouseDown),
    onMouseUp: event(listeners.mouseUp),
    onDidChangeCursorSelection: event(listeners.selection),
    onKeyUp: event(listeners.keyUp),
  };
  fake.editor = editor as unknown as Monaco.editor.IStandaloneCodeEditor;
  return fake;
}

/** The fake editors `MonacoEditorStub` made, oldest first. */
export const fakeMonacoEditors: FakeMonacoEditor[] = [];
