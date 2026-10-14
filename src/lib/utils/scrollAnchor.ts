/**
 * Keep a scrolled list's rows in place on screen while rows come and go
 * above them. Before a change, `captureScrollAnchor` notes the first row
 * in view and where it starts; after the change is drawn,
 * `restoreScrollAnchor` scrolls by as much as that row moved, so it
 * starts there again. The rows are the elements with `data-row-id`, in
 * document order, which is the order on screen.
 *
 * Some browsers anchor the scroll themselves (`overflow-anchor`) and
 * Safari does not; a list that uses this module turns theirs off.
 */

/** The first row in view and where it starts, in px from the top of the view (0 or less). */
export interface ScrollAnchor {
  id: string;
  offset: number;
}

function rowsOf(scroller: HTMLElement): HTMLElement[] {
  return [...scroller.querySelectorAll<HTMLElement>('[data-row-id]')];
}

/**
 * The first row of `scroller` in view: the first whose bottom is below
 * the top of the view, found by halving, as the rows stand in order. None
 * when the view is at the top of the list, where a row added above the
 * first one is to show, or when no row is drawn.
 */
export function captureScrollAnchor(scroller: HTMLElement): ScrollAnchor | null {
  if (scroller.scrollTop <= 0) return null;
  const rows = rowsOf(scroller);
  const viewTop = scroller.getBoundingClientRect().top;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle].getBoundingClientRect().bottom > viewTop) high = middle;
    else low = middle + 1;
  }
  const row = rows[low];
  const id = row?.dataset.rowId;
  if (row === undefined || id === undefined) return null;
  return { id, offset: row.getBoundingClientRect().top - viewTop };
}

/**
 * Scroll `scroller` so that the row of `anchor` starts where it did. A
 * row that is gone leaves the view as it is.
 */
export function restoreScrollAnchor(scroller: HTMLElement, anchor: ScrollAnchor): void {
  const row = rowsOf(scroller).find((candidate) => candidate.dataset.rowId === anchor.id);
  if (!row) return;
  const shift =
    row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
  if (shift !== 0) scroller.scrollTop += shift;
}
