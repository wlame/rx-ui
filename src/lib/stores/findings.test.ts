// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, health, settings, tree } from '$lib/stores';
import { commandLog } from '$lib/stores/commands';
import {
  FINDINGS_PAGE_SIZE,
  LINE_LIST,
  cancelScan,
  findingsByFile,
  findingsFilter,
  findingsOf,
  forgetFindings,
  loadFindingsPage,
  openFinding,
  refreshFindings,
  startScan,
} from '$lib/stores/findings';
import { loadSignatures } from '$lib/stores/signatures';
import { fileViewOf } from '$lib/viewState';
import {
  FINDINGS_DIR,
  FindingsBackend,
  TEST_DEFAULT_IDS,
  finding,
  serveFindings,
} from '$lib/testing/fakeFindings';

const APP_LOG = `${FINDINGS_DIR}/app.log`;
const WORKER_LOG = `${FINDINGS_DIR}/worker.log`;
const POLL_INTERVAL = 1000;

/** Findings of the default set on lines 10 to 10 + n - 1, alternating two signatures. */
function manyFindings(n: number) {
  return Array.from({ length: n }, (_, i) =>
    finding(i % 2 === 0 ? 'python-traceback' : 'sql-statement', 10 + i),
  );
}

/** A backend that serves signatures, with the catalogue loaded. */
async function serve(backend = new FindingsBackend()) {
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  return backend;
}

/** Let the polls and the stubbed requests settle, one poll interval at a time. */
async function settle(intervals = 2) {
  for (let i = 0; i < intervals; i++) await vi.advanceTimersByTimeAsync(POLL_INTERVAL);
}

/** Whether a findings request is the summary of every signature that each summary comes with. */
function isEverySignatureRead(query: URLSearchParams): boolean {
  return query.get('signatures') === 'all' && query.get('limit') === '1';
}

/** The query parameters of the findings requests sent so far, summaries of every signature included. */
function allFindingsQueries(backend: FindingsBackend): URLSearchParams[] {
  return backend.requestsTo('GET', '/v1/findings').map((r) => r.query);
}

/** The query parameters of the summary and page requests sent so far. */
function findingsQueries(backend: FindingsBackend): URLSearchParams[] {
  return allFindingsQueries(backend).filter((query) => !isEverySignatureRead(query));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  forgetFindings([]);
  findingsFilter.set('');
  settings.update((s) => ({ ...s, findingsPicker: null }));
  for (const file of get(files).openFiles) files.closeFile(file.path);
  commandLog.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('refreshFindings', () => {
  it('asks the cache for the default set, holds the summary and the first page of the line list', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(3), TEST_DEFAULT_IDS);

    await refreshFindings(APP_LOG);

    const [query] = findingsQueries(backend);
    expect(query.get('path')).toBe(APP_LOG);
    expect(query.has('signatures')).toBe(false);
    expect(query.get('limit')).toBe(String(FINDINGS_PAGE_SIZE));
    const state = findingsOf(get(findingsByFile), APP_LOG);
    expect(state.summary?.state).toBe('full');
    expect(state.pages.get(LINE_LIST)).toEqual(manyFindings(3));
    expect(state.error).toBeNull();
  });

  it("sends the picker's choice and the filter text", async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, [], ['sql-statement']);
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement', 'email-address'] }));
    findingsFilter.set('timeout');

    await refreshFindings(APP_LOG);

    const [query] = findingsQueries(backend);
    expect(query.get('signatures')).toBe('sql-statement,email-address');
    expect(query.get('q')).toBe('timeout');
    expect(findingsOf(get(findingsByFile), APP_LOG).summary?.missing).toEqual(['email-address']);
  });

  // The state line and the tree label speak of the file, whatever is picked.
  it("keeps the file's own summary, from every signature, and labels the file in the tree", async () => {
    const backend = await serve();
    const found = [...manyFindings(4), finding('email-address', 90), finding('email-address', 91)];
    backend.addFile(APP_LOG, found, [...TEST_DEFAULT_IDS, 'email-address']);
    await tree.loadRoots();
    await tree.toggleExpanded(FINDINGS_DIR);
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement'] }));

    await refreshFindings(APP_LOG);

    const state = findingsOf(get(findingsByFile), APP_LOG);
    expect(state.fileSummary).toEqual({ state: 'full', k: 4, m: 4, n: 6 });
    expect(state.summary?.checked).toEqual(['sql-statement']);
    expect(tree.nodeAt(APP_LOG)?.findings).toEqual({ state: 'full', count: 6 });
    expect(allFindingsQueries(backend).filter(isEverySignatureRead)).toHaveLength(1);
  });

  it('keeps the refusal of a file that is not text', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, [], [], true);

    await refreshFindings(APP_LOG);

    const state = findingsOf(get(findingsByFile), APP_LOG);
    expect(state.summary).toBeNull();
    expect(state.error).toContain('binary file');
  });

  it('asks nothing of a backend that does not serve signatures', async () => {
    const backend = await serve(new FindingsBackend({ features: [] }));

    await refreshFindings(APP_LOG);

    expect(findingsQueries(backend)).toEqual([]);
  });
});

