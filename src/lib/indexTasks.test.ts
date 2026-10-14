import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, tree } from './stores';
import { commandLog } from './stores/commands';
import { chainMenuItems, conflictTaskId, indexChain, indexFile, treeMenuItems } from './indexTasks';
import { ApiError } from './api';
import type { TreeNode } from './types';

const ROOT = '/var/log';
const PATH = '/var/log/app.log.gz';
const POLL_INTERVAL = 1000;

type Answer = [status: number, body: unknown];
type Handler = (body: Record<string, unknown> | undefined) => Answer;

interface Call {
  route: string;
  /** The request's query, without the `?`. */
  query: string;
  body: Record<string, unknown> | undefined;
}

/**
 * A backend answering by `METHOD /pathname`, recording every call. A
 * route with a list of answers gives them in turn and then repeats the
 * last one; an unknown route answers 404, as a missing index does.
 */
function stubBackend(routes: Record<string, Handler | Answer[]>) {
  const calls: Call[] = [];
  const served = new Map<string, number>();
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const parsed = new URL(url, 'http://localhost');
    const route = `${method} ${parsed.pathname}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ route, query: parsed.search.slice(1), body });

    const routeAnswers = routes[route];
    let answer: Answer = [404, { detail: 'Not Found' }];
    if (typeof routeAnswers === 'function') answer = routeAnswers(body);
    else if (routeAnswers) {
      const n = served.get(route) ?? 0;
      served.set(route, n + 1);
      answer = routeAnswers[Math.min(n, routeAnswers.length - 1)];
    }
    const [status, payload] = answer;
    return {
      ok: status < 400,
      status,
      statusText: String(status),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  });
  vi.stubGlobal('fetch', spy);
  return { calls, routes: () => calls.map((c) => c.route) };
}

function indexData(extra: Record<string, unknown> = {}) {
  return {
    path: PATH,
    line_index: [[1, 0]],
    line_count: 120,
    ...extra,
  };
}

const started = (taskId: string): Answer => [200, { task_id: taskId, status: 'queued' }];
const running = (taskId: string): Answer => [200, { task_id: taskId, status: 'running' }];
const completed = (taskId: string, result: unknown): Answer => [
  200,
  { task_id: taskId, status: 'completed', result },
];

function stubWindow() {
  vi.stubGlobal('window', {
    location: { href: 'http://localhost:5173/', search: '' },
    history: { replaceState: () => {} },
  });
}

/** Let the polls and the stubbed requests settle, one poll interval at a time. */
async function settle(intervals = 3) {
  for (let i = 0; i < intervals; i++) await vi.advanceTimersByTimeAsync(POLL_INTERVAL);
}

beforeEach(() => {
  vi.useFakeTimers();
  stubWindow();
});

afterEach(() => {
  for (const file of get(files).openFiles) files.closeFile(file.path);
  commandLog.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('indexFile', () => {
  // The backend answers a file under its size threshold with a 400; a
  // user who asks for an index wants one whatever the size.
  // The contract refuses a body with a member it does not name (422).
  it('asks for an index whatever the file size, with only the members the contract names', async () => {
    const backend = stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData())],
    });

    const result = indexFile(PATH, { reindex: false });
    await settle();
    await result;

    const post = backend.calls.find((c) => c.route === 'POST /v1/index');
    expect(post?.body).toEqual({ path: PATH, force: false, threshold: 0 });
  });

  // Without force the backend hands back the cached index unchanged.
  it('forces a rebuild on re-index, and asks for nothing first', async () => {
    const backend = stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData())],
    });

    const result = indexFile(PATH, { reindex: true });
    await settle();
    await result;

    const post = backend.calls.find((c) => c.route === 'POST /v1/index');
    expect(post?.body).toEqual({ path: PATH, force: true, threshold: 0 });
    expect(backend.routes()).toEqual(['POST /v1/index', 'GET /v1/tasks/t1']);
  });
});

describe('a finished task', () => {
  /** A tree with one root folder, expanded, holding the file. */
  async function loadTreeWithFile() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url, 'http://localhost').searchParams.get('path');
        const entries = path
          ? [{ name: 'app.log.gz', path: PATH, type: 'file', is_text: true, is_indexed: false }]
          : [{ name: 'log', path: ROOT, type: 'directory' }];
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ entries }) };
      }),
    );
    await tree.loadRoots();
    await tree.loadDirectory(ROOT);
  }

  function treeEntry(): TreeNode | undefined {
    return get(tree).roots[0]?.children.find((n) => n.path === PATH);
  }

  it('marks the file indexed in the tree and gives the open file its line count', async () => {
    await loadTreeWithFile();
    stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData({ line_count: 120 }))],
    });
    await files.openFile(PATH, { fileSize: 1000, isIndexed: false });

    const result = indexFile(PATH, { reindex: false });
    await settle();
    await result;

    expect(treeEntry()).toMatchObject({ is_indexed: true, line_count: 120 });
    const open = get(files).openFiles.find((f) => f.path === PATH);
    expect(open).toMatchObject({ isIndexed: true, totalLines: 120 });
  });

  it('refreshes the tree badge after a plain index', async () => {
    await loadTreeWithFile();
    stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData({ line_count: 80 }))],
    });

    const result = indexFile(PATH, { reindex: false });
    await settle();
    await result;

    expect(treeEntry()).toMatchObject({ is_indexed: true, line_count: 80 });
  });

  // The contract leaves line_count null when the index holds no count.
  it('marks the file indexed and keeps the known line count when the index has none', async () => {
    await loadTreeWithFile();
    stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData({ line_count: null }))],
    });
    await files.openFile(PATH, { fileSize: 1000, isIndexed: false });
    const linesBefore = get(files).openFiles.find((f) => f.path === PATH)?.totalLines;

    const result = indexFile(PATH, { reindex: false });
    await settle();
    await result;

    expect(treeEntry()?.is_indexed).toBe(true);
    expect(treeEntry()?.line_count ?? null).toBeNull();
    const open = get(files).openFiles.find((f) => f.path === PATH);
    expect(open).toMatchObject({ isIndexed: true, totalLines: linesBefore });
  });
});

describe('the equivalent command of an index', () => {
  it("shows the index task's command as soon as the task starts", async () => {
    stubBackend({
      'POST /v1/index': [
        [200, { task_id: 't1', status: 'queued', cli_command: `rx index ${PATH} --threshold=0` }],
      ],
      'GET /v1/tasks/t1': [running('t1'), completed('t1', indexData())],
    });

    const result = indexFile(PATH, { reindex: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(get(commandLog).map((e) => e.command)).toEqual([`rx index ${PATH} --threshold=0`]);
    expect(get(commandLog)[0].action).toBe('index');
    await settle();
    await result;
  });

  // A command recorded since the start stays the last one: the end does
  // not record the index task's command again.
  it('leaves the footer to a later answer when the index ends', async () => {
    const command = `rx index ${PATH} --threshold=0`;
    stubBackend({
      'POST /v1/index': [[200, { task_id: 't1', status: 'queued', cli_command: command }]],
      'GET /v1/tasks/t1': [running('t1'), completed('t1', indexData({ cli_command: command }))],
    });

    const result = indexFile(PATH, { reindex: false });
    await vi.advanceTimersByTimeAsync(0);
    commandLog.record(`rx samples ${PATH} --lines=1-50`, 'file');
    await settle();
    await result;

    expect(get(commandLog).map((e) => e.command)).toEqual([
      `rx samples ${PATH} --lines=1-50`,
      command,
    ]);
  });

  it('records the command of the index it built when the start named none', async () => {
    stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData({ cli_command: `rx index ${PATH}` }))],
    });

    const result = indexFile(PATH, { reindex: false });
    await settle();
    await result;

    expect(get(commandLog)[0]).toMatchObject({ command: `rx index ${PATH}`, action: 'index' });
  });

  it('shows the command of the running task a 409 names', async () => {
    stubBackend({
      'POST /v1/index': [[409, { detail: 'Already indexing (task: t9)', task_id: 't9' }]],
      'GET /v1/tasks/t9': [
        [200, { task_id: 't9', status: 'running', cli_command: `rx index ${PATH}` }],
        completed('t9', indexData({ cli_command: `rx index ${PATH}` })),
      ],
    });

    const result = indexFile(PATH, { reindex: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(get(commandLog)[0]).toMatchObject({ command: `rx index ${PATH}`, action: 'index' });
    await settle();
    await result;
  });
});

describe('treeMenuItems', () => {
  const file = { type: 'file', is_text: true, is_compressed: false, is_indexed: false } as const;
  const folder = { ...file, type: 'directory', is_text: null } as const;
  const scans = { canScanFindings: true, hasFolderTask: false };
  const labelsOf = (items: { label: string }[]) => items.map((i) => i.label);

  // rx-go refuses to index or scan a file that is not text (400).
  it('offers nothing on a file that is not text', () => {
    expect(treeMenuItems({ ...file, is_text: false })).toEqual([]);
    expect(treeMenuItems({ ...file, is_text: false }, scans)).toEqual([]);
  });

  it.each([
    [false, false, 'Index'],
    [false, true, 'Re-index'],
    [true, false, 'Index'],
    [true, true, 'Re-index'],
  ])(
    'offers an index item on a text file, compressed=%s indexed=%s: %s',
    (isCompressed, isIndexed, label) => {
      const entry = { ...file, is_compressed: isCompressed, is_indexed: isIndexed };
      expect(labelsOf(treeMenuItems(entry))).toEqual([label]);
    },
  );

  it('offers Scan for findings first on a text file of a backend that scans', () => {
    expect(labelsOf(treeMenuItems(file, scans))).toEqual(['Scan for findings', 'Index']);
    expect(treeMenuItems({ ...file, is_text: null }, scans).map((i) => i.action)).toEqual([
      'scanFindings',
      'index',
    ]);
  });

  it('offers to index and scan every file of a folder', () => {
    expect(labelsOf(treeMenuItems(folder, scans))).toEqual([
      'Index all files',
      'Scan all files for findings',
    ]);
    expect(treeMenuItems(folder, scans).map((i) => i.action)).toEqual([
      'indexFolder',
      'scanFolder',
    ]);
  });

  it('offers no folder scan on a backend that does not scan', () => {
    expect(labelsOf(treeMenuItems(folder))).toEqual(['Index all files']);
  });

  it('offers only Stop on a folder whose task runs', () => {
    const items = treeMenuItems(folder, { ...scans, hasFolderTask: true });
    expect(items).toEqual([{ action: 'stopFolder', label: 'Stop' }]);
  });
});

describe('chainMenuItems', () => {
  // Findings are per file: a chain is not scanned.
  it('offers no scan on a log chain', () => {
    const items = chainMenuItems({ is_indexed: false, too_many_parts: false });
    expect(items.map((i) => i.action)).not.toContain('scanFindings');
  });

  const chain = { is_indexed: false, too_many_parts: false };

  it.each([
    [false, 'Index'],
    [true, 'Re-index'],
  ])('offers an index item on a chain indexed=%s', (isIndexed, label) => {
    expect(chainMenuItems({ ...chain, is_indexed: isIndexed }).map((i) => i.label)).toEqual([
      label,
    ]);
  });

  // The backend reads no chain of more than 10,000 parts.
  it('offers nothing on a chain of too many parts', () => {
    expect(chainMenuItems({ ...chain, too_many_parts: true })).toEqual([]);
  });
});

describe('indexChain', () => {
  const HANDLE = `${ROOT}/app.log`;
  const COMMAND = `rx logs index ${HANDLE}`;
  const chainResult = { path: HANDLE, built: ['app.log.1', 'app.log'], cli_command: COMMAND };
  /** A chain's description, as a 409 carries it. */
  const description = { path: HANDLE, fingerprint: '00000000000000a1', parts: [] };

  /** Spies on what shows a built chain: its row, its parts' rows and its open tab. */
  function spyOnTree() {
    return {
      refreshChains: vi.spyOn(tree, 'refreshChains').mockResolvedValue(undefined),
      markIndexed: vi.spyOn(tree, 'markIndexed'),
      refreshChain: vi.spyOn(files, 'refreshChain').mockResolvedValue(undefined),
    };
  }

  afterEach(() => vi.restoreAllMocks());

  it("starts the chain's index task, follows it to its end and records its command", async () => {
    const backend = stubBackend({
      'POST /v1/logs/index': [started('c1')],
      'GET /v1/tasks/c1': [running('c1'), completed('c1', chainResult)],
    });
    spyOnTree();

    const outcome = indexChain(HANDLE, { reindex: false });
    await settle();

    await expect(outcome).resolves.toEqual({ kind: 'completed' });
    const post = backend.calls.find((c) => c.route === 'POST /v1/logs/index');
    expect(new URLSearchParams(post?.query).get('path')).toBe(HANDLE);
    expect(new URLSearchParams(post?.query).has('force')).toBe(false);
    expect(get(commandLog)[0]).toMatchObject({ command: COMMAND, action: 'index' });
  });

  it('forces a rebuild of every part on re-index', async () => {
    const backend = stubBackend({
      'POST /v1/logs/index': [started('c1')],
      'GET /v1/tasks/c1': [completed('c1', chainResult)],
    });
    spyOnTree();

    const outcome = indexChain(HANDLE, { reindex: true });
    await settle();
    await outcome;

    const post = backend.calls.find((c) => c.route === 'POST /v1/logs/index');
    expect(new URLSearchParams(post?.query).get('force')).toBe('true');
  });

  it('lists the chains of its folder again, marks the parts it built and describes its tab', async () => {
    stubBackend({
      'POST /v1/logs/index': [started('c1')],
      'GET /v1/tasks/c1': [completed('c1', chainResult)],
    });
    const spies = spyOnTree();

    const outcome = indexChain(HANDLE, { reindex: false });
    await settle();
    await outcome;

    expect(spies.refreshChains).toHaveBeenCalledWith(ROOT);
    expect(spies.refreshChain).toHaveBeenCalledWith(HANDLE);
    expect(spies.markIndexed.mock.calls).toEqual([
      [`${ROOT}/app.log.1`, null],
      [`${ROOT}/app.log`, null],
    ]);
  });

  it("rejects with the task's error when it fails", async () => {
    stubBackend({
      'POST /v1/logs/index': [started('c1')],
      'GET /v1/tasks/c1': [
        [200, { task_id: 'c1', status: 'failed', error: 'app.log.1: no space' }],
      ],
    });
    spyOnTree();

    const outcome = indexChain(HANDLE, { reindex: false });
    const settled = expect(outcome).rejects.toThrow('app.log.1: no space');
    await settle();
    await settled;
  });

  // The backend keeps a finished task for a while only; once it is
  // gone the listing says what the task left.
  it('reads a task gone after it was seen as ended, and lists the chains again', async () => {
    stubBackend({
      'POST /v1/logs/index': [started('c1')],
      'GET /v1/tasks/c1': [running('c1'), [404, { detail: 'Task not found' }]],
    });
    const spies = spyOnTree();

    const outcome = indexChain(HANDLE, { reindex: false });
    await settle();

    await expect(outcome).resolves.toEqual({ kind: 'ended' });
    expect(spies.refreshChains).toHaveBeenCalledWith(ROOT);
  });

  it('follows one task when asked twice while it runs', async () => {
    const backend = stubBackend({
      'POST /v1/logs/index': [started('c1')],
      'GET /v1/tasks/c1': [running('c1'), completed('c1', chainResult)],
    });
    spyOnTree();

    const first = indexChain(HANDLE, { reindex: false });
    const second = indexChain(HANDLE, { reindex: false });
    await settle();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(backend.routes().filter((r) => r === 'POST /v1/logs/index')).toHaveLength(1);
  });

  // A part replaced while the backend read the chain answers 409.
  it('asks once more when the files changed under the request', async () => {
    const backend = stubBackend({
      'POST /v1/logs/index': [[409, description], started('c1')],
      'GET /v1/tasks/c1': [completed('c1', chainResult)],
    });
    spyOnTree();

    const outcome = indexChain(HANDLE, { reindex: false });
    await settle();

    await expect(outcome).resolves.toEqual({ kind: 'completed' });
    expect(backend.routes().filter((r) => r === 'POST /v1/logs/index')).toHaveLength(2);
  });

  it('gives up when the files changed under the request twice', async () => {
    stubBackend({ 'POST /v1/logs/index': [[409, description]] });
    spyOnTree();

    await expect(indexChain(HANDLE, { reindex: false })).rejects.toThrow('keep changing');
  });
});

describe('conflictTaskId', () => {
  it('reads a structured task id from the error body', () => {
    const error = new ApiError(
      409,
      'Conflict',
      'Indexing already in progress',
      JSON.stringify({ detail: 'Indexing already in progress', task_id: 'abc-123' }),
    );
    expect(conflictTaskId(error)).toBe('abc-123');
  });

  it('falls back to the task id in the prose', () => {
    const detail = `Indexing already in progress for ${PATH} (task: ef20b52b-1790-4020)`;
    const error = new ApiError(409, 'Conflict', detail, JSON.stringify({ detail }));
    expect(conflictTaskId(error)).toBe('ef20b52b-1790-4020');
  });

  it('finds nothing in a 409 that names no task', () => {
    const error = new ApiError(409, 'Conflict', 'Busy', '{"detail":"Busy"}');
    expect(conflictTaskId(error)).toBeNull();
  });

  it('finds nothing in an error that is not a 409', () => {
    const error = new ApiError(400, 'Bad Request', '(task: abc)', '{"detail":"(task: abc)"}');
    expect(conflictTaskId(error)).toBeNull();
  });
});
