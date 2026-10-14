import { writable, get } from 'svelte/store';
import { ApiError, api } from '../api';
import { contractGate } from '../contractGate';
import { isChainIndexed } from '../utils/chainParts';
import { chainDirectoryOf, type DescribedChain } from '../utils/chainTree';
import { LatestRequest, LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import {
  RecentMarks,
  entryToNode,
  haveFilesChanged,
  mergeListing,
  type KeptFields,
} from '../utils/treeListing';
import type { ChainEntry, ChainResponse, TreeNode, TreeEntry } from '../types';
import { chainModeOn } from './chainMode';

/** Chains whose last description the tree keeps; the oldest is dropped first. */
export const MAX_DESCRIBED_CHAINS = 256;

interface TreeState {
  roots: TreeNode[];
  loading: boolean;
  error: string | null;
  /** The selected row: a file's or folder's path, or a chain's tab key (`chain:<handle>`). */
  selectedPath: string | null;
  /**
   * What the last description of each chain said (its state and reasons),
   * by handle, from a chain's tab; at most `MAX_DESCRIBED_CHAINS`. A
   * listing does not describe a chain, so this is how the files panel
   * learns that one is invalid.
   */
  describedChains: ReadonlyMap<string, DescribedChain>;
}

/** The status of a listing of a folder that is gone. */
const HTTP_NOT_FOUND = 404;

/** Whether a listing failed because its folder is gone, which its parent's listing shows. */
function isFolderGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === HTTP_NOT_FOUND;
}

/**
 * What a listing read again did to its folder's rows: nothing, as a newer
 * listing took over or it said nothing new; changed some; or changed its
 * files, of which its chains are made.
 */
type ListingOutcome = 'superseded' | 'unchanged' | 'changed' | 'filesChanged';

/** The folder `node` and every folder under it whose rows are loaded; none when its own are not. */
function loadedFolders(node: TreeNode): TreeNode[] {
  if (node.type !== 'directory' || node.children.length === 0) return [];
  return [node, ...node.children.flatMap(loadedFolders)];
}

/**
 * Whether the folder at `folder` holds `path`, at any depth: `path` starts
 * with the folder's path and a slash. A folder does not hold itself.
 */
export function holdsPath(folder: string, path: string): boolean {
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  return path.length > prefix.length && path.startsWith(prefix);
}

