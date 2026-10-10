// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, settings } from '$lib/stores';
import { FindingsBackend, finding } from '$lib/testing/fakeFindings';
import {
  APP_LOG,
  WORKER_LOG,
  buttonNamed,
  click,
  finishScans,
  keyDown,
  mountFindingsPanel,
  settle,
  typeInto,
  unmountFindingsPanels,
} from '$lib/testing/findingsPanel';
import { startViewSync } from '$lib/viewState';

const EVERY_ACTIVE = [
  'python-traceback',
  'java-exception',
  'aws-access-key',
  'sql-statement',
  'email-address',
  'phone-number',
];

/** The panel over app.log, scanned with python-traceback only, with the picker open. */
async function mountWithPicker() {
  const backend = new FindingsBackend();
  backend.addFile(APP_LOG, [finding('python-traceback', 5)], ['python-traceback']);
  const target = await mountFindingsPanel(backend, [APP_LOG]);
  const trigger = pickerButton(target);
  await click(trigger);
  return { backend, target, trigger };
}

function pickerButton(target: HTMLElement): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>('button[aria-controls="findings-picker"]');
  if (!button) throw new Error('no picker button');
  return button;
}

function picker(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>('#findings-picker');
}

function box(target: HTMLElement, selector: string): HTMLInputElement {
  const found = picker(target)?.querySelector<HTMLInputElement>(selector);
  if (!found) throw new Error(`no box ${selector}`);
  return found;
}

const groupBox = (target: HTMLElement, group: string) =>
  box(target, `input[data-group="${group}"]`);
const signatureBox = (target: HTMLElement, id: string) =>
  box(target, `input[data-signature="${id}"]`);

/** The names of the groups and signatures the checklist shows. */
function shownIds(target: HTMLElement): string[] {
  return [
    ...(picker(target)?.querySelectorAll<HTMLInputElement>('input[data-signature]') ?? []),
  ].map((input) => input.dataset.signature ?? '');
}

let stopSync: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await finishScans();
  stopSync?.();
  stopSync = null;
  unmountFindingsPanels();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the signature picker', () => {
  it('lists the active signatures by group, and marks opt-in ones and those current for the file', async () => {
    const { target, trigger } = await mountWithPicker();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.textContent?.replace(/\s+/g, ' ').trim()).toBe('Signatures: Default (4) ▾');
    expect(shownIds(target)).toEqual(EVERY_ACTIVE);
    const label = (id: string) => signatureBox(target, id).closest('label');
    expect(label('email-address')?.querySelector('[data-opt-in]')).not.toBeNull();
    expect(label('python-traceback')?.querySelector('[data-opt-in]')).toBeNull();
    expect(label('python-traceback')?.querySelector('[data-current]')).not.toBeNull();
    expect(label('java-exception')?.querySelector('[data-current]')).toBeNull();
  });

  it('shows a group partly picked as mixed, and its box picks or drops the whole group', async () => {
    const { target } = await mountWithPicker();

    await click(signatureBox(target, 'java-exception'));
    expect(groupBox(target, 'traceback').indeterminate).toBe(true);
    expect(groupBox(target, 'traceback').checked).toBe(false);

    await click(groupBox(target, 'traceback'));
    expect(groupBox(target, 'traceback').indeterminate).toBe(false);
    expect(groupBox(target, 'traceback').checked).toBe(true);
    expect(get(settings).findingsPicker).toBeNull();

    await click(groupBox(target, 'traceback'));
    expect(groupBox(target, 'traceback').checked).toBe(false);
    expect(get(settings).findingsPicker).toEqual(['aws-access-key', 'sql-statement']);
  });

  it('applies the presets All, None and Default', async () => {
    const { target, trigger } = await mountWithPicker();

    await click(buttonNamed(picker(target) as HTMLElement, 'All'));
    expect(get(settings).findingsPicker).toEqual(EVERY_ACTIVE);
    expect(trigger.textContent?.replace(/\s+/g, ' ').trim()).toBe('Signatures: All (6) ▾');

    await click(buttonNamed(picker(target) as HTMLElement, 'None'));
    expect(get(settings).findingsPicker).toEqual([]);
    expect(signatureBox(target, 'python-traceback').checked).toBe(false);

    await click(buttonNamed(picker(target) as HTMLElement, 'Default'));
    expect(get(settings).findingsPicker).toBeNull();
  });

  it('narrows the checklist to the signatures whose name, group or tag holds the text', async () => {
    const { target } = await mountWithPicker();
    const filter = picker(target)?.querySelector<HTMLInputElement>(
      'input[aria-label="Filter signatures"]',
    );
    if (!filter) throw new Error('no filter box');

    await typeInto(filter, 'pii');

    expect(shownIds(target)).toEqual(['email-address', 'phone-number']);
    expect(picker(target)?.querySelector('input[data-group="traceback"]')).toBeNull();
  });

  it('reads the summary again for the new choice, which the scan button then counts', async () => {
    const { backend, target } = await mountWithPicker();

    await click(buttonNamed(picker(target) as HTMLElement, 'All'));

    const last = backend.requestsTo('GET', '/v1/findings').at(-1)?.query;
    expect(last?.get('signatures')).toBe('all');
    expect(target.querySelector('button[data-scan]')?.textContent?.trim()).toBe('Scan 5 missing');
  });

  it('keeps the choice out of the link', async () => {
    const { target } = await mountWithPicker();
    stopSync = startViewSync();
    await settle();
    const before = window.location.search;

    await click(signatureBox(target, 'email-address'));

    expect(get(settings).findingsPicker).toContain('email-address');
    expect(window.location.search).toBe(before);
    expect(window.location.search).not.toContain('email');
  });

  it("drops the marks of the file shown before while the next file's are read", async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, [finding('python-traceback', 5)], ['python-traceback']);
    backend.addFile(WORKER_LOG, [], ['sql-statement']);
    const target = await mountFindingsPanel(backend, [WORKER_LOG, APP_LOG]);
    await click(pickerButton(target));
    expect(picker(target)?.querySelectorAll('[data-current]')).toHaveLength(1);

    backend.holdFindings();
    files.setActiveFile(WORKER_LOG);
    await settle();

    expect(picker(target)?.querySelectorAll('[data-current]')).toHaveLength(0);
    backend.release();
    await settle();
    const marked = signatureBox(target, 'sql-statement').closest('label');
    expect(marked?.querySelector('[data-current]')).not.toBeNull();
  });

  it('closes on Esc and gives the focus back to its button', async () => {
    const { target, trigger } = await mountWithPicker();
    const first = signatureBox(target, 'python-traceback');
    first.focus();

    const event = await keyDown(first, { key: 'Escape', code: 'Escape' });

    expect(event.defaultPrevented).toBe(true);
    expect(picker(target)).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside it', async () => {
    const { target } = await mountWithPicker();

    await click(document.body);

    expect(picker(target)).toBeNull();
  });
});
