import { describe, expect, it } from 'vitest';
import { pagesInWindow, visibleWindow } from './virtualList';

describe('visibleWindow', () => {
  it('gives the rows the viewport shows, with the overscan on each side', () => {
    // Rows of 20 px; the viewport shows 200 px from 1,000 px down: rows 50 to 59.
    expect(visibleWindow(100_000, 20, 1_000, 200, 3)).toEqual({ first: 47, last: 62 });
  });

  it('starts at the first row at the top and stops at the last row at the end', () => {
    expect(visibleWindow(10, 20, 0, 100, 3)).toEqual({ first: 0, last: 7 });
    expect(visibleWindow(10, 20, 100, 100, 3)).toEqual({ first: 2, last: 9 });
  });

  it('counts a row the viewport shows in part', () => {
    expect(visibleWindow(100, 20, 10, 30, 0)).toEqual({ first: 0, last: 1 });
  });

  it('gives no row for an empty list', () => {
    expect(visibleWindow(0, 20, 0, 100, 3)).toEqual({ first: 0, last: -1 });
  });

  it('keeps a scroll past the end within the list', () => {
    expect(visibleWindow(10, 20, 5_000, 100, 0)).toEqual({ first: 9, last: 9 });
  });

  it('reads a negative scroll as the top', () => {
    expect(visibleWindow(10, 20, -50, 40, 0)).toEqual({ first: 0, last: 1 });
  });

  it('draws only the overscan rows while the viewport has no height yet', () => {
    expect(visibleWindow(100, 20, 0, 0, 3)).toEqual({ first: 0, last: 2 });
  });

  it('refuses a row height that is not positive', () => {
    expect(() => visibleWindow(10, 0, 0, 100, 0)).toThrow(/row height/);
  });

  it('draws a few dozen rows of a list of 100,000', () => {
    const { first, last } = visibleWindow(100_000, 24, 1_200_000, 600, 5);

    // 25 rows on screen and 5 on each side.
    expect(last - first + 1).toBe(35);
  });
});

describe('pagesInWindow', () => {
  it('names each page that holds a row of the window, once', () => {
    expect(pagesInWindow(190, 410, 200)).toEqual([0, 1, 2]);
    expect(pagesInWindow(200, 399, 200)).toEqual([1]);
  });

  it('names no page for an empty window', () => {
    expect(pagesInWindow(0, -1, 200)).toEqual([]);
  });
});
