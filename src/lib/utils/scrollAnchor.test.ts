// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureScrollAnchor, restoreScrollAnchor } from './scrollAnchor';
import { layOutRows } from '../testing/rowLayout';

const ROW_HEIGHT = 20;

/** A scrolled list of rows with the ids `ids`, laid out one row height apart. */
function list(ids: string[], scrollTop: number) {
  const scroller = document.body.appendChild(document.createElement('div'));
  setRows(scroller, ids);
  layOutRows(scroller, { rowHeight: ROW_HEIGHT, height: 100 });
  scroller.scrollTop = scrollTop;
  return scroller;
}

/** Replace the rows of `scroller` with rows of the ids `ids`. */
function setRows(scroller: HTMLElement, ids: string[]) {
  scroller.replaceChildren(
    ...ids.map((id) => {
      const row = document.createElement('div');
      row.dataset.rowId = id;
      return row;
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('captureScrollAnchor', () => {
  it('names the first row in view and how far below the top of the view it starts', () => {
    const scroller = list(['a', 'b', 'c', 'd', 'e', 'f'], 30);

    expect(captureScrollAnchor(scroller)).toEqual({ id: 'b', offset: -10 });
  });

  it('names none at the top of the list, where a row added above shows', () => {
    expect(captureScrollAnchor(list(['a', 'b'], 0))).toBeNull();
  });
});

describe('restoreScrollAnchor', () => {
  it('scrolls by the height of the rows added above the anchor', () => {
    const scroller = list(['b', 'c', 'd', 'e', 'f'], 30);
    const anchor = captureScrollAnchor(scroller);
    if (!anchor) throw new Error('no anchor');

    setRows(scroller, ['a', 'a2', 'b', 'c', 'd', 'e', 'f']);
    restoreScrollAnchor(scroller, anchor);

    expect(scroller.scrollTop).toBe(30 + 2 * ROW_HEIGHT);
    expect(captureScrollAnchor(scroller)).toEqual(anchor);
  });

  it('scrolls back by the height of a row removed above the anchor', () => {
    const scroller = list(['a', 'b', 'c', 'd', 'e', 'f'], 50);
    const anchor = captureScrollAnchor(scroller);
    if (!anchor) throw new Error('no anchor');

    setRows(scroller, ['b', 'c', 'd', 'e', 'f']);
    restoreScrollAnchor(scroller, anchor);

    expect(scroller.scrollTop).toBe(50 - ROW_HEIGHT);
  });

  it('leaves the view where it is when the anchor row is gone', () => {
    const scroller = list(['a', 'b', 'c', 'd', 'e', 'f'], 30);
    const anchor = captureScrollAnchor(scroller);
    if (!anchor) throw new Error('no anchor');

    setRows(scroller, ['a', 'c', 'd', 'e', 'f']);
    restoreScrollAnchor(scroller, anchor);

    expect(scroller.scrollTop).toBe(30);
  });
});
