/**
 * The rows a virtual list draws: a list of fixed-height rows draws only
 * the rows its viewport shows and a few on each side (the overscan), so
 * a list of 100,000 rows costs a few dozen elements.
 */

/** The first and the last row to draw, both inclusive; `last < first` draws none. */
export interface RowWindow {
  first: number;
  last: number;
}

/**
 * The rows of a list of `total` rows of `rowHeight` pixels that a
 * viewport `viewport` pixels high, scrolled `scrollTop` pixels down,
 * shows, with `overscan` more rows on each side. A scroll past either end
 * is read as that end, and a viewport with no height yet (before layout)
 * draws only the overscan rows from the top of the scroll.
 *
 * @throws Error when `rowHeight` is not positive: every row has a height.
 */
export function visibleWindow(
  total: number,
  rowHeight: number,
  scrollTop: number,
  viewport: number,
  overscan: number,
): RowWindow {
  if (!(rowHeight > 0)) throw new Error(`The row height must be positive, got ${rowHeight}`);
  if (total <= 0) return { first: 0, last: -1 };
  const lastRow = total - 1;
  const top = Math.max(0, scrollTop);
  const firstShown = Math.floor(top / rowHeight);
  const lastShown = Math.ceil((top + Math.max(0, viewport)) / rowHeight) - 1;
  const first = Math.min(lastRow, Math.max(0, firstShown - overscan));
  const last = Math.max(first, Math.min(lastRow, lastShown + overscan));
  return { first, last };
}

/** The pages of `pageSize` rows that hold a row from `first` to `last`, in order. */
export function pagesInWindow(first: number, last: number, pageSize: number): number[] {
  if (last < first) return [];
  const pages: number[] = [];
  for (let page = Math.floor(first / pageSize); page <= Math.floor(last / pageSize); page++) {
    pages.push(page);
  }
  return pages;
}