describe('loadFindingsPage', () => {
  // A page asked while the summary of a new filter is on its way would
  // land in the list of the old one.
  it('asks no page while the summary of a new filter is on its way', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(FINDINGS_PAGE_SIZE * 3), TEST_DEFAULT_IDS);
    await refreshFindings(APP_LOG);
    const before = findingsQueries(backend).length;
    findingsFilter.set('LINE 2');
    backend.holdFindings();

    const refreshed = refreshFindings(APP_LOG);
    void loadFindingsPage(APP_LOG, LINE_LIST, 1);
    await settle(1);

    expect(
      findingsQueries(backend)
        .slice(before)
        .filter((q) => q.has('offset')),
    ).toEqual([]);
    backend.release();
    await refreshed;
    await loadFindingsPage(APP_LOG, LINE_LIST, 1);
    const pageQuery = findingsQueries(backend).find((q) => q.has('offset'));
    expect(pageQuery?.get('q')).toBe('LINE 2');
  });

  it('loads a page of the line list once, at its place in the list', async () => {
    const backend = await serve();
    const all = manyFindings(FINDINGS_PAGE_SIZE * 3);
    backend.addFile(APP_LOG, all, TEST_DEFAULT_IDS);
    await refreshFindings(APP_LOG);

    await loadFindingsPage(APP_LOG, LINE_LIST, 2);
    await loadFindingsPage(APP_LOG, LINE_LIST, 2);

    const pageQueries = findingsQueries(backend).slice(1);
    expect(pageQueries).toHaveLength(1);
    expect(pageQueries[0].get('offset')).toBe(String(FINDINGS_PAGE_SIZE * 2));
    const list = findingsOf(get(findingsByFile), APP_LOG).pages.get(LINE_LIST) ?? [];
    expect(list).toHaveLength(all.length);
    expect(list[FINDINGS_PAGE_SIZE * 2]).toEqual(all[FINDINGS_PAGE_SIZE * 2]);
    expect(list[FINDINGS_PAGE_SIZE]).toBeUndefined();
  });

  it("loads a signature's list with its id and the filter", async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(6), TEST_DEFAULT_IDS);
    findingsFilter.set('LINE 1');
    await refreshFindings(APP_LOG);

    await loadFindingsPage(APP_LOG, 'sql-statement', 0);

    const query = findingsQueries(backend)[1];
    expect(query.getAll('signature')).toEqual(['sql-statement']);
    expect(query.get('q')).toBe('LINE 1');
    const list = findingsOf(get(findingsByFile), APP_LOG).pages.get('sql-statement');
    expect(list?.map((f) => f.start_line)).toEqual([11, 13, 15]);
  });
});

