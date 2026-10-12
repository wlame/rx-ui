// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { hoverTooltipText } from '$lib/testing/tooltipText';
import type { LineRange } from '$lib/utils/lineSelection';
import SelectionChip from './SelectionChip.svelte';

let chip: SelectionChip | null = null;

function mount(ranges: LineRange[], copy: (() => Promise<void>) | null = async () => {}) {
  const target = document.body.appendChild(document.createElement('div'));
  const clear = vi.fn();
  chip = new SelectionChip({ target, props: { ranges, copy, clear } });
  const button = (label: string) => {
    const found = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no button "${label}"`);
    return found;
  };
  return { target, clear, button };
}

afterEach(() => {
  chip?.$destroy();
  chip = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('SelectionChip', () => {
  it('counts the ranges and the lines', () => {
    const { target } = mount([
      { start: 120, end: 134 },
      { start: 200, end: 200 },
      { start: 305, end: 309 },
    ]);
    expect(target.textContent).toContain('3 ranges · 21 lines');
  });

  it('says one range and one line in the singular', () => {
    const { target } = mount([{ start: 7, end: 7 }]);
    expect(target.textContent).toContain('1 range · 1 line');
  });

  it('shows nothing without a selection', () => {
    const { target } = mount([]);
    expect(target.querySelector('button')).toBeNull();
    expect(target.textContent?.trim()).toBe('');
  });

  it('clears the selection with ×', () => {
    const { clear, button } = mount([{ start: 7, end: 7 }]);
    button('Clear the selected lines').click();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('copies once, and stays disabled until the copy ends', async () => {
    let finish: () => void = () => {};
    const copy = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { button } = mount([{ start: 7, end: 7 }], copy);
    const copyButton = button('Copy the selected lines');

    copyButton.click();
    await tick();
    copyButton.click();
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copyButton.disabled).toBe(true);

    finish();
    await tick();
    await tick();
    expect(copyButton.disabled).toBe(false);
  });

  it('draws Copy as the copy icon, named by its label and its tooltip', () => {
    vi.useFakeTimers();
    const { button } = mount([{ start: 7, end: 7 }]);
    const copyButton = button('Copy the selected lines');

    expect(copyButton.textContent?.trim()).toBe('');
    expect(copyButton.querySelector('svg')?.dataset.icon).toBe('copy');
    expect(hoverTooltipText(copyButton)).toBe('Copy the selected lines');
  });

  it('cannot copy when the tab gives no way to', () => {
    const { button } = mount([{ start: 7, end: 7 }], null);
    expect(button('Copy the selected lines').disabled).toBe(true);
  });
});
