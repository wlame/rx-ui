// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, settings, tree } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { findingsByFile, findingsOf } from '$lib/stores/findings';
import { findingsBy, findingsFocusRequested, sidebarTab } from '$lib/stores/layout';
import {
  FINDINGS_DIR,
  FindingsBackend,
  TEST_DEFAULT_IDS,
  finding,
} from '$lib/testing/fakeFindings';
import {
  APP_LOG,
  POLL_INTERVAL_MS,
  WORKER_LOG,
  buttonNamed,
  click,
  finishScans,
  mountFindingsPanel,
  settle,
  unmountFindingsPanels,
} from '$lib/testing/findingsPanel';

/** Three findings of the default set in app.log. */
const APP_FINDINGS = [
  finding('python-traceback', 120, 134),
  finding('sql-statement', 200),
  finding('python-traceback', 402, 415),
];

function stateText(target: HTMLElement): string {
  return target.querySelector('[data-findings-state]')?.textContent?.trim() ?? '';
}

function noticeText(target: HTMLElement): string {
  return (
    target.querySelector('[data-findings-notice]')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  );
}

function scanButton(target: HTMLElement): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>('button[data-scan]');
  if (!button) throw new Error('no scan button');
  return button;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await finishScans();
  unmountFindingsPanels();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the findings panel states', () => {
  it('says a file is not scanned and offers a large Scan button with the picker summary', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS);

    const target = await mountFindingsPanel(backend, [APP_LOG]);

    expect(stateText(target)).toBe('not scanned');
    expect(buttonNamed(target, 'Scan with Default (4)')).toBeDefined();
    expect(scanButton(target).textContent?.trim()).toBe('Scan 4 missing');
  });

  it('counts the signatures checked of a partly scanned file', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS, ['python-traceback']);

    const target = await mountFindingsPanel(backend, [APP_LOG]);

    expect(stateText(target)).toBe('partial · 1 of 4 default signatures · 2 findings');
    expect(target.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  // The state line and the tree label speak of the file: the label counts
  // every current entry, opt-in ones included.
  it('counts the findings of opt-in signatures in the cache, as the tree label does', async () => {
    const backend = new FindingsBackend();
    const found = [...APP_FINDINGS, finding('email-address', 500), finding('email-address', 501)];
    backend.addFile(APP_LOG, found, [...TEST_DEFAULT_IDS, 'email-address']);

    const target = await mountFindingsPanel(backend, [APP_LOG]);

    expect(stateText(target)).toBe('full · 5 findings');
    expect(tree.nodeAt(APP_LOG)?.findings).toEqual({ state: 'full', count: 5 });
    expect(target.querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it('speaks of the default signatures when only opt-in ones are picked and scanned', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, [finding('email-address', 7)], ['email-address', 'phone-number']);
    settings.update((s) => ({ ...s, findingsPicker: ['email-address', 'phone-number'] }));

    const target = await mountFindingsPanel(backend, [APP_LOG]);

    expect(stateText(target)).toBe('partial · 0 of 4 default signatures · 1 finding');
    expect(scanButton(target).textContent?.trim()).toBe('Up to date');
    expect(target.textContent).not.toContain('2 of 2');
  });

  it('counts the findings of a fully scanned file and lists them by line', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS, TEST_DEFAULT_IDS);

    const target = await mountFindingsPanel(backend, [APP_LOG]);

    expect(stateText(target)).toBe('full · 3 findings');
    expect(scanButton(target).textContent?.trim()).toBe('Up to date');
    expect(scanButton(target).disabled).toBe(true);
    const rows = [...target.querySelectorAll('[role="option"]')];
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '120–134 Python traceback LINE 120 python-traceback',
      '200 SQL statement LINE 200 sql-statement',
      '402–415 Python traceback LINE 402 python-traceback',
    ]);
  });

  it('says so on a backend without signatures, and asks it nothing', async () => {
    const backend = new FindingsBackend({ features: [] });
    backend.addFile(APP_LOG, APP_FINDINGS);

    const target = await mountFindingsPanel(backend, [APP_LOG]);

    expect(noticeText(target)).toBe('This backend does not scan files for findings.');
    expect(backend.requestsTo('GET', '/v1/findings')).toEqual([]);
  });

  it('says findings are per file on a log chain tab', async () => {
    const backend = new FindingsBackend({ features: ['signatures', 'log_chains'] });
    const target = await mountFindingsPanel(backend);
    chainMode.set(true);

    void files.openChain(`${FINDINGS_DIR}/app.log`);
    await settle();

    expect(noticeText(target)).toBe('Findings are per file. Open a part of the chain to scan it.');
    expect(backend.requestsTo('GET', '/v1/findings')).toEqual([]);
  });

  it('says a file that is not text has no findings', async () => {
    const backend = new FindingsBackend();
    backend.addFile(`${FINDINGS_DIR}/core.bin`, [], [], true);
    const target = await mountFindingsPanel(backend);

    void files.openFile(`${FINDINGS_DIR}/core.bin`);
    await settle();

    expect(noticeText(target)).toBe('core.bin is not text, so it has no findings.');
    expect(backend.requestsTo('GET', '/v1/findings')).toEqual([]);
  });

  it('asks the user to open a file when none is open', async () => {
    const target = await mountFindingsPanel(new FindingsBackend());

    expect(noticeText(target)).toBe('Open a file to list its findings.');
  });

  it('asks nothing while the panel is not shown, and asks once it is', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS);
    await mountFindingsPanel(backend);
    sidebarTab.set('tree');
    await settle();

    void files.openFile(APP_LOG);
    await settle();
    expect(backend.requestsTo('GET', '/v1/findings')).toEqual([]);

    sidebarTab.set('findings');
    await settle();
    const asked = backend.requestsTo('GET', '/v1/findings').map((r) => r.query.get('signatures'));
    expect(asked).toEqual([null, 'all']);
  });
});

