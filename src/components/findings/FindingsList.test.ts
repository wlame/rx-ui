// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files } from '$lib/stores';
import { FINDINGS_PAGE_SIZE } from '$lib/stores/findings';
import { findingsBy } from '$lib/stores/layout';
import { FindingsBackend, TEST_DEFAULT_IDS, finding } from '$lib/testing/fakeFindings';
import {
  APP_LOG,
  click,
  finishScans,
  keyDown,
  mountFindingsPanel,
  settle,
  typeInto,
  unmountFindingsPanels,
} from '$lib/testing/findingsPanel';
import ModalDialogHarness from '$lib/testing/ModalDialogHarness.svelte';
import { FILTER_WAIT_MS } from './FindingsToolbar.svelte';
import { ROW_HEIGHT_PX } from './FindingsList.svelte';

/** `n` findings in line order, alternating a traceback and an SQL statement. */
function manyFindings(n: number) {
  return Array.from({ length: n }, (_, i) =>
    finding(i % 2 === 0 ? 'python-traceback' : 'sql-statement', 10 + i),
  );
}

const SHORT_LIST = [
  finding('python-traceback', 120, 134),
  finding('sql-statement', 200),
  finding('aws-access-key', 310),
];

/** The panel over app.log, scanned with the default set, holding `found`. */
async function mountScanned(found = SHORT_LIST) {
  const backend = new FindingsBackend();
  backend.addFile(APP_LOG, found, TEST_DEFAULT_IDS);
  const target = await mountFindingsPanel(backend, [APP_LOG]);
  return { backend, target };
}

function rowsOf(target: HTMLElement): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>('[role="option"], [role="treeitem"]')];
}

function scroller(target: HTMLElement): HTMLElement {
  const element = target.querySelector<HTMLElement>('[data-findings-scroller]');
  if (!element) throw new Error('no list');
  return element;
}

/** Scroll the list to `rows` rows down: jsdom does no layout, so the position is given. */
async function scrollToRow(target: HTMLElement, rows: number) {
  const element = scroller(target);
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    writable: true,
    value: rows * ROW_HEIGHT_PX,
  });
  element.dispatchEvent(new Event('scroll'));
  await settle();
}

/** The `offset` of each page request: a summary request carries none. */
function pageOffsets(backend: FindingsBackend): (string | null)[] {
  return backend
    .requestsTo('GET', '/v1/findings')
    .filter((r) => r.query.has('offset'))
    .map((r) => r.query.get('offset'));
}

let dialogs: ModalDialogHarness[] = [];

/** The height the list's scroller is laid out with; jsdom does no layout, so the test gives it. */
let scrollerHeight = 0;

/** Give every list scroller `scrollerHeight` as its height, as a browser's layout would. */
function stubScrollerHeight() {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-findings-scroller') ? scrollerHeight : 0;
    },
  });
}

/** Whether the list draws the row at `index`. */
function drawsRow(target: HTMLElement, index: number): boolean {
  return target.querySelector(`[data-index="${index}"]`) !== null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await finishScans();
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  scrollerHeight = 0;
  for (const dialog of dialogs) dialog.$destroy();
  dialogs = [];
  unmountFindingsPanels();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the findings list', () => {
  it('draws only the rows on screen of 100,000 findings, in a list as long as all of them', async () => {
    const { target } = await mountScanned(manyFindings(100_000));

    const rows = rowsOf(target);
    const list = target.querySelector('[role="listbox"]');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(60);
    expect(list?.getAttribute('style')).toContain(`height: ${100_000 * ROW_HEIGHT_PX}px`);
    expect(rows[0].getAttribute('aria-setsize')).toBe('100000');
  });

  // 1,000 px of rows of 24 px: rows 0 to 41 on screen, 8 more below.
  it('draws the rows of a list taller than its first guess as soon as it is drawn', async () => {
    scrollerHeight = 1000;
    stubScrollerHeight();

    const { target } = await mountScanned(manyFindings(FINDINGS_PAGE_SIZE));

    expect(drawsRow(target, 49)).toBe(true);
    expect(drawsRow(target, 50)).toBe(false);
  });

  it('draws more rows when the list grows taller', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    scrollerHeight = 480;
    stubScrollerHeight();
    const { target } = await mountScanned(manyFindings(FINDINGS_PAGE_SIZE));
    expect(drawsRow(target, 40)).toBe(false);

    scrollerHeight = 2000;
    window.dispatchEvent(new Event('resize'));
    await settle();

    expect(drawsRow(target, 90)).toBe(true);
  });

  it('loads the page a scroll reaches, once', async () => {
    const { backend, target } = await mountScanned(manyFindings(FINDINGS_PAGE_SIZE * 5));

    await scrollToRow(target, FINDINGS_PAGE_SIZE + 10);
    await scrollToRow(target, FINDINGS_PAGE_SIZE + 20);

    expect(pageOffsets(backend)).toEqual([String(FINDINGS_PAGE_SIZE)]);
    const first = rowsOf(target).find(
      (row) => row.dataset.index === String(FINDINGS_PAGE_SIZE + 20),
    );
    expect(first?.textContent).toContain(`LINE ${10 + FINDINGS_PAGE_SIZE + 20}`);
  });

  it("loads a signature's findings when the group view expands its header", async () => {
    const { backend, target } = await mountScanned();
    findingsBy.set('group');
    await settle();

    const header = rowsOf(target).find((row) => row.dataset.signature === 'sql-statement');
    if (!header) throw new Error('no header of sql-statement');
    await click(header);

    const query = backend.requestsTo('GET', '/v1/findings').at(-1)?.query;
    expect(query?.getAll('signature')).toEqual(['sql-statement']);
    expect(rowsOf(target).map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toContain(
      '200 SQL statement LINE 200 sql-statement',
    );
  });

  it('says how many of a capped signature it shows', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, SHORT_LIST, TEST_DEFAULT_IDS);
    backend.setCount(APP_LOG, 'python-traceback', 48_210);
    const target = await mountFindingsPanel(backend, [APP_LOG]);
    findingsBy.set('group');
    await settle();

    const text = (id: string) =>
      rowsOf(target)
        .find((row) => row.dataset.signature === id)
        ?.textContent?.replace(/\s+/g, ' ');
    expect(text('python-traceback')).toContain(`showing 1 of ${(48_210).toLocaleString()}`);
    expect(text('sql-statement')).not.toContain('showing');
  });

  it('sends the filter text as q once typing pauses', async () => {
    const { backend, target } = await mountScanned();
    const filter = target.querySelector<HTMLInputElement>('input[aria-label="Filter findings"]');
    if (!filter) throw new Error('no filter box');

    await typeInto(filter, 'timeout');
    expect(backend.requestsTo('GET', '/v1/findings').some((r) => r.query.has('q'))).toBe(false);

    await settle(FILTER_WAIT_MS);
    const withFilter = backend.requestsTo('GET', '/v1/findings').filter((r) => r.query.has('q'));
    expect(withFilter.map((r) => r.query.get('q'))).toEqual(['timeout']);
    expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
  });
});

