/**
 * A backend for the tests of index and findings tasks started from the
 * files panel, over one file or a whole folder, through a stubbed
 * `fetch`.
 *
 * It lists the search root `/logs` (`app.log`, `worker.log.3.gz`, the
 * binary `core.bin` and the folder `sub`, which holds `old.log`), with the
 * labels `setLabels` gives each file. It answers `POST /v1/index` and
 * `POST /v1/findings` for a file or a folder as rx-go does: a task with
 * its `cli_command`; for a folder, a second index request while one runs
 * is a 409 that names it, and a second findings request joins it. A test
 * drives each task with `progress`, `complete` and `fail`;
 * `DELETE /v1/tasks/{id}` cancels a running one, at once or, with
 * `cancelSlowly`, through `cancelling` until `finishCancel`: meanwhile a
 * request for its folder is a 409 that names it. `GET /v1/findings`
 * answers an empty summary, and the signature catalogue is the test one.
 */
import { vi } from 'vitest';
import type { FolderTaskResult, TreeEntry } from '../types';
import { TEST_GROUPS, TEST_SIGNATURES, findingsAnswer } from './fakeFindings';

/** The search root the backend lists. */
export const FOLDER = '/logs';
/** The folder inside it. */
export const SUBFOLDER = `${FOLDER}/sub`;
export const APP_LOG = `${FOLDER}/app.log`;
export const WORKER_LOG = `${FOLDER}/worker.log.3.gz`;
export const CORE_BIN = `${FOLDER}/core.bin`;
export const OLD_LOG = `${SUBFOLDER}/old.log`;

/** What `/v1/tree` lists in each folder: files and folders by path. */
const LISTINGS: Record<string, { path: string; type: 'file' | 'directory' }[]> = {
  [FOLDER]: [
    { path: SUBFOLDER, type: 'directory' },
    { path: APP_LOG, type: 'file' },
    { path: CORE_BIN, type: 'file' },
    { path: WORKER_LOG, type: 'file' },
  ],
  [SUBFOLDER]: [{ path: OLD_LOG, type: 'file' }],
};

/** The labels of a file the test may change between two listings. */
export type FileLabels = Partial<Pick<TreeEntry, 'is_indexed' | 'findings'>>;

type TaskKind = 'index' | 'findings';
type TaskStatusName = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

/** A task of the fake backend. */
export interface FakeFolderTask {
  id: string;
  kind: TaskKind;
  path: string;
  isFolder: boolean;
  status: TaskStatusName;
  filesDone: number | null;
  filesTotal: number | null;
  cliCommand: string;
  result: FolderTaskResult | Record<string, unknown> | null;
  error: string | null;
}

/** One request the fake backend received. */
export interface FolderTaskRequest {
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: Record<string, unknown> | undefined;
}

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

/** A folder task's result with every count 0 unless `fields` says otherwise. */
export function folderResult(fields: Partial<FolderTaskResult> = {}): FolderTaskResult {
  return {
    path: FOLDER,
    files_total: 0,
    done: 0,
    skipped: 0,
    current: 0,
    failed: 0,
    findings: null,
    skipped_files: [],
    failed_files: [],
    cli_command: '',
    ...fields,
  };
}

export interface FolderTaskBackendOptions {
  /** Features `/health` lists; `signatures` by default. */
  features?: string[];
}

/** The fake backend; see the module's description. */
export class FolderTaskBackend {
  readonly requests: FolderTaskRequest[] = [];
  readonly tasks = new Map<string, FakeFolderTask>();
  private readonly labels = new Map<string, FileLabels>();
  private taskCount = 0;
  /** Answer the next DELETE with a 409, as for a task that ended meanwhile. */
  cancelConflict = false;
  /** A DELETE leaves the task `cancelling`, as a folder task whose worker has not stopped yet. */
  cancelSlowly = false;
  /** A `cancelling` task's worker stops as its status is read: the read says `cancelled`. */
  endStoppedOnRead = false;
  /** Every start request is a 409 naming this id, which no status read knows (404). */
  conflictWith: string | null = null;
  /** Every status read fails with a 500. */
  failStatusReads = false;
  /** The status the next DELETE fails with, in place of cancelling. */
  cancelError: number | null = null;

  constructor(private readonly options: FolderTaskBackendOptions = {}) {}

  /** List the file at `path` with `labels` from now on. */
  setLabels(path: string, labels: FileLabels): void {
    this.labels.set(path, { ...this.labels.get(path), ...labels });
  }