describe('the scan button', () => {
  it('posts only the missing signatures of the selection', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS, ['python-traceback']);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    expect(scanButton(target).textContent?.trim()).toBe('Scan 3 missing');
    await click(scanButton(target));

    expect(backend.requestsTo('POST', '/v1/findings')[0].body).toEqual({
      path: APP_LOG,
      signatures: 'java-exception,aws-access-key,sql-statement',
      force: false,
    });
  });

  it('rescans the selection with force from the more menu', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS, TEST_DEFAULT_IDS);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    await click(buttonNamed(target, 'More scan actions'));
    await click(buttonNamed(target, 'Rescan'));

    expect(backend.requestsTo('POST', '/v1/findings')[0].body).toEqual({
      path: APP_LOG,
      signatures: 'default',
      force: true,
    });
  });

  it('offers Copy all and the lines before each finding in the more menu, one before by default', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS, TEST_DEFAULT_IDS);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    await click(buttonNamed(target, 'More scan actions'));

    const select = target.querySelector<HTMLSelectElement>(
      'select[aria-label="Lines before each finding"]',
    );
    expect(buttonNamed(target, 'Copy all')).toBeDefined();
    expect([...(select?.options ?? [])].map((o) => o.value)).toEqual(['0', '1', '2', '3']);
    expect(select?.value).toBe('1');
  });

  it('shows the bytes read and a Cancel that stops the scan and says so', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    await click(scanButton(target));
    const taskId = backend.lastTask()?.id ?? '';
    backend.progress(taskId, 250, 1000);
    await settle(POLL_INTERVAL_MS);

    const bar = target.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('25');
    await click(buttonNamed(target, 'Cancel'));
    await settle(POLL_INTERVAL_MS);

    expect(backend.requestsTo('DELETE', `/v1/tasks/${taskId}`)).toHaveLength(1);
    expect(target.querySelector('[role="progressbar"]')).toBeNull();
    expect(target.querySelector('[data-scan-end]')?.textContent?.trim()).toBe('Scan cancelled.');
  });

  it('says the file changed while it was scanned when the cache kept nothing of the scan', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    await click(buttonNamed(target, 'Scan with Default (4)'));
    backend.completeUnkept(backend.lastTask()?.id ?? '');
    await settle(POLL_INTERVAL_MS);
    await settle(POLL_INTERVAL_MS);

    expect(stateText(target)).toBe('not scanned');
    expect(target.querySelector('[data-scan-end]')?.textContent?.trim()).toBe(
      'The file changed while it was scanned, so its findings were not kept. ' +
        'Scan again when it is quiet.',
    );
  });

  it('reads the cache again when the scan completes, and lists what it found', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    await click(buttonNamed(target, 'Scan with Default (4)'));
    backend.complete(backend.lastTask()?.id ?? '');
    await settle(POLL_INTERVAL_MS);
    await settle(POLL_INTERVAL_MS);

    expect(stateText(target)).toBe('full · 3 findings');
    expect(target.querySelectorAll('[role="option"]')).toHaveLength(3);
  });
});

