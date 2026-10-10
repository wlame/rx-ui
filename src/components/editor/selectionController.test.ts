// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MOUSE_TARGET,
  createFakeMonacoEditor,
  type FakeMonacoEditor,
} from '$lib/testing/fakeMonacoEditor';
import type { LineRange, MonacoSelectionLike } from '$lib/utils/lineSelection';
import { attachSelectionController } from './selectionController';

/** The window holds file lines from 101: Monaco's line 1 is file line 101. */
const WINDOW_START = 101;

let fake: FakeMonacoEditor;
let selected: LineRange[];
let commits: LineRange[][];
let controller: { dispose(): void };

function attach(initial: LineRange[] = []) {
  selected = initial;
  controller = attachSelectionController(fake.editor, {
    windowStart: () => WINDOW_START,
    selection: () => selected,
    select: (ranges) => {
      selected = ranges;
      commits.push(ranges);
    },
  });
}

function sel(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): MonacoSelectionLike {
  return {
    startLineNumber: startLine,
    startColumn,
    endLineNumber: endLine,
    endColumn,
  };
}

/** A click on the number of editor line `line`, with Monaco selecting that whole line as it does. */
function clickLineNumber(line: number, modifiers: { shiftKey?: boolean; metaKey?: boolean } = {}) {
  const mouse = { type: MOUSE_TARGET.lineNumbers, line, ...modifiers };
  fake.mouseDown(mouse);
  fake.changeSelections([sel(line, 1, line + 1, 1)], 'mouse');
  fake.mouseUp(mouse);
}

/** Whether a Monaco selection is a cursor that selects nothing. */
function isEmpty(selection: MonacoSelectionLike): boolean {
  return (
    selection.startLineNumber === selection.endLineNumber &&
    selection.startColumn === selection.endColumn
  );
}

/** Shift+↓ as Monaco does it: every selection it holds ends one line lower, then the key is released. */
function shiftDown() {
  const extended = fake.selections.map((s) =>
    sel(s.startLineNumber, s.startColumn, s.endLineNumber + 1, s.endColumn),
  );
  fake.changeSelections(extended, 'keyboard');
  fake.keyUp('ArrowDown');
}

/** A Cmd+click on the number of editor line `line`, where Monaco adds that line to its selections. */
function cmdClickLineNumber(line: number) {
  const mouse = { type: MOUSE_TARGET.lineNumbers, line, metaKey: true };
  fake.mouseDown(mouse);
  fake.changeSelections([...fake.selections, sel(line, 1, line + 1, 1)], 'mouse');
  fake.mouseUp(mouse);
}

/** Esc pressed on `target`, by default the editor's own node. */
function pressEscape(target: Element | null = fake.editor.getDomNode()): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  target?.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  fake = createFakeMonacoEditor();
  commits = [];
});

afterEach(() => {
  controller.dispose();
});