describe('the keys of the findings list', () => {
  it('moves through the rows with ↓, ↑, Home and End, with one Tab stop', async () => {
    const { target } = await mountScanned();
    const [first] = rowsOf(target);
    first.focus();

    await keyDown(first, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-index')).toBe('1');
    await keyDown(document.activeElement as HTMLElement, { key: 'End', code: 'End' });
    expect(document.activeElement?.getAttribute('data-index')).toBe('2');
    await keyDown(document.activeElement as HTMLElement, { key: 'Home', code: 'Home' });
    expect(document.activeElement?.getAttribute('data-index')).toBe('0');
    await keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('data-index')).toBe('0');

    expect(rowsOf(target).filter((row) => row.tabIndex === 0)).toHaveLength(1);
  });

  it('opens the finding on Enter: its lines selected and the editor moved there', async () => {
    const { target } = await mountScanned();
    const [first] = rowsOf(target);
    first.focus();
    const jump = vi.spyOn(files, 'jumpToLine');

    const event = await keyDown(first, { key: 'Enter', code: 'Enter' });

    const file = get(files).openFiles.find((f) => f.path === APP_LOG);
    expect(event.defaultPrevented).toBe(true);
    expect(file?.selectedLines).toEqual([{ start: 120, end: 134 }]);
    expect(jump).toHaveBeenCalledWith(APP_LOG, 120);
    expect(rowsOf(target)[0].getAttribute('aria-selected')).toBe('true');
  });

  it('closes and opens the headers with ← and → in the group view', async () => {
    const { target } = await mountScanned();
    findingsBy.set('group');
    await settle();
    const group = rowsOf(target).find((row) => row.dataset.group === 'traceback');
    if (!group) throw new Error('no traceback group');
    group.focus();

    await keyDown(group, { key: 'ArrowLeft', code: 'ArrowLeft' });
    const closed = rowsOf(target).find((row) => row.dataset.group === 'traceback');
    expect(closed?.getAttribute('aria-expanded')).toBe('false');
    expect(rowsOf(target).some((row) => row.dataset.signature === 'python-traceback')).toBe(false);

    await keyDown(closed as HTMLElement, { key: 'ArrowRight', code: 'ArrowRight' });
    await keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight', code: 'ArrowRight' });
    const signature = document.activeElement as HTMLElement;
    expect(signature.dataset.signature).toBe('python-traceback');

    await keyDown(signature, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(signature.getAttribute('aria-expanded')).toBe('true');
    expect(
      rowsOf(target)
        .map((row) => row.textContent ?? '')
        .join('\n'),
    ).toContain('LINE 120');
  });

  it('does nothing while a modal dialog is open', async () => {
    const { target } = await mountScanned();
    const [first] = rowsOf(target);
    first.focus();
    dialogs.push(new ModalDialogHarness({ target: document.body }));
    await settle();

    const down = await keyDown(first, { key: 'ArrowDown', code: 'ArrowDown' });
    const enter = await keyDown(first, { key: 'Enter', code: 'Enter' });

    expect([down.defaultPrevented, enter.defaultPrevented]).toEqual([false, false]);
    expect(document.activeElement).toBe(first);
    expect(get(files).openFiles[0].selectedLines).toEqual([]);
  });
});

describe('a click on a finding', () => {
  it('selects its lines, moves the editor there and makes it the current row', async () => {
    const { target } = await mountScanned();
    const row = rowsOf(target)[1];

    await click(row);

    expect(get(files).openFiles[0].selectedLines).toEqual([{ start: 200, end: 200 }]);
    expect(get(files).openFiles[0].anchorLine).toBe(200);
    expect(rowsOf(target)[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(rowsOf(target)[1]);
  });
});