describe('a scan while another tab is shown', () => {
  it("shows the other tab's state, and the scan of the first one runs on", async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS);
    backend.addFile(WORKER_LOG, [finding('sql-statement', 3)], TEST_DEFAULT_IDS);
    const target = await mountFindingsPanel(backend, [WORKER_LOG, APP_LOG]);
    await click(scanButton(target));
    const taskId = backend.lastTask()?.id ?? '';

    files.setActiveFile(WORKER_LOG);
    await settle();
    backend.progress(taskId, 500, 1000);
    await settle(POLL_INTERVAL_MS);

    expect(stateText(target)).toBe('full · 1 finding');
    expect(target.querySelector('[role="progressbar"]')).toBeNull();
    expect(findingsOf(get(findingsByFile), APP_LOG).scan?.read).toBe(500);

    files.closeFile(APP_LOG);
    backend.complete(taskId);
    await settle(POLL_INTERVAL_MS);
    await settle(POLL_INTERVAL_MS);

    expect(backend.requestsTo('DELETE', `/v1/tasks/${taskId}`)).toEqual([]);
    expect(tree.nodeAt(APP_LOG)?.findings).toEqual({ state: 'full', count: 3 });

    void files.openFile(APP_LOG);
    await settle();
    expect(stateText(target)).toBe('full · 3 findings');
  });

  it("shows the first tab's progress again when it comes back", async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS);
    backend.addFile(WORKER_LOG, [], TEST_DEFAULT_IDS);
    const target = await mountFindingsPanel(backend, [WORKER_LOG, APP_LOG]);
    await click(scanButton(target));
    const taskId = backend.lastTask()?.id ?? '';

    files.setActiveFile(WORKER_LOG);
    await settle();
    backend.progress(taskId, 700, 1000);
    await settle(POLL_INTERVAL_MS);
    files.setActiveFile(APP_LOG);
    await settle();

    expect(target.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('70');
    backend.complete(taskId);
    await settle(POLL_INTERVAL_MS);
  });
});

describe('the order switch', () => {
  it('lists the findings by group and back, as the URL names it', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS, TEST_DEFAULT_IDS);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    await click(buttonNamed(target, 'By group'));

    expect(get(findingsBy)).toBe('group');
    expect(target.querySelector('[role="tree"]')).not.toBeNull();
    expect(target.querySelector('[role="listbox"]')).toBeNull();

    await click(buttonNamed(target, 'By line'));
    expect(get(findingsBy)).toBe('line');
  });
});

describe('the focus request of the panel key', () => {
  it('focuses the current row of the list, or the first row', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, APP_FINDINGS, TEST_DEFAULT_IDS);
    const target = await mountFindingsPanel(backend, [APP_LOG]);

    findingsFocusRequested.set(true);
    await settle();

    expect(document.activeElement).toBe(target.querySelector('[role="option"]'));
    expect(get(findingsFocusRequested)).toBe(false);
  });
});