describe('selectionController with the mouse', () => {
  it('replaces the selection with the line whose number is clicked', () => {
    attach([{ start: 105, end: 107 }]);
    clickLineNumber(3);
    expect(selected).toEqual([{ start: 103, end: 103 }]);
  });

  it('extends the last range to the line whose number is Shift+clicked', () => {
    attach([
      { start: 101, end: 102 },
      { start: 110, end: 111 },
    ]);
    clickLineNumber(15, { shiftKey: true });
    expect(selected).toEqual([
      { start: 101, end: 102 },
      { start: 110, end: 115 },
    ]);
  });

  it('adds the line whose number is Cmd+clicked, and removes it on a second Cmd+click', () => {
    attach([{ start: 101, end: 101 }]);

    clickLineNumber(5, { metaKey: true });
    expect(selected).toEqual([
      { start: 101, end: 101 },
      { start: 105, end: 105 },
    ]);

    clickLineNumber(5, { metaKey: true });
    expect(selected).toEqual([{ start: 101, end: 101 }]);
  });

  it('adds with Ctrl+click as with Cmd+click', () => {
    attach([{ start: 101, end: 101 }]);
    fake.mouseDown({ type: MOUSE_TARGET.lineNumbers, line: 4, ctrlKey: true });
    fake.mouseUp({ type: MOUSE_TARGET.lineNumbers, line: 4, ctrlKey: true });
    expect(selected).toEqual([
      { start: 101, end: 101 },
      { start: 104, end: 104 },
    ]);
  });

  it('selects the lines a drag over the line numbers touches', () => {
    attach();
    fake.mouseDown({ type: MOUSE_TARGET.lineNumbers, line: 6 });
    fake.changeSelections([sel(4, 1, 7, 1)], 'mouse');
    fake.mouseUp({ type: MOUSE_TARGET.lineNumbers, line: 4 });
    expect(selected).toEqual([{ start: 104, end: 106 }]);
  });

  it('commits a drag in the text once, on mouse up, with the whole lines it touches', () => {
    attach([{ start: 150, end: 150 }]);
    fake.mouseDown({ type: MOUSE_TARGET.text, line: 2, column: 3 });
    fake.changeSelections([sel(2, 3, 3, 1)], 'mouse');
    fake.changeSelections([sel(2, 3, 4, 5)], 'mouse');
    expect(commits).toEqual([]);

    fake.mouseUp({ type: MOUSE_TARGET.text, line: 4, column: 5 });

    expect(commits).toEqual([[{ start: 102, end: 104 }]]);
  });

  it('adds the lines a Cmd+drag touches, beside the earlier ranges', () => {
    attach([{ start: 101, end: 101 }]);
    fake.selections = [sel(1, 1, 1, 9)];
    fake.mouseDown({ type: MOUSE_TARGET.text, line: 5, column: 2, metaKey: true });
    fake.changeSelections([sel(1, 1, 1, 9), sel(5, 2, 5, 2)], 'mouse');
    fake.changeSelections([sel(1, 1, 1, 9), sel(5, 2, 7, 3)], 'mouse');
    fake.mouseUp({ type: MOUSE_TARGET.text, line: 7, column: 3, metaKey: true });
    expect(selected).toEqual([
      { start: 101, end: 101 },
      { start: 105, end: 107 },
    ]);
  });

  it('changes nothing for a click that only places the cursor', () => {
    attach([{ start: 105, end: 105 }]);
    fake.mouseDown({ type: MOUSE_TARGET.text, line: 3, column: 4 });
    fake.changeSelections([sel(3, 4, 3, 4)], 'mouse');
    fake.mouseUp({ type: MOUSE_TARGET.text, line: 3, column: 4 });
    expect(commits).toEqual([]);
  });

  it('selects the whole line of a word picked by a double click', () => {
    attach();
    fake.mouseDown({ type: MOUSE_TARGET.text, line: 3, column: 4 });
    fake.changeSelections([sel(3, 2, 3, 8)], 'mouse');
    fake.mouseUp({ type: MOUSE_TARGET.text, line: 3, column: 4 });
    expect(selected).toEqual([{ start: 103, end: 103 }]);
  });

  it('commits a drag released outside the editor when the window hears the release', () => {
    attach();
    fake.mouseDown({ type: MOUSE_TARGET.text, line: 2, column: 1 });
    fake.changeSelections([sel(2, 1, 9, 4)], 'mouse');

    window.dispatchEvent(new MouseEvent('mouseup'));
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(commits).toEqual([[{ start: 102, end: 109 }]]);
  });

  it('changes nothing for a press on the scrollbar or with another button', () => {
    attach([{ start: 105, end: 105 }]);
    fake.mouseDown({ type: MOUSE_TARGET.scrollbar, line: 3 });
    fake.mouseUp({ type: MOUSE_TARGET.scrollbar, line: 3 });
    fake.mouseDown({ type: MOUSE_TARGET.lineNumbers, line: 3, leftButton: false });
    fake.mouseUp({ type: MOUSE_TARGET.lineNumbers, line: 3 });
    expect(commits).toEqual([]);
  });
});

