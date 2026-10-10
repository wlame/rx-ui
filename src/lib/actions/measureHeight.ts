/**
 * `use:measureHeight={(px) => …}`: report an element's height (its
 * `clientHeight`) when it is drawn, and again whenever it changes, for a
 * component whose drawing depends on its own height, such as a virtual
 * list. A `ResizeObserver` sees every change of the element's size;
 * where there is none, the window's `resize` stands in for it.
 */
export function measureHeight(node: HTMLElement, onHeight: (px: number) => void) {
  let report = onHeight;
  const measure = () => report(node.clientHeight);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  if (observer) observer.observe(node);
  else window.addEventListener('resize', measure);
  measure();

  return {
    update(next: (px: number) => void) {
      report = next;
    },
    destroy() {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    },
  };
}
