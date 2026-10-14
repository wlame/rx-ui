import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { FakeChain } from '../testing/fakeChain';
import { CHAIN_NAMES, LOG_DIR, LOG_ROOT, LogDirBackend, serveLogDir } from '../testing/fakeLogDir';
import { TreeDirBackend, serveTreeDir } from '../testing/fakeTreeDir';
import { isChainRow, shownChildren } from '../utils/chainTree';
import { DEFAULT_SORT } from '../utils/treeSort';
import { chainMode } from './chainMode';
import { health } from './health';
import { MAX_DESCRIBED_CHAINS, holdsPath, tree } from './tree';

/** A tree entry for a directory or a file under `path`. */
function entry(path: string, type: 'directory' | 'file') {
  return {
    path,
    name: path.split('/').pop(),
    type,
    children_count: null,
    compression_format: null,
    is_compressed: null,
    is_indexed: null,
    is_text: null,
    line_count: null,
    modified_at: null,
    size: null,
    size_human: null,
  };
}

/**
 * Answers `/v1/tree`: the given roots, each holding one folder and one
 * file. One root, `/logs`, by default.
 */
function serveTree(roots: string[] = ['/logs']) {
  const spy = vi.fn(async (url: string) => {
    const path = new URL(url, 'http://localhost').searchParams.get('path');
    const entries =
      path === null
        ? roots.map((root) => entry(root, 'directory'))
        : [entry(`${path}/app`, 'directory'), entry(`${path}/a.log`, 'file')];
    const body = {
      path: path ?? '',
      parent: null,
      is_search_root: path === null,
      entries,
      total_entries: entries.length,
      total_size: null,
      total_size_human: null,
    };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('the tree when the Files panel is shown again', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the expanded folders and asks for nothing', async () => {
    const fetchSpy = serveTree();
    await tree.ensureRoots();
    await tree.toggleExpanded('/logs/app');
    const callsBefore = fetchSpy.mock.calls.length;

    await tree.ensureRoots();

    expect(tree.nodeAt('/logs')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/a.log')).not.toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('loads the roots the first time', async () => {
    serveTree();
    await tree.loadRoots();
    expect(get(tree).roots.map((root) => root.path)).toEqual(['/logs']);
  });

  it('opens every root folder on the first load', async () => {
    serveTree(['/logs', '/srv']);
    await tree.loadRoots();

    for (const root of ['/logs', '/srv']) {
      expect(tree.nodeAt(root)?.expanded).toBe(true);
      expect(tree.nodeAt(`${root}/a.log`)).not.toBeNull();
    }
    // Only the roots open: their folders stay closed until clicked.
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(false);
  });
});

describe('the tree opening and closing a folder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads and opens a folder on expand, and closes it on collapse', async () => {
    serveTree();
    await tree.loadRoots();

    await tree.expand('/logs/app');
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/app/a.log')).not.toBeNull();

    tree.collapse('/logs/app');
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(false);
    expect(tree.nodeAt('/logs/app/a.log')).not.toBeNull();
  });

  it('asks once for a folder that expand meets while its rows load', async () => {
    const backend = new LogDirBackend({ features: [] });
    serveLogDir(backend);
    await tree.loadRoots();
    backend.hold('/v1/tree');

    const first = tree.expand(LOG_DIR);
    expect(tree.nodeAt(LOG_DIR)?.loading).toBe(true);
    const second = tree.expand(LOG_DIR);
    backend.release();
    await Promise.all([first, second]);

    expect(
      backend.requestsTo('/v1/tree').filter((r) => r === listed('/v1/tree', LOG_DIR)),
    ).toHaveLength(1);
    expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(true);
  });

  it('leaves an open folder open on expand and a closed one closed on collapse', async () => {
    const fetchSpy = serveTree();
    await tree.loadRoots();
    const calls = fetchSpy.mock.calls.length;

    await tree.expand('/logs');
    tree.collapse('/logs/app');

    expect(tree.nodeAt('/logs')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(false);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });
});