describe('selectionController and the selection Monaco keeps', () => {
  it('leaves only a cursor in Monaco after each gesture, and commits nothing for that', () => {
    attach([{ start: 113, end: 113 }]);
    fake.selections = [sel(13, 1, 14, 1)];

    cmdClickLineNumber(20);
    expect(fake.selections.every(isEmpty)).toBe(true);
    clickLineNumber(25, { shiftKey: true });
    expect(fake.selections.every(isEmpty)).toBe(true);
    cmdClickLineNumber(13);

    expect(selected).toEqual([{ start: 120, end: 125 }]);
    expect(fake.selections.every(isEmpty)).toBe(true);
    expect(commits).toHaveLength(3);
  });

  it('clears on Esc a selection made by Cmd+click, Shift+click and a Cmd+click that takes a line out', () => {
    attach([{ start: 113, end: 113 }]);
    fake.selections = [sel(13, 1, 14, 1)];
    cmdClickLineNumber(20);
    clickLineNumber(25, { shiftKey: true });
    cmdClickLineNumber(13);
    expect(selected).toEqual([{ start: 120, end: 125 }]);

    pressEscape();
    // Monaco's own Esc collapses whatever selections it holds to the first one.
    fake.changeSelections(fake.selections.slice(0, 1), 'keyboard');
    fake.keyUp('Escape');

    expect(selected).toEqual([]);
    expect(fake.selections.every(isEmpty)).toBe(true);
  });

  it('leaves the cursor at the start of the line after the gesture', () => {
    attach();
    fake.mouseDown({ type: MOUSE_TARGET.text, line: 2, column: 3 });
    fake.changeSelections([sel(2, 3, 4, 5)], 'mouse');
    fake.mouseUp({ type: MOUSE_TARGET.text, line: 4, column: 5 });
    expect(fake.selections).toEqual([sel(5, 1, 5, 1)]);
  });

  it('does not bring back a line taken out with Cmd+click when Shift+↓ follows', () => {
    attach([
      { start: 113, end: 113 },
      { start: 120, end: 125 },
    ]);
    fake.selections = [sel(13, 1, 14, 1), sel(20, 1, 26, 1)];

    cmdClickLineNumber(13);
    shiftDown();

    expect(selected).not.toContainEqual(expect.objectContaining({ start: 113 }));
    expect(selected).toContainEqual({ start: 120, end: 125 });
  });

  it('clears on Esc, and commits nothing when Monaco then collapses its own selections', () => {
    attach([{ start: 120, end: 125 }]);
    fake.selections = [sel(25, 1, 27, 1), sel(13, 1, 14, 1)];

    const event = pressEscape();
    fake.changeSelections([sel(25, 1, 27, 1)], 'keyboard');
    fake.keyUp('Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(selected).toEqual([]);
    expect(commits).toEqual([[]]);
  });

  it("commits nothing when Esc with nothing selected collapses Monaco's selections", () => {
    attach();
    fake.selections = [sel(25, 1, 27, 1), sel(13, 1, 14, 1)];

    const event = pressEscape();
    fake.changeSelections([sel(25, 1, 27, 1)], 'keyboard');
    fake.keyUp('Escape');

    expect(event.defaultPrevented).toBe(false);
    expect(commits).toEqual([]);
  });

  it('commits nothing when a page load changes the selection before the key is released', () => {
    attach([{ start: 103, end: 103 }]);
    fake.changeSelections([sel(3, 1, 5, 1)], 'keyboard');
    fake.changeSelections([sel(1, 1, 2, 1)], 'model');
    fake.keyUp('ArrowDown');
    expect(commits).toEqual([]);
  });
});

describe('selectionController with the keys', () => {
  it('extends the selection with Shift+↓ and keeps the ranges Monaco does not cover', () => {
    attach([
      { start: 101, end: 102 },
      { start: 110, end: 111 },
    ]);
    // A click that only places the cursor on line 20 changes nothing.
    fake.mouseDown({ type: MOUSE_TARGET.text, line: 20, column: 4 });
    fake.changeSelections([sel(20, 4, 20, 4)], 'mouse');
    fake.mouseUp({ type: MOUSE_TARGET.text, line: 20, column: 4 });

    shiftDown();

    expect(selected).toEqual([
      { start: 101, end: 102 },
      { start: 110, end: 111 },
      { start: 120, end: 121 },
    ]);
  });

  it('shrinks back with Shift+↑ to the selection the keys started from, never below it', () => {
    attach([{ start: 101, end: 101 }]);
    fake.selections = [sel(20, 1, 20, 1)];

    fake.changeSelections([sel(20, 1, 23, 1)], 'keyboard');
    fake.keyUp('ArrowDown');
    expect(selected).toEqual([
      { start: 101, end: 101 },
      { start: 120, end: 122 },
    ]);

    fake.changeSelections([sel(20, 1, 21, 1)], 'keyboard');
    fake.keyUp('ArrowUp');
    expect(selected).toEqual([
      { start: 101, end: 101 },
      { start: 120, end: 120 },
    ]);
  });

  it("follows Monaco's selection keys on key up, as whole lines", () => {
    attach([{ start: 103, end: 103 }]);
    fake.changeSelections([sel(3, 1, 5, 1)], 'keyboard');
    expect(commits).toEqual([]);

    fake.keyUp('ArrowDown');

    expect(commits).toEqual([[{ start: 103, end: 104 }]]);
  });

  it('changes nothing for a key that only moves the cursor, or a selection the editor set', () => {
    attach([{ start: 103, end: 103 }]);
    fake.changeSelections([sel(4, 1, 4, 1)], 'keyboard');
    fake.keyUp('ArrowDown');
    fake.changeSelections([sel(1, 1, 3, 1)], 'api');
    fake.keyUp('Shift');
    expect(commits).toEqual([]);
  });

  it('clears the selection on Esc and cancels the key', () => {
    attach([{ start: 103, end: 104 }]);
    const event = pressEscape();
    expect(selected).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Esc to the find widget's box inside the editor", () => {
    attach([{ start: 103, end: 104 }]);
    const findBox = document.createElement('input');
    fake.editor.getDomNode()?.appendChild(findBox);

    const event = pressEscape(findBox);

    expect(commits).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves Esc alone when nothing is selected', () => {
    attach();
    const event = pressEscape();
    expect(commits).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('selectionController dispose', () => {
  it('stops hearing the editor, its keys and the window', () => {
    attach([{ start: 103, end: 104 }]);
    controller.dispose();

    fake.mouseDown({ type: MOUSE_TARGET.text, line: 2, column: 1 });
    fake.changeSelections([sel(2, 1, 9, 4)], 'mouse');
    window.dispatchEvent(new MouseEvent('mouseup'));
    const event = pressEscape();

    expect(fake.listenerCount()).toBe(0);
    expect(commits).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});
