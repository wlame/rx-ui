/**
 * `use:captureKeydown={handler}`: hears `keydown` on the element in the
 * capture phase, before any element inside it hears it, such as a Monaco
 * editor, which binds keys of its own. The handler calls
 * `stopPropagation` on the keys it takes, so the element inside never
 * sees them.
 *
 * An action, not a listener added in `onMount`: it is added when the
 * element is, in the app and in a component test alike.
 */
export function captureKeydown(node: HTMLElement, handler: (event: KeyboardEvent) => void) {
  let current = handler;
  const listener = (event: KeyboardEvent) => current(event);
  node.addEventListener('keydown', listener, true);
  return {
    update(next: (event: KeyboardEvent) => void) {
      current = next;
    },
    destroy() {
      node.removeEventListener('keydown', listener, true);
    },
  };
}
