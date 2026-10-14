/**
 * A layout for a scrolled list of rows in jsdom, which lays nothing out:
 * the scroller is `height` px tall at the top of the page and keeps the
 * `scrollTop` it is given; each element with `data-row-id` inside it is
 * `rowHeight` px tall, one under the other in document order, moved up
 * by the scroll. Every other element keeps jsdom's empty box. Undo it
 * with `vi.restoreAllMocks()`.
 */
import { vi } from 'vitest';

export interface RowLayout {
  rowHeight: number;
  height: number;
}

export function layOutRows(scroller: HTMLElement, { rowHeight, height }: RowLayout): void {
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, value);
    },
  });
  const emptyBox = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === scroller) return new DOMRect(0, 0, 300, height);
    if (
      this instanceof HTMLElement &&
      this.dataset.rowId !== undefined &&
      scroller.contains(this)
    ) {
      const index = [...scroller.querySelectorAll('[data-row-id]')].indexOf(this);
      return new DOMRect(0, index * rowHeight - scrollTop, 300, rowHeight);
    }
    return emptyBox.call(this);
  });
}
