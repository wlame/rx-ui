/**
 * Reading the viewer's tooltip of a control in a component test, as a
 * pointer that rests on it sees it. The test runs with fake timers.
 */
import { vi } from 'vitest';
import { TOOLTIP_DELAY_MS, TOOLTIP_ID } from '../actions/tooltip';

/**
 * The text of the tooltip `trigger` shows after a hover, or null when it
 * shows none; the pointer then leaves, which hides it again.
 */
export function hoverTooltipText(trigger: Element): string | null {
  trigger.dispatchEvent(new MouseEvent('mouseenter'));
  vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
  const element = document.getElementById(TOOLTIP_ID);
  const text = element && !element.hidden ? element.textContent : null;
  trigger.dispatchEvent(new MouseEvent('mouseleave'));
  return text;
}
