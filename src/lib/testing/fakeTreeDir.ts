/**
 * A backend whose folders change between two listings, for the tests of
 * the files list read again by itself, through a stubbed `fetch`.
 *
 * `/v1/tree` lists what the backend holds when it is asked: the search
 * roots, or the entries directly inside a folder, by name. A test adds
 * and removes entries (a folder with everything under it), changes an
 * entry's fields (size, date, labels), keeps the listings waiting until
 * `release`, and makes a folder's listing fail with a status. A folder
 * the backend does not hold answers 404, as rx-go does. With `log_chains`
 * among the features, `/v1/logs/chains` lists no chain in any folder.
 * Each request is recorded as `path?query`.
 */
import { vi } from 'vitest';
import type { TreeEntry, TreeResponse } from '../types';
import { treeEntry } from './fakeLogDir';

interface Answer {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function answer(status: number, body: unknown): Answer {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

export interface TreeDirBackendOptions {
  /** Features `/health` lists; none by default. */
  features?: string[];
  /** The `tree_refresh_seconds` of `/health`; 0 by default. */
  treeRefreshSeconds?: number;
}

/** The fake backend; see the module's description. */
export class TreeDirBackend {
  readonly requests: string[] = [];
  private readonly entries = new Map<string, TreeEntry>();
  private readonly failing = new Map<string, number>();
  private isHolding = false;
  private waiting: (() => void)[] = [];

  /** A backend whose search roots are `roots`, each an empty folder. */
  constructor(
    private readonly roots: string[],
    private readonly options: TreeDirBackendOptions = {},
  ) {
    for (const root of roots) this.entries.set(root, treeEntry(root, 'directory'));
  }

  /** Hold the entry at `path` from now on, its folder's other entries kept. */
  add(path: string, type: 'directory' | 'file', fields: Partial<TreeEntry> = {}): void {
    this.entries.set(path, treeEntry(path, type, fields));
  }

  /** Hold no more the entry at `path`, nor anything under it. */
  remove(path: string): void {
    for (const held of [...this.entries.keys()]) {
      if (held === path || held.startsWith(`${path}/`)) this.entries.delete(held);
    }
  }

  /** List the entry at `path` with `fields` from now on. */
  change(path: string, fields: Partial<TreeEntry>): void {
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`the backend holds no ${path}`);
    this.entries.set(path, { ...entry, ...fields });
  }

  /** Answer the listings of the folder at `path` with `status` (null: list it again). */
  failListing(path: string, status: number | null): void {
    if (status === null) this.failing.delete(path);
    else this.failing.set(path, status);
  }

  /** Keep the answers of `/v1/tree` waiting until `release`. */
  hold(): void {
    this.isHolding = true;
  }

  /** Answer every held request, and hold no more. */
  release(): void {
    this.isHolding = false;
    for (const answerNow of this.waiting.splice(0)) answerNow();
  }

  /** The requests made to `pathname`, as `path?query`. */
  requestsTo(pathname: string): string[] {
    return this.requests.filter((r) => r.startsWith(`${pathname}?`) || r === pathname);
  }

  /** The folders whose listing was asked, in the order asked. */
  listingsAsked(): string[] {
    return this.requestsTo('/v1/tree')
      .map((r) => new URLSearchParams(r.slice(r.indexOf('?') + 1)).get('path'))
      .filter((path): path is string => path !== null);
  }

  private listing(path: string | null): Answer {
    if (path === null) {
      const roots = this.roots.map((root) => this.entries.get(root)).filter((e) => e !== undefined);
      return answer(200, this.treeResponse('', roots, true));
    }
    const failure = this.failing.get(path);
    if (failure !== undefined) return answer(failure, { detail: 'the folder cannot be listed' });
    if (this.entries.get(path)?.type !== 'directory') {
      return answer(404, { detail: `Path not found: ${path}` });
    }
    const inside = [...this.entries.values()]
      .filter((entry) => folderOf(entry.path) === path)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => (entry.type === 'directory' ? this.withCount(entry) : entry));
    return answer(200, this.treeResponse(path, inside, false));
  }

  private withCount(folder: TreeEntry): TreeEntry {
    const count = [...this.entries.keys()].filter((path) => folderOf(path) === folder.path).length;
    return { ...folder, children_count: count };
  }

  private treeResponse(path: string, entries: TreeEntry[], isRoot: boolean): TreeResponse {
    return {
      path,
      parent: null,
      is_search_root: isRoot,
      entries,
      total_entries: entries.length,
      total_size: null,
      total_size_human: null,
    };
  }

  private answerFor(pathname: string, query: URLSearchParams): Answer {
    switch (pathname) {
      case '/health':
        return answer(200, {
          contract_version: '2.0',
          tree_refresh_seconds: this.options.treeRefreshSeconds ?? 0,
          features: this.options.features ?? [],
        });
      case '/v1/tree':
        return this.listing(query.get('path'));
      case '/v1/logs/chains':
        return answer(200, { path: query.get('path') ?? '', chains: [] });
      default:
        return answer(404, { detail: 'not found' });
    }
  }

  async fetch(url: string): Promise<Answer> {
    const parsed = new URL(url, 'http://localhost');
    this.requests.push(`${parsed.pathname}${parsed.search}`);
    if (this.isHolding && parsed.pathname === '/v1/tree') {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    return this.answerFor(parsed.pathname, parsed.searchParams);
  }
}

/** Serve `backend` as the whole backend, through a stubbed `fetch`. */
export function serveTreeDir(backend: TreeDirBackend) {
  const spy = vi.fn((url: string) => backend.fetch(url));
  vi.stubGlobal('fetch', spy);
  return spy;
}