describe('a scan', () => {
  it('posts the ids it is given, reports the bytes read, and reads the cache again at the end', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(2));
    await refreshFindings(APP_LOG);

    const done = startScan(APP_LOG, ['python-traceback', 'sql-statement'], false);
    await settle(1);
    const [post] = backend.requestsTo('POST', '/v1/findings');
    expect(post.body).toEqual({
      path: APP_LOG,
      signatures: 'python-traceback,sql-statement',
      force: false,
    });
    const taskId = backend.lastTask()?.id ?? '';
    backend.progress(taskId, 400, 1000);
    await settle(1);

    expect(findingsOf(get(findingsByFile), APP_LOG).scan).toEqual({
      taskId,
      read: 400,
      total: 1000,
      joined: false,
    });

    backend.complete(taskId);
    await settle();
    await done;

    const state = findingsOf(get(findingsByFile), APP_LOG);
    expect(state.scan).toBeNull();
    expect(state.scanEnd).toBeNull();
    expect(state.summary?.checked).toEqual(['python-traceback', 'sql-statement']);
    expect(get(commandLog)[0]).toMatchObject({
      command: `rx trace --signatures=python-traceback,sql-statement ${APP_LOG}`,
      action: 'findings',
    });
  });

  it('posts a rescan with force', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, [], TEST_DEFAULT_IDS);

    const done = startScan(APP_LOG, ['default'], true);
    await settle(1);
    backend.complete(backend.lastTask()?.id ?? '');
    await settle();
    await done;

    expect(backend.requestsTo('POST', '/v1/findings')[0].body).toMatchObject({
      signatures: 'default',
      force: true,
    });
  });

  it('is cancelled by a DELETE of its task, and shows that it was', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG);

    const done = startScan(APP_LOG, ['sql-statement'], false);
    await settle(1);
    const taskId = backend.lastTask()?.id ?? '';
    await cancelScan(APP_LOG);
    await settle();
    await done;

    expect(backend.requestsTo('DELETE', `/v1/tasks/${taskId}`)).toHaveLength(1);
    const state = findingsOf(get(findingsByFile), APP_LOG);
    expect(state.scan).toBeNull();
    expect(state.scanEnd).toEqual({ kind: 'cancelled' });
    expect(state.summary?.state).toBe('none');
  });

  // A 409 is a scan that ended between the click and the DELETE.
  it('reads the cache again when the DELETE finds the scan already ended', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(1));
    const done = startScan(APP_LOG, ['python-traceback'], false);
    await settle(1);
    backend.cancelConflict = true;

    const before = findingsQueries(backend).length;
    await cancelScan(APP_LOG);

    expect(findingsQueries(backend).length).toBe(before + 1);
    backend.complete(backend.lastTask()?.id ?? '');
    await settle();
    await done;
    expect(findingsOf(get(findingsByFile), APP_LOG).scanEnd).toBeNull();
  });

  it("keeps the backend's reason when it fails", async () => {
    const backend = await serve();
    backend.addFile(APP_LOG);

    const done = startScan(APP_LOG, ['sql-statement'], false);
    await settle(1);
    backend.fail(backend.lastTask()?.id ?? '', 'the file changed while it was read');
    await settle();
    await done;

    expect(findingsOf(get(findingsByFile), APP_LOG).scanEnd).toEqual({
      kind: 'failed',
      message: 'the file changed while it was read',
    });
  });

  it('starts no second scan of a file while one runs', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG);
    const done = startScan(APP_LOG, ['sql-statement'], false);
    await settle(1);

    await startScan(APP_LOG, ['sql-statement'], false);

    expect(backend.requestsTo('POST', '/v1/findings')).toHaveLength(1);
    await cancelScan(APP_LOG);
    await settle();
    await done;
  });
});

describe('a scan that joined one already running', () => {
  /** Another viewer's scan of `ids` of the file, running. */
  async function otherScan(backend: FindingsBackend, ids: string) {
    await backend.fetch('/v1/findings', {
      method: 'POST',
      body: JSON.stringify({ path: APP_LOG, signatures: ids, force: false }),
    });
    const id = backend.lastTask()?.id ?? '';
    backend.progress(id, 10, 100);
    return id;
  }

  it('posts again, once, for the signatures the joined scan left missing', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(2));
    const other = await otherScan(backend, 'python-traceback');

    const done = startScan(APP_LOG, ['python-traceback', 'sql-statement'], false);
    await settle(1);
    expect(findingsOf(get(findingsByFile), APP_LOG).scan).toMatchObject({
      taskId: other,
      joined: true,
    });
    backend.complete(other);
    await settle();
    const posts = backend.requestsTo('POST', '/v1/findings');
    expect(posts).toHaveLength(3);
    expect(posts[2].body).toMatchObject({ signatures: 'sql-statement', force: false });

    backend.complete(backend.lastTask()?.id ?? '');
    await settle();
    await done;
    expect(findingsOf(get(findingsByFile), APP_LOG).summary?.checked).toEqual(
      expect.arrayContaining(['python-traceback', 'sql-statement']),
    );
  });

  // rx-go answers a POST that joins a scan waiting for its turn with
  // that task, still queued, and a "Joined …" message.
  it('says it joined a scan that still waits for its turn', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(2));
    await backend.fetch('/v1/findings', {
      method: 'POST',
      body: JSON.stringify({ path: APP_LOG, signatures: 'python-traceback', force: false }),
    });
    const other = backend.lastTask()?.id ?? '';

    const done = startScan(APP_LOG, ['python-traceback'], false);
    await settle(1);

    expect(findingsOf(get(findingsByFile), APP_LOG).scan).toMatchObject({
      taskId: other,
      joined: true,
    });
    backend.complete(other);
    await settle();
    await done;
  });

  it('posts nothing more when the joined scan covered what was asked', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(2));
    const other = await otherScan(backend, 'python-traceback,sql-statement');

    const done = startScan(APP_LOG, ['sql-statement'], false);
    await settle(1);
    backend.complete(other);
    await settle();
    await done;

    expect(backend.requestsTo('POST', '/v1/findings')).toHaveLength(2);
  });
});