/** The request of `pathname` for the directory `dir`, as the backend records it. */
function listed(pathname: string, dir: string): string {
  return `${pathname}?path=${encodeURIComponent(dir)}`;
}

/** The names of the chains a directory shows in chain mode. */
function chainNamesShown(dir: string): string[] {
  const node = tree.nodeAt(dir);
  if (!node) throw new Error(`${dir} is not in the tree`);
  return shownChildren(node, { chainModeOn: true, sort: DEFAULT_SORT })
    .filter(isChainRow)
    .map((row) => row.chain.name);
}

describe('the tree in chain mode', () => {
  let backend: LogDirBackend;

  /** Serve the log directory, set the mode, and load the roots. */
  async function start(
    mode: boolean,
    options: ConstructorParameters<typeof LogDirBackend>[0] = {},
  ) {
    backend = new LogDirBackend(options);
    serveLogDir(backend);
    await health.check();
    chainMode.set(mode);
    await tree.loadRoots();
  }

  afterEach(() => {
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  it('asks for a directory and its chains at the same time, and shows the chains', async () => {
    await start(true);
    backend.hold('/v1/tree');
    backend.hold('/v1/logs/chains');

    const loading = tree.toggleExpanded(LOG_DIR);
    await vi.waitFor(() => {
      expect(backend.requests).toContain(listed('/v1/tree', LOG_DIR));
      expect(backend.requests).toContain(listed('/v1/logs/chains', LOG_DIR));
    });
    backend.release();
    await loading;

    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
    expect(tree.nodeAt(LOG_DIR)?.children).toHaveLength(70);
  });

  it('asks for no chains with the mode off', async () => {
    await start(false);

    await tree.toggleExpanded(LOG_DIR);

    expect(backend.requestsTo('/v1/logs/chains')).toEqual([]);
    expect(tree.nodeAt(LOG_DIR)?.chains).toBeUndefined();
  });

  it('lists the chains of every expanded folder on screen when the mode turns on, and collapses none', async () => {
    await start(false);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(`${LOG_DIR}/pkgcache`);

    chainMode.set(true);
    await vi.waitFor(() => expect(tree.nodeAt(LOG_DIR)?.chains).toBeDefined());

    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
    expect([...backend.requestsTo('/v1/logs/chains')].sort()).toEqual(
      [LOG_ROOT, LOG_DIR, `${LOG_DIR}/pkgcache`]
        .map((dir) => listed('/v1/logs/chains', dir))
        .sort(),
    );
    expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(true);
    expect(tree.nodeAt(`${LOG_DIR}/pkgcache`)?.expanded).toBe(true);
  });

  // A folder the panel does not show is listed when it is shown again.
  it('lists no chains of a collapsed folder when the mode turns on, and lists them when it is expanded', async () => {
    await start(false);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(LOG_DIR);

    chainMode.set(true);
    await vi.waitFor(() => expect(tree.nodeAt(LOG_ROOT)?.chains).toBeDefined());

    expect(backend.requestsTo('/v1/logs/chains')).toEqual([listed('/v1/logs/chains', LOG_ROOT)]);
    expect(tree.nodeAt(LOG_DIR)?.chains).toBeUndefined();

    await tree.toggleExpanded(LOG_DIR);

    expect(backend.requestsTo('/v1/logs/chains')).toContain(listed('/v1/logs/chains', LOG_DIR));
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
  });

  // An expanded folder inside a collapsed one is not on screen either; it
  // is listed when its parent is expanded.
  it('lists the chains of an expanded folder inside a collapsed one when the parent is expanded', async () => {
    const pkgcache = `${LOG_DIR}/pkgcache`;
    await start(false);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(pkgcache);
    await tree.toggleExpanded(LOG_DIR);

    chainMode.set(true);
    await vi.waitFor(() => expect(tree.nodeAt(LOG_ROOT)?.chains).toBeDefined());

    expect(backend.requestsTo('/v1/logs/chains')).toEqual([listed('/v1/logs/chains', LOG_ROOT)]);

    await tree.toggleExpanded(LOG_DIR);

    expect([...backend.requestsTo('/v1/logs/chains')].sort()).toEqual(
      [LOG_ROOT, LOG_DIR, pkgcache].map((dir) => listed('/v1/logs/chains', dir)).sort(),
    );
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
  });

  it('keeps the folders and the listed chains through the mode turning off and on', async () => {
    await start(true);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(`${LOG_DIR}/pkgcache`);
    const asked = backend.requestsTo('/v1/logs/chains').length;

    chainMode.set(false);
    chainMode.set(true);
    await Promise.resolve();

    expect(tree.nodeAt(`${LOG_DIR}/pkgcache`)?.expanded).toBe(true);
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
    expect(backend.requestsTo('/v1/logs/chains')).toHaveLength(asked);
  });

  it('lists the chains of a folder whose load began before the mode turned on', async () => {
    await start(false);
    backend.hold('/v1/tree');
    const loading = tree.toggleExpanded(LOG_DIR);
    await vi.waitFor(() => expect(backend.requests).toContain(listed('/v1/tree', LOG_DIR)));

    chainMode.set(true);
    backend.release();
    await loading;

    await vi.waitFor(() => expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES));
  });

  // A refused listing must not hide the tree, nor any file of the folder.
  it('shows every file of a folder whose chains cannot be listed, and no error', async () => {
    await start(true, { chainsStatus: 403 });

    await tree.toggleExpanded(LOG_DIR);

    expect(tree.nodeAt(LOG_DIR)?.chains).toBeUndefined();
    expect(tree.nodeAt(LOG_DIR)?.children).toHaveLength(70);
    expect(get(tree).error).toBeNull();
    expect(get(tree).roots).toHaveLength(1);
  });

  it('lists the chains of a folder again on request', async () => {
    await start(true);
    await tree.toggleExpanded(LOG_DIR);
    const asked = () =>
      backend.requests.filter((r) => r === listed('/v1/logs/chains', LOG_DIR)).length;
    const before = asked();

    await tree.refreshChains(LOG_DIR);

    expect(asked()).toBe(before + 1);
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
  });

  it('keeps the state and reasons a description gives, and its idx', async () => {
    await start(true);
    await tree.toggleExpanded(LOG_DIR);
    const handle = `${LOG_DIR}/pkg.log`;
    const reasons = [{ code: 'overlap', message: 'they overlap', overlap_ms: 5, parts: [] }];
    const described = new FakeChain({
      dir: LOG_DIR,
      name: 'pkg.log',
      parts: [
        { name: 'pkg.log.1', lines: 10 },
        { name: 'pkg.log', lines: 5, isActive: true },
      ],
      state: 'ready',
    }).description();

    tree.noteChainDescription({ ...described, state: 'invalid', reasons: reasons as never });

    expect(get(tree).describedChains.get(handle)).toEqual({ state: 'invalid', reasons });
    const entry = tree.nodeAt(LOG_DIR)?.chains?.find((c) => c.path === handle);
    expect(entry?.is_indexed).toBe(true);
  });

  it('keeps what the latest descriptions said, up to its limit', async () => {
    await start(true);
    const describe = (n: number) =>
      new FakeChain({
        dir: '/many',
        name: `c${n}.log`,
        parts: [{ name: `c${n}.log`, lines: 1, isActive: true }],
      }).description();

    for (let n = 0; n <= MAX_DESCRIBED_CHAINS; n++) tree.noteChainDescription(describe(n));

    const described = get(tree).describedChains;
    expect(described.size).toBe(MAX_DESCRIBED_CHAINS);
    expect(described.has('/many/c0.log')).toBe(false);
    expect(described.has(`/many/c${MAX_DESCRIBED_CHAINS}.log`)).toBe(true);
  });
});

describe('the tree read again by its refresh', () => {
  const ROOT = '/logs';
  const APP_LOG = `${ROOT}/app.log`;
  const SUB = `${ROOT}/sub`;
  let backend: TreeDirBackend;

  /**
   * The tree over a backend holding `/logs` with `app.log`, `old.log`,
   * the folder `sub` (holding `x.log`) and the folder `closed` (holding
   * the folder `inner`), with `sub` open.
   */
  async function openTree(features: string[] = []) {
    backend = new TreeDirBackend([ROOT], { features });
    backend.add(APP_LOG, 'file', { size: 100, modified_at: '2026-10-12T08:00:00Z' });
    backend.add(`${ROOT}/old.log`, 'file', { size: 10 });
    backend.add(SUB, 'directory');
    backend.add(`${SUB}/x.log`, 'file');
    backend.add(`${ROOT}/closed`, 'directory');
    backend.add(`${ROOT}/closed/inner`, 'directory');
    serveTreeDir(backend);
    await health.check();
    await tree.loadRoots();
    await tree.expand(SUB);
  }

  /** The names of the rows the tree holds in the folder at `path`. */
  function namesIn(path: string): string[] {
    return tree.nodeAt(path)?.children.map((child) => child.name) ?? [];
  }

  /** The folders whose listing was asked from now on. */
  function listingsFromNow(): () => string[] {
    const before = backend.listingsAsked().length;
    return () => backend.listingsAsked().slice(before);
  }

  afterEach(() => {
    chainMode.set(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a file created in an open folder, drops a deleted one and shows a new size, date and labels', async () => {
    await openTree();
    backend.add(`${ROOT}/new.log`, 'file', { size: 5 });
    backend.add(`${SUB}/y.log`, 'file');
    backend.remove(`${ROOT}/old.log`);
    const grown = {
      size: 250,
      modified_at: '2026-10-12T08:00:05Z',
      is_indexed: true,
      findings: { state: 'partial' as const, count: 3 },
    };
    backend.change(APP_LOG, grown);

    await tree.refreshOpenFolders();

    expect(namesIn(ROOT)).toEqual(['app.log', 'closed', 'new.log', 'sub']);
    expect(namesIn(SUB)).toEqual(['x.log', 'y.log']);
    expect(tree.nodeAt(APP_LOG)).toMatchObject(grown);
  });

  it('asks once for each open folder on screen, and not for a closed one nor an open one inside it', async () => {
    await openTree();
    await tree.expand(`${ROOT}/closed`);
    await tree.expand(`${ROOT}/closed/inner`);
    tree.collapse(`${ROOT}/closed`);
    const asked = listingsFromNow();

    await tree.refreshOpenFolders();

    expect(asked().sort()).toEqual([ROOT, SUB]);
  });

  it('keeps each open folder open with its rows, and drops an open folder deleted with its rows', async () => {
    await openTree();
    await tree.refreshOpenFolders();
    expect(tree.nodeAt(SUB)?.expanded).toBe(true);
    expect(namesIn(SUB)).toEqual(['x.log']);

    backend.remove(SUB);
    // The folder's own listing answers 404; the folder is gone, nothing failed.
    await tree.refreshOpenFolders();

    expect(tree.nodeAt(SUB)).toBeNull();
    expect(tree.nodeAt(`${SUB}/x.log`)).toBeNull();
  });

  it('changes nothing when the listings say nothing new', async () => {
    await openTree();
    const heard = vi.fn();
    const unsubscribe = tree.subscribe(heard);
    heard.mockClear();

    await tree.refreshOpenFolders();
    unsubscribe();

    expect(heard).not.toHaveBeenCalled();
  });

  it('never asks for one folder twice at once: a folder whose listing is on its way is left to it', async () => {
    await openTree();
    const asked = listingsFromNow();
    backend.hold();

    const first = tree.refreshOpenFolders();
    const second = tree.refreshOpenFolders();
    backend.release();
    await Promise.all([first, second]);

    expect(asked().sort()).toEqual([ROOT, SUB]);
  });

  it('rejects once every folder is read when one could not be, and shows what the others hold', async () => {
    await openTree();
    backend.failListing(SUB, 500);
    backend.add(`${ROOT}/new.log`, 'file');

    await expect(tree.refreshOpenFolders()).rejects.toThrow();

    expect(namesIn(ROOT)).toContain('new.log');
    expect(namesIn(SUB)).toEqual(['x.log']);
    expect(get(tree).error).toBeNull();
  });

  // A scan or an index build that ends while a listing asked before it is
  // on its way: that listing still holds the labels from before.
  it('keeps the labels a scan or an index set while a listing asked before it was on its way', async () => {
    await openTree();
    backend.hold();
    const refreshing = tree.refreshOpenFolders();

    tree.markFindings(APP_LOG, 'full', 4);
    tree.markIndexed(APP_LOG, 120);
    backend.change(`${ROOT}/old.log`, { size: 11 });
    backend.release();
    await refreshing;

    expect(tree.nodeAt(APP_LOG)).toMatchObject({
      findings: { state: 'full', count: 4 },
      is_indexed: true,
      line_count: 120,
    });
    expect(tree.nodeAt(`${ROOT}/old.log`)?.size).toBe(11);

    // A listing asked after the marks shows what the backend holds.
    backend.change(APP_LOG, { findings: { state: 'partial', count: 1 }, is_indexed: true });
    await tree.refreshOpenFolders();
    expect(tree.nodeAt(APP_LOG)?.findings).toEqual({ state: 'partial', count: 1 });
  });

  it('lists the chains of an open folder again in chain mode only when its listing changed', async () => {
    await openTree(['log_chains']);
    chainMode.set(true);
    await Promise.all([tree.refreshChains(ROOT), tree.refreshChains(SUB)]);
    const chainsAsked = () => backend.requestsTo('/v1/logs/chains').length;
    const before = chainsAsked();

    await tree.refreshOpenFolders();
    expect(chainsAsked()).toBe(before);

    backend.add(`${SUB}/x.log.1`, 'file');
    await tree.refreshOpenFolders();
    expect(backend.requestsTo('/v1/logs/chains').slice(before)).toEqual([
      `/v1/logs/chains?path=${encodeURIComponent(SUB)}`,
    ]);
  });
});

describe('tree.nodeAt', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The open file's pane asks at every update; a large tree is not walked.
  it('looks only inside the folders whose path holds the one asked for', async () => {
    serveTree(['/logs', '/srv']);
    await tree.loadRoots();
    const logs = get(tree).roots.find((root) => root.path === '/logs');
    if (!logs) throw new Error('no /logs root');
    let isLogsWalked = false;
    const children = logs.children;
    Object.defineProperty(logs, 'children', {
      get: () => {
        isLogsWalked = true;
        return children;
      },
    });

    expect(tree.nodeAt('/srv/a.log')?.path).toBe('/srv/a.log');
    expect(isLogsWalked).toBe(false);
    expect(tree.nodeAt('/logs/a.log')?.path).toBe('/logs/a.log');
  });
});

describe('holdsPath', () => {
  it.each([
    ['/logs', '/logs/a.log', true],
    ['/logs', '/logs/app/a.log', true],
    ['/', '/a.log', true],
    ['/logs', '/logs', false],
    ['/logs', '/logsx/a.log', false],
    ['/logs', 'chain:/logs/a.log', false],
  ])('says whether %s holds %s', (folder, path, holds) => {
    expect(holdsPath(folder, path)).toBe(holds);
  });
});