function createTreeStore() {
  const { subscribe, update } = writable<TreeState>({
    roots: [],
    loading: false,
    error: null,
    selectedPath: null,
    describedChains: new Map(),
  });

  /**
   * The node at `path`, looked for only inside the folders whose path
   * holds it: the open file's pane asks at each of its updates.
   */
  function findNode(nodes: TreeNode[], path: string): TreeNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (holdsPath(node.path, path)) {
        const found = findNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  function updateNode(
    nodes: TreeNode[],
    path: string,
    updater: (node: TreeNode) => TreeNode,
  ): TreeNode[] {
    return nodes.map((node) => {
      if (node.path === path) {
        return updater(node);
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: updateNode(node.children, path, updater),
        };
      }
      return node;
    });
  }

  // The roots load once per session but can be retried; only the newest
  // attempt may write. Directory loads are keyed by path so expanding one
  // folder does not cancel another.
  const latestRoots = new LatestRequest();
  const directoryLoads = new LatestRequestMap();

  async function loadRoots() {
    update((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await latestRoots.run((signal) => api.getTree(undefined, { signal }));
      if (response === SUPERSEDED) return;

      const roots = (response.entries ?? [])
        .filter((e) => e.type === 'directory')
        .map((e) => entryToNode(e, 0));
      update((s) => ({ ...s, roots, loading: false }));
      // The search roots open with the tree, so the first level of every
      // root is in view at once; deeper folders stay closed until clicked.
      // Each root is listed by its own request, all at the same time.
      await Promise.all(roots.map((root) => loadDirectory(root.path)));
    } catch (e) {
      if (isAbortError(e)) return;
      update((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load roots',
      }));
    }
  }

  /**
   * Load the roots unless they are loaded or loading. Loading them again
   * replaces every node, which collapses the expanded folders; Retry and
   * a first load are the only reasons to do that.
   */
  async function ensureRoots() {
    const state = get({ subscribe });
    if (state.roots.length > 0 || state.loading) return;
    await loadRoots();
  }

  /**
   * The chains of a directory, or undefined when they cannot be listed:
   * the directory then shows every file, and the tree shows no error.
   */
  async function chainListing(
    path: string,
    signal: AbortSignal,
  ): Promise<readonly ChainEntry[] | undefined> {
    try {
      return (await api.logChains(path, { signal })).chains;
    } catch (e) {
      if (isAbortError(e)) throw e;
      console.warn('The log chains of a directory could not be listed:', path, e);
      return undefined;
    }
  }

  /**
   * Load a directory's entries and expand it. With chain mode on, its
   * chains are asked for at the same time, and the directory shows them
   * once both answers are in; a chain listing that fails leaves every
   * file shown. When the mode turned on while the load ran, the chains
   * are asked for afterwards.
   */
  async function loadDirectory(path: string) {
    const state = get({ subscribe });
    const node = findNode(state.roots, path);
    if (!node || node.type !== 'directory') return;

    update((s) => ({
      ...s,
      roots: updateNode(s.roots, path, (n) => ({ ...n, loading: true })),
    }));

    try {
      const response = await directoryLoads.run(path, async (signal) => {
        // The mode needs the backend's features, which the first /health
        // answer gives; the first requests wait for it anyway.
        await contractGate.pass(signal);
        const withChains = get(chainModeOn);
        const [listing, chains] = await Promise.all([
          api.getTree(path, { signal }),
          withChains ? chainListing(path, signal) : undefined,
        ]);
        return { listing, chains, withChains };
      });
      if (response === SUPERSEDED) return;

      const { listing, chains, withChains } = response;
      const children = (listing.entries ?? []).map((e) => entryToNode(e, node.level + 1));
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({
          ...n,
          loading: false,
          children,
          chains,
          expanded: true,
        })),
      }));
      if (!withChains) await ensureChains(path);
    } catch (e) {
      if (isAbortError(e)) return;
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({ ...n, loading: false })),
        error: e instanceof Error ? e.message : 'Failed to load directory',
      }));
    }
  }

  // The listings read again (after a task changed a folder's files, or by
  // the refresh) have slots of their own, so a reload and the load of a
  // click never cancel each other; whichever answers last is shown.
  const reloads = new LatestRequestMap();
  /** How many listings read again are on their way, by folder. */
  const listingsAgain = new Map<string, number>();
  /** The labels the tree set while listings were on their way, which those keep. */
  const marks = new RecentMarks();

  /**
   * Show `entries`, a listing of the folder at `path`, in place of its
   * rows (`mergeListing`), keeping the fields `keptFields` names. Nothing
   * changes when the listing says nothing new, or the folder is gone.
   */
  function showListing(
    path: string,
    entries: TreeEntry[],
    keptFields: KeptFields,
  ): Exclude<ListingOutcome, 'superseded'> {
    const node = findNode(get({ subscribe }).roots, path);
    if (!node || node.type !== 'directory') return 'unchanged';
    const children = mergeListing(node.children, entries, node.level + 1, keptFields);
    if (children === node.children) return 'unchanged';
    update((s) => ({
      ...s,
      roots: updateNode(s.roots, path, (n) => ({ ...n, children })),
    }));
    return haveFilesChanged(node.children, children) ? 'filesChanged' : 'changed';
  }

  /**
   * List the loaded folder `folder` again and show what changed. The
   * labels the tree set after the listing was asked stay (`marks`): the
   * listing may hold them from before. Throws what the listing threw.
   */
  async function listAgain(folder: TreeNode): Promise<ListingOutcome> {
    const askedAt = marks.listingAsked();
    listingsAgain.set(folder.path, (listingsAgain.get(folder.path) ?? 0) + 1);
    try {
      const listing = await reloads.run(folder.path, (signal) =>
        api.getTree(folder.path, { signal }),
      );
      if (listing === SUPERSEDED) return 'superseded';
      return showListing(folder.path, listing.entries ?? [], marks.newerThan(askedAt));
    } finally {
      const count = (listingsAgain.get(folder.path) ?? 1) - 1;
      if (count > 0) listingsAgain.set(folder.path, count);
      else listingsAgain.delete(folder.path);
      marks.listingEnded();
    }
  }

  /**
   * List the loaded folder `folder` again and show its rows' new fields,
   * and its chains when they are listed. A listing that fails leaves the
   * rows as they were and shows no error: nothing the user asked failed.
   */
  async function reloadListing(folder: TreeNode): Promise<void> {
    try {
      if ((await listAgain(folder)) === 'superseded') return;
      if (folder.chains !== undefined) await refreshChains(folder.path);
    } catch (e) {
      if (!isAbortError(e)) console.warn('A folder could not be listed again:', folder.path, e);
    }
  }

  /**
   * List again the folder at `path` and every folder under it whose rows
   * are loaded, all at once, after a task over it changed what its files
   * hold (their `idx` and findings labels). Each row keeps whether it is
   * open and its own rows; a folder never opened is listed when it is.
   */
  async function reloadFolder(path: string): Promise<void> {
    const node = findNode(get({ subscribe }).roots, path);
    if (!node) return;
    await Promise.all(loadedFolders(node).map(reloadListing));
  }

  /**
   * The refresh of one open folder: list it again and, when its files
   * changed and its chains are listed, its chains too (they are made of
   * its files).
   */
  async function refreshFolder(folder: TreeNode): Promise<void> {
    const outcome = await listAgain(folder);
    if (outcome === 'filesChanged' && folder.chains !== undefined) {
      await refreshChains(folder.path);
    }
  }

  /**
   * Read again every folder the panel shows open, all at once, one
   * request each, and show what changed in place: new entries, gone ones
   * (an open folder with its rows), new sizes, dates and labels; each row
   * keeps whether it is open and its own rows. A folder whose listing is
   * on its way already is left to it, so a folder is never asked twice at
   * once; a folder whose rows load is left to that load; and nothing is
   * asked while the roots load or the tree shows its error. Rejects, once
   * every listing has ended, when one failed: a folder that is gone (404)
   * has not, its parent's listing drops its row.
   */
  async function refreshOpenFolders(): Promise<void> {
    const state = get({ subscribe });
    if (state.loading || state.error !== null) return;
    const folders = shownFolders(state.roots).filter(
      (folder) => !folder.loading && !listingsAgain.has(folder.path),
    );
    const outcomes = await Promise.allSettled(folders.map(refreshFolder));
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' &&
      !isAbortError(outcome.reason) &&
      !isFolderGone(outcome.reason)
        ? [outcome.reason]
        : [],
    );
    if (failures.length === 0) return;
    const first = failures[0] instanceof Error ? failures[0].message : String(failures[0]);
    throw new Error(
      `${failures.length} of ${folders.length} open folders could not be read again: ${first}`,
    );
  }

  /** The directories whose chains are being listed. */
  const chainLoads = new LatestRequestMap();
  const listingChains = new Set<string>();

  /**
   * List a loaded directory's chains, whatever it holds already, and keep
   * them. A directory the tree has not loaded is left alone.
   */
  async function refreshChains(path: string): Promise<void> {
    const node = findNode(get({ subscribe }).roots, path);
    if (!node || node.type !== 'directory') return;
    listingChains.add(path);
    try {
      const chains = await chainLoads.run(path, (signal) => chainListing(path, signal));
      if (chains === SUPERSEDED || chains === undefined) return;
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({ ...n, chains })),
      }));
    } catch (e) {
      if (!isAbortError(e)) throw e;
    } finally {
      listingChains.delete(path);
    }
  }

  /**
   * List a loaded directory's chains while chain mode is on, unless they
   * are listed or being listed.
   */
  async function ensureChains(path: string): Promise<void> {
    if (!get(chainModeOn) || listingChains.has(path)) return;
    if (findNode(get({ subscribe }).roots, path)?.chains !== undefined) return;
    await refreshChains(path);
  }

  /**
   * The expanded directories on screen among `nodes` and under them: a
   * collapsed directory and every directory under it are left out, an
   * expanded one among them too, as the panel does not show them.
   */
  function shownFolders(nodes: readonly TreeNode[]): TreeNode[] {
    return nodes.flatMap((node) =>
      node.type === 'directory' && node.expanded ? [node, ...shownFolders(node.children)] : [],
    );
  }

  /**
   * List the chains of the expanded directories among `nodes` and under
   * them that the panel shows and that have none listed, all at once. A
   * collapsed directory is listed when it is expanded.
   */
  async function listChainsOfShownDirectories(
    nodes: readonly TreeNode[] = get({ subscribe }).roots,
  ): Promise<void> {
    await Promise.all(shownFolders(nodes).map((folder) => ensureChains(folder.path)));
  }

  /** Close the folder at `path`; its rows stay loaded. */
  function collapse(path: string) {
    const node = findNode(get({ subscribe }).roots, path);
    if (!node || node.type !== 'directory' || !node.expanded) return;
    update((s) => ({
      ...s,
      roots: updateNode(s.roots, path, (n) => ({ ...n, expanded: false })),
    }));
  }

  /**
   * Show the rows of the closed folder `node`: at once when they are
   * loaded, else after loading them. Its chains, and those of the expanded
   * folders it shows again, are asked for when not listed: the mode may
   * have turned on while it was closed, or a listing failed.
   */
  async function showFolder(node: TreeNode) {
    if (node.children.length === 0) {
      await loadDirectory(node.path);
      return;
    }
    update((s) => ({
      ...s,
      roots: updateNode(s.roots, node.path, (n) => ({ ...n, expanded: true })),
    }));
    const expanded = findNode(get({ subscribe }).roots, node.path);
    if (expanded) await listChainsOfShownDirectories([expanded]);
  }

  /**
   * Open the folder at `path`, loading its rows first when the tree has
   * none. A folder that is open, or whose rows are loading, is left as it
   * is: the load already running opens it.
   */
  async function expand(path: string) {
    const node = findNode(get({ subscribe }).roots, path);
    if (!node || node.type !== 'directory' || node.expanded || node.loading) return;
    await showFolder(node);
  }

  /** A click on a folder: close it when open, else open it (a click on a loading folder asks again). */
  async function toggleExpanded(path: string) {
    const node = findNode(get({ subscribe }).roots, path);
    if (!node || node.type !== 'directory') return;
    if (node.expanded) collapse(path);
    else await showFolder(node);
  }

  function selectPath(path: string | null) {
    update((s) => ({ ...s, selectedPath: path }));
  }

  /** Show a file as indexed after an index task built its index. */
  function markIndexed(path: string, lineCount: number | null) {
    marks.note(
      path,
      lineCount === null ? { is_indexed: true } : { is_indexed: true, line_count: lineCount },
    );
    update((s) => ({
      ...s,
      roots: updateNode(s.roots, path, (n) => ({
        ...n,
        is_indexed: true,
        line_count: lineCount ?? n.line_count,
      })),
    }));
  }

  /**
   * Show what the findings cache now holds for a file, after a scan of
   * it ended: its state and its findings count, or nothing for `none`.
   */
  function markFindings(path: string, state: 'full' | 'partial' | 'none', count: number) {
    const findings = state === 'none' ? null : { state, count };
    marks.note(path, { findings });
    update((s) => ({
      ...s,
      roots: updateNode(s.roots, path, (n) => ({ ...n, findings })),
    }));
  }

  /**
   * Keep what a chain's description said, for its row: its state and
   * reasons (an invalid chain is marked), and whether every part it
   * needs is indexed (`idx`), which a listing of its directory gave
   * before.
   */
  function noteChainDescription(chain: ChainResponse) {
    const handle = chain.path;
    const isIndexed = isChainIndexed(chain.parts);
    update((s) => {
      const described = new Map(s.describedChains);
      described.delete(handle);
      described.set(handle, { state: chain.state, reasons: chain.reasons });
      for (const oldest of described.keys()) {
        if (described.size <= MAX_DESCRIBED_CHAINS) break;
        described.delete(oldest);
      }
      return {
        ...s,
        describedChains: described,
        roots: updateNode(s.roots, chainDirectoryOf(handle), (n) => ({
          ...n,
          chains: n.chains?.map((c) => (c.path === handle ? { ...c, is_indexed: isIndexed } : c)),
        })),
      };
    });
  }

  /**
   * Expand all parent directories to reveal a file path and select it
   */
  async function expandToPath(filePath: string) {
    // Ensure roots are loaded first
    const state = get({ subscribe });
    if (state.roots.length === 0 && !state.loading) {
      await loadRoots();
    }

    // Wait for roots to finish loading if they're currently loading
    if (state.loading) {
      // Poll until loading is done
      await new Promise<void>((resolve) => {
        const unsubscribe = subscribe((s) => {
          if (!s.loading) {
            unsubscribe();
            resolve();
          }
        });
      });
    }

    // Get all parent directory paths
    const parts = filePath.split('/').filter((p) => p);
    const parentPaths: string[] = [];

    for (let i = 1; i < parts.length; i++) {
      parentPaths.push('/' + parts.slice(0, i).join('/'));
    }

    // Load and expand each parent directory in sequence
    for (const dirPath of parentPaths) {
      const currentState = get({ subscribe });
      const node = findNode(currentState.roots, dirPath);

      if (node && node.type === 'directory' && !node.expanded) {
        await loadDirectory(dirPath);
      }
    }

    // Select the file
    selectPath(filePath);
  }

  /** The tree's entry for a path, or null when the loaded tree does not list it. */
  function nodeAt(path: string): TreeNode | null {
    return findNode(get({ subscribe }).roots, path);
  }

  return {
    subscribe,
    nodeAt,
    loadRoots,
    ensureRoots,
    loadDirectory,
    reloadFolder,
    refreshOpenFolders,
    expand,
    collapse,
    toggleExpanded,
    selectPath,
    markIndexed,
    markFindings,
    expandToPath,
    listChainsOfShownDirectories,
    refreshChains,
    noteChainDescription,
  };
}

export const tree = createTreeStore();

// Turning chain mode on (or the backend's features arriving with it on)
// lists the chains of the expanded directories on screen; a collapsed one
// is listed when it is expanded. The rows are worked out from the entries
// and the chains as they are shown, so turning the mode off and on again
// collapses nothing and asks for nothing.
chainModeOn.subscribe((on) => {
  if (on) void tree.listChainsOfShownDirectories();
});