describe('a scan of a file whose tab is left or closed', () => {
  it('runs to its end, updates the tree label, and leaves the result in the cache', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, manyFindings(4));
    backend.addFile(WORKER_LOG, manyFindings(1), TEST_DEFAULT_IDS);
    await tree.loadRoots();
    await tree.toggleExpanded(FINDINGS_DIR);
    void files.openFile(APP_LOG);
    void files.openFile(WORKER_LOG);
    await settle(1);

    const done = startScan(APP_LOG, TEST_DEFAULT_IDS, false);
    await settle(1);
    const taskId = backend.lastTask()?.id ?? '';
    files.setActiveFile(WORKER_LOG);
    await refreshFindings(WORKER_LOG);
    files.closeFile(APP_LOG);
    backend.progress(taskId, 50, 100);
    await settle(1);

    expect(findingsOf(get(findingsByFile), APP_LOG).scan?.read).toBe(50);
    expect(findingsOf(get(findingsByFile), WORKER_LOG).summary?.state).toBe('full');
    expect(backend.requestsTo('DELETE', `/v1/tasks/${taskId}`)).toEqual([]);

    backend.complete(taskId);
    await settle();
    await done;

    expect(tree.nodeAt(APP_LOG)?.findings).toEqual({ state: 'full', count: 4 });
    await refreshFindings(APP_LOG);
    expect(findingsOf(get(findingsByFile), APP_LOG).summary?.state).toBe('full');
  });
});

describe('openFinding', () => {
  it('selects the lines of the finding, moves the editor to its first line and makes it current', async () => {
    await serve();
    void files.openFile(APP_LOG);
    await settle(1);
    const jump = vi.spyOn(files, 'jumpToLine');
    const found = finding('python-traceback', 120, 134);

    openFinding(APP_LOG, found);

    const file = get(files).openFiles.find((f) => f.path === APP_LOG);
    expect(file?.selectedLines).toEqual([{ start: 120, end: 134 }]);
    expect(jump).toHaveBeenCalledWith(APP_LOG, 120);
    expect(file?.scrollToLine).toBe(120);
    expect(findingsOf(get(findingsByFile), APP_LOG).currentId).toBe('python-traceback:12000');
  });

  it('puts the selected lines and the line in the link', async () => {
    await serve();
    void files.openFile(APP_LOG);
    await settle(1);

    openFinding(APP_LOG, finding('python-traceback', 120, 134));

    const file = get(files).openFiles.find((f) => f.path === APP_LOG);
    expect(fileViewOf(file)).toMatchObject({
      file: APP_LOG,
      line: 120,
      sel: [{ start: 120, end: 134, part: null }],
    });
  });
});

describe('forgetFindings', () => {
  it('drops the findings of files not kept, but never those of a running scan', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG);
    backend.addFile(WORKER_LOG);
    await refreshFindings(WORKER_LOG);
    const done = startScan(APP_LOG, ['sql-statement'], false);
    await settle(1);

    forgetFindings([]);

    expect([...get(findingsByFile).keys()]).toEqual([APP_LOG]);
    await cancelScan(APP_LOG);
    await settle();
    await done;
  });
});
