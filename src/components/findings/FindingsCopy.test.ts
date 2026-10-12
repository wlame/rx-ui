// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '$lib/stores';
import { findingsBy } from '$lib/stores/layout';
import { FindingsBackend, TEST_DEFAULT_IDS, finding } from '$lib/testing/fakeFindings';
import {
  APP_LOG,
  buttonNamed,
  click,
  finishScans,
  keyDown,
  mountFindingsPanel,
  unmountFindingsPanels,
} from '$lib/testing/findingsPanel';
import { hoverTooltipText } from '$lib/testing/tooltipText';
import { copyText } from '$lib/utils/clipboard';
import { groupStyle } from '$lib/utils/groupStyle';
import { TEST_GROUPS } from '$lib/testing/fakeFindings';

// The clipboard is the browser's: the test reads what would go on it.
vi.mock('$lib/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }));

/** Two tracebacks and an SQL statement in app.log, every default signature scanned. */
const APP_FINDINGS = [
  finding('python-traceback', 120, 121),
  finding('sql-statement', 200),
  finding('python-traceback', 402, 403),
];

async function mountByGroup(found = APP_FINDINGS) {
  const backend = new FindingsBackend();
  backend.addFile(APP_LOG, found, TEST_DEFAULT_IDS);
  findingsBy.set('group');
  const target = await mountFindingsPanel(backend, [APP_LOG]);
  return { backend, target };
}

function headerRow(target: HTMLElement, selector: string): HTMLElement {
  const row = target.querySelector<HTMLElement>(selector);
  if (!row) throw new Error(`no row ${selector}`);
  return row;
}

function copyRequests(backend: FindingsBackend): URLSearchParams[] {
  return backend
    .requestsTo('GET', '/v1/findings')
    .map((request) => request.query)
    .filter((query) => query.get('text') === 'true');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(copyText).mockClear();
});

afterEach(async () => {
  await finishScans();
  unmountFindingsPanels();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Copy on the headers of the group view', () => {
  it("copies a group's findings, and leaves its header open", async () => {
    const { backend, target } = await mountByGroup();
    const row = headerRow(target, '[data-group="traceback"]');

    await click(buttonNamed(row, 'Copy the findings of the group traceback'));

    const [query] = copyRequests(backend);
    expect(query.getAll('group')).toEqual(['traceback']);
    expect(query.get('before')).toBe('1');
    expect(vi.mocked(copyText).mock.calls[0][0]).toContain(
      '==> app.log:402-403  python-traceback  (1 line before) <==',
    );
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it("copies one signature's findings from its header", async () => {
    const { backend, target } = await mountByGroup();
    const row = headerRow(target, '[data-signature="sql-statement"]');

    await click(buttonNamed(row, 'Copy the findings of SQL statement'));

    const [query] = copyRequests(backend);
    expect(query.getAll('signature')).toEqual(['sql-statement']);
    expect(query.getAll('group')).toEqual([]);
    expect(vi.mocked(copyText).mock.calls[0][0]).toBe(
      '==> app.log:200  sql-statement  (1 line before) <==\nLINE 199\nLINE 200\n',
    );
  });

  it('leaves the focus where it is when Copy is pressed', async () => {
    const { target } = await mountByGroup();
    const button = buttonNamed(
      headerRow(target, '[data-group="traceback"]'),
      'Copy the findings of the group traceback',
    );

    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  it("leaves the list's keys to the list when a Copy has the focus", async () => {
    const { target } = await mountByGroup();
    const row = headerRow(target, '[data-group="traceback"]');
    const button = buttonNamed(row, 'Copy the findings of the group traceback');
    button.focus();

    await keyDown(button, { key: 'ArrowDown', code: 'ArrowDown' });

    const next = Number(row.dataset.index) + 1;
    expect((document.activeElement as HTMLElement | null)?.dataset.index).toBe(String(next));
  });

  // A script or assistive technology can focus a Copy: Enter then
  // presses it, and the header neither closes nor opens.
  it('leaves Enter to a Copy that has the focus', async () => {
    const { target } = await mountByGroup();
    const row = headerRow(target, '[data-group="traceback"]');
    const button = buttonNamed(row, 'Copy the findings of the group traceback');
    button.focus();

    const event = await keyDown(button, { key: 'Enter', code: 'Enter' });

    expect(event.defaultPrevented).toBe(false);
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the list one Tab stop: the Copy buttons take no focus from the keyboard', async () => {
    const { target } = await mountByGroup();
    const buttons = target.querySelectorAll<HTMLButtonElement>('[role="tree"] button');
    expect(buttons.length).toBeGreaterThan(0);
    expect([...buttons].every((button) => button.tabIndex === -1)).toBe(true);
  });

  // The panel is the legend of the timeline's ticks: a header shows the
  // colour its group's rows and ticks have.
  it("marks each group and signature header with its group's colour", async () => {
    const { target } = await mountByGroup();
    const traceback = groupStyle('traceback', TEST_GROUPS).className;
    const sql = groupStyle('sql', TEST_GROUPS).className;

    const markOf = (selector: string) =>
      headerRow(target, selector).querySelector('[data-group-mark]')?.className ?? '';
    expect(markOf('[data-group="traceback"]')).toContain(traceback);
    expect(markOf('[data-signature="python-traceback"]')).toContain(traceback);
    expect(markOf('[data-group="sql"]')).toContain(sql);
    expect(traceback).not.toBe(sql);
  });
});

describe('the Copy buttons of the findings panel', () => {
  it('draws Copy on a header as the copy icon, named by its label and its tooltip', async () => {
    const { target } = await mountByGroup();
    const copies = [
      [headerRow(target, '[data-group="traceback"]'), 'Copy the findings of the group traceback'],
      [headerRow(target, '[data-signature="sql-statement"]'), 'Copy the findings of SQL statement'],
    ] as const;

    for (const [row, label] of copies) {
      const button = buttonNamed(row, label);
      expect(button.textContent?.trim()).toBe('');
      expect(button.querySelector('svg')?.dataset.icon).toBe('copy');
      expect(hoverTooltipText(button)).toBe(label);
    }
  });

  it('keeps the text of Copy all in the more menu, with the copy icon in front', async () => {
    const { target } = await mountByGroup();

    await click(buttonNamed(target, 'More scan actions'));

    const copyAll = buttonNamed(target, 'Copy all');
    expect(copyAll.textContent?.trim()).toBe('Copy all');
    expect(copyAll.firstElementChild?.getAttribute('data-icon')).toBe('copy');
  });
});

describe('Copy all in the more menu', () => {
  it('copies every finding the panel lists', async () => {
    const { backend, target } = await mountByGroup();

    await click(buttonNamed(target, 'More scan actions'));
    await click(buttonNamed(target, 'Copy all'));

    const [query] = copyRequests(backend);
    expect(query.getAll('group')).toEqual([]);
    expect(query.getAll('signature')).toEqual([]);
    expect(vi.mocked(copyText).mock.calls[0][0].match(/^==> /gm)).toHaveLength(3);
  });

  it('is disabled while the panel lists no finding', async () => {
    const { target } = await mountByGroup([]);

    await click(buttonNamed(target, 'More scan actions'));

    expect(buttonNamed(target, 'Copy all').disabled).toBe(true);
  });

  it('is disabled while no signature is picked', async () => {
    settings.update((s) => ({ ...s, findingsPicker: [] }));
    const { target } = await mountByGroup();

    await click(buttonNamed(target, 'More scan actions'));

    expect(buttonNamed(target, 'Copy all').disabled).toBe(true);
  });
});