  /** The requests made with `method` to `pathname`. */
  requestsTo(method: string, pathname: string): FolderTaskRequest[] {
    return this.requests.filter((r) => r.method === method && r.pathname === pathname);
  }

  /** The `/v1/tree` listings asked for, by folder path. */
  listingsAsked(): string[] {
    return this.requestsTo('GET', '/v1/tree').map((r) => r.query.get('path') ?? '');
  }

  /** The task started last. */
  lastTask(): FakeFolderTask {
    const task = [...this.tasks.values()].pop();
    if (!task) throw new Error('no task was started');
    return task;
  }

  /** Start a task as another client would, without a request of the test's. */
  startElsewhere(kind: TaskKind, path: string): FakeFolderTask {
    return this.newTask(kind, path, true, '');
  }

  /** The folder task `id` has ended `done` of the `total` files it listed. */
  progress(id: string, done: number, total: number): void {
    Object.assign(this.task(id), { status: 'running', filesDone: done, filesTotal: total });
  }

  /** The task `id` completes with `result` (a folder's result unless given). */
  complete(id: string, result?: Record<string, unknown>): void {
    const task = this.task(id);
    const fallback = task.isFolder
      ? folderResult({ path: task.path, cli_command: task.cliCommand })
      : { path: task.path, line_index: [[1, 0]], line_count: 10, cli_command: task.cliCommand };
    Object.assign(task, { status: 'completed', result: result ?? fallback });
  }

  /** The backend forgets the task `id`, as after a restart: its reads and DELETE answer 404. */
  forget(id: string): void {
    this.tasks.delete(id);
  }

  /** The worker of the `cancelling` task `id` has stopped: it is `cancelled`. */
  finishCancel(id: string): void {
    this.task(id).status = 'cancelled';
  }

  /** The task `id` fails with `message`. */
  fail(id: string, message: string): void {
    Object.assign(this.task(id), { status: 'failed', error: message });
  }

