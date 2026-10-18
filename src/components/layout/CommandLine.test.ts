// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { commandLog } from '$lib/stores/commands';
import { hoverTooltipText } from '$lib/testing/tooltipText';
import { copyText } from '$lib/utils/clipboard';
import CommandLine from './CommandLine.svelte';

// The clipboard is the browser's: the test reads what would go on it.
vi.mock('$lib/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }));

const COMMAND = 'rx trace error /logs/app.log';
const NOTE = 'q has no command-line flag: the command lists more findings than this answer';

let line: CommandLine | null = null;

function mount(): HTMLElement {
  const target = document.body.appendChild(document.createElement('div'));
  line = new CommandLine({ target });
  return target;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(copyText).mockClear();
  commandLog.record(COMMAND, 'search');
});

afterEach(() => {
  line?.$destroy();
  line = null;
  commandLog.clear();
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** The button of the status bar named `label`, or null. */
function buttonNamed(target: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

describe('CommandLine', () => {
  it('draws the Copy of the equivalent command as the copy icon, named by its label and its tooltip', async () => {
    const target = mount();
    await tick();
    const button = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy the equivalent command"]',
    );
    if (!button) throw new Error('no Copy button');

    expect(button.textContent?.trim()).toBe('');
    expect(button.querySelector('svg')?.dataset.icon).toBe('copy');
    expect(hoverTooltipText(button)).toBe('Copy the equivalent command');

    button.click();
    expect(vi.mocked(copyText)).toHaveBeenCalledWith(COMMAND);
  });

  // A command that lists more than its answer says so: the note is on a
  // Note button, whose tooltip is the note, and in the recent commands.
  it('names the note of the last answer on a Note button', async () => {
    commandLog.record('rx trace /logs/app.log --signatures=default', 'findings', [], NOTE);
    const target = mount();
    await tick();

    expect(buttonNamed(target, 'Note')?.title).toBe(NOTE);
  });

  it('has no Note button for an answer without a note', async () => {
    const target = mount();
    await tick();

    expect(buttonNamed(target, 'Note')).toBeNull();
  });

  it('opens the recent commands, which give the note in full, from the Note button', async () => {
    commandLog.record('rx trace /logs/app.log --signatures=default', 'findings', [], NOTE);
    const target = mount();
    await tick();
    expect(target.textContent).not.toContain(NOTE);

    buttonNamed(target, 'Note')?.click();
    await tick();

    expect(target.textContent).toContain(NOTE);
  });
});
