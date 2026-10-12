/**
 * `use:measureHeight={(px) => …}` and `use:measureWidth={(px) => …}`:
 * report an element's height (`clientHeight`) or width (`clientWidth`)
 * when it is drawn, and again whenever it changes, for a component whose
 * drawing depends on its own size, such as a virtual list or the ticks of
 * a timeline. A `ResizeObserver` sees every change of the element's size;
 * where there is none, the window's `resize` stands in for it.
 */

/** Report `read(node)` now and at every change of the node's size, until destroyed. */
function measure(
  node: HTMLElement,
  read: (node: HTMLElement) => number,
  onSize: (px: number) => void,
) {
  let report = onSize;
  const measureNow = () => report(read(node));
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureNow);
  if (observer) observer.observe(node);
  else window.addEventListener('resize', measureNow);
  measureNow();

  return {
    update(next: (px: number) => void) {
      report = next;
    },
    destroy() {
      observer?.disconnect();
      window.removeEventListener('resize', measureNow);
    },
  };
}

/** Report the element's height, as laid out, when it is drawn and whenever it changes. */
export function measureHeight(node: HTMLElement, onHeight: (px: number) => void) {
  return measure(node, (element) => element.clientHeight, onHeight);
}

/** Report the element's width, as laid out, when it is drawn and whenever it changes. */
export function measureWidth(node: HTMLElement, onWidth: (px: number) => void) {
  return measure(node, (element) => element.clientWidth, onWidth);
}