  private task(id: string): FakeFolderTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`no task ${id}`);
    return task;
  }

  private newTask(kind: TaskKind, path: string, isFolder: boolean, selection: string) {
    const id = `${kind}-${++this.taskCount}`;
    const task: FakeFolderTask = {
      id,
      kind,
      path,
      isFolder,
      status: 'queued',
      filesDone: null,
      filesTotal: null,
      cliCommand: commandOf(kind, path, isFolder, selection),
      result: null,
      error: null,
    };
    this.tasks.set(id, task);
    return task;
  }

  private runningTask(kind: TaskKind, path: string): FakeFolderTask | undefined {
    return [...this.tasks.values()].find(
      (t) =>
        t.kind === kind && t.path === path && (t.status === 'queued' || t.status === 'running'),
    );
  }

  private startTask(kind: TaskKind, body: Record<string, unknown> | undefined): Answer {
    const path = String(body?.path ?? '');
    if (this.conflictWith !== null) {
      return answer(409, {
        detail: `busy (task: ${this.conflictWith})`,
        task_id: this.conflictWith,
      });
    }
    const isFolder = path in LISTINGS;
    const running = this.runningTask(kind, path);
    const stopping = [...this.tasks.values()].find(
      (t) => t.kind === kind && t.path === path && t.status === 'cancelling',
    );
    if (stopping) {
      return answer(409, {
        detail: `A task for ${path} is still stopping (task: ${stopping.id})`,
        task_id: stopping.id,
      });
    }
    if (running && kind === 'index') {
      return answer(409, {
        detail: `A task for ${path} is already running (task: ${running.id})`,
        task_id: running.id,
      });
    }
    const task = running ?? this.newTask(kind, path, isFolder, String(body?.signatures ?? ''));
    const status = kind === 'index' ? 200 : 202;
    return answer(status, {
      task_id: task.id,
      status: task.status,
      path,
      message: running ? 'Joined' : 'Started',
      started_at: '2026-10-12T10:00:00Z',
      cli_command: task.cliCommand,
    });
  }

  private taskStatus(task: FakeFolderTask) {
    return {
      task_id: task.id,
      status: task.status,
      path: task.path,
      operation: task.kind,
      started_at: '2026-10-12T10:00:00Z',
      completed_at: null,
      error: task.error,
      progress: null,
      bytes_read: null,
      bytes_total: null,
      files_done: task.filesDone,
      files_total: task.filesTotal,
      cli_command: task.cliCommand,
      result: task.result,
    };
  }

  private cancel(id: string): Answer {
    if (this.cancelError !== null) {
      const status = this.cancelError;
      this.cancelError = null;
      return answer(status, { detail: 'the task table is busy' });
    }
    const task = this.tasks.get(id);
    if (!task) return answer(404, { detail: 'Task not found' });
    if (this.cancelConflict || (task.status !== 'queued' && task.status !== 'running')) {
      this.cancelConflict = false;
      return answer(409, { detail: 'the task has already ended', task_id: id });
    }
    task.status = this.cancelSlowly ? 'cancelling' : 'cancelled';
    return answer(200, this.taskStatus(task));
  }

  private treeAnswer(path: string | null) {
    const listed =
      path === null ? [{ path: FOLDER, type: 'directory' as const }] : (LISTINGS[path] ?? []);
    const entries = listed.map(({ path: entryPath, type }) => ({
      path: entryPath,
      name: entryPath.slice(entryPath.lastIndexOf('/') + 1),
      type,
      children_count: type === 'directory' ? (LISTINGS[entryPath]?.length ?? 0) : null,
      compression_format: entryPath.endsWith('.gz') ? 'gzip' : null,
      is_compressed: entryPath.endsWith('.gz'),
      is_indexed: false,
      is_text: type === 'file' ? !entryPath.endsWith('.bin') : null,
      line_count: null,
      findings: null,
      modified_at: null,
      size: 100,
      size_human: '100 B',
      ...this.labels.get(entryPath),
    }));
    return {
      path: path ?? '',
      parent: null,
      is_search_root: path === null,
      entries,
      total_entries: entries.length,
      total_size: null,
      total_size_human: null,
    };
  }

  private answerFor(request: FolderTaskRequest): Answer {
    const { method, pathname, query, body } = request;
    const route = `${method} ${pathname.startsWith('/v1/tasks/') ? '/v1/tasks/{id}' : pathname}`;
    const taskId = pathname.slice('/v1/tasks/'.length);
    switch (route) {
      case 'GET /health':
        return answer(200, {
          contract_version: '2.0',
          tree_refresh_seconds: 0,
          features: this.options.features ?? ['signatures'],
        });
      case 'GET /v1/signatures':
        return answer(200, {
          signatures: TEST_SIGNATURES,
          groups: TEST_GROUPS,
          levels: ['info', 'low', 'medium', 'high', 'critical'],
          errors: [],
          search_path: [],
          files: [],
        });
      case 'GET /v1/tree':
        return answer(200, this.treeAnswer(query.get('path')));
      case 'GET /v1/findings':
        return answer(200, findingsAnswer());
      case 'POST /v1/index':
        return this.startTask('index', body);
      case 'POST /v1/findings':
        return this.startTask('findings', body);
      case 'GET /v1/tasks/{id}': {
        if (this.failStatusReads) return answer(500, { detail: 'the task table is busy' });
        const task = this.tasks.get(taskId);
        if (task?.status === 'cancelling' && this.endStoppedOnRead) task.status = 'cancelled';
        return task ? answer(200, this.taskStatus(task)) : answer(404, { detail: 'not found' });
      }
      case 'DELETE /v1/tasks/{id}':
        return this.cancel(taskId);
      default:
        return answer(404, { detail: 'not found' });
    }
  }

  async fetch(url: string, init?: RequestInit): Promise<Answer> {
    const parsed = new URL(url, 'http://localhost');
    const request: FolderTaskRequest = {
      method: init?.method ?? 'GET',
      pathname: parsed.pathname,
      query: parsed.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    this.requests.push(request);
    return this.answerFor(request);
  }
}

/**
 * The command rx-go gives a task: positionals first, then the flags,
 * `--recursive` for a folder, as its renderer writes every command, and
 * `--hidden`, as a server that serves hidden entries adds: a part only
 * the server knows, so a command the viewer built itself fails a test.
 */
function commandOf(kind: TaskKind, path: string, isFolder: boolean, selection: string): string {
  const recursive = isFolder ? ' --recursive' : '';
  if (kind === 'index') return `rx index ${path}${recursive} --threshold=0 --hidden`;
  return `rx scan ${path}${recursive} --signatures=${selection || 'default'} --hidden`;
}

/** Serve `backend` as the whole backend, through a stubbed `fetch`. */
export function serveFolderTasks(backend: FolderTaskBackend) {
  const spy = vi.fn((url: string, init?: RequestInit) => backend.fetch(url, init));
  vi.stubGlobal('fetch', spy);
  return spy;
}
