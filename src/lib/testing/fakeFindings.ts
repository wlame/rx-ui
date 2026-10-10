/**
 * Invented signatures, findings and findings answers for tests: a small
 * catalogue of four groups (`traceback`, `secret`, `sql`, `pii`), with
 * two opt-in `pii` signatures and one built-in a user file disabled; and
 * a backend that serves them (`FindingsBackend`).
 */
import { vi } from 'vitest';
import type { SignaturesState } from '../stores/signatures';
import type { Finding, FindingsResponse, GroupInfo, SignatureInfo } from '../types';

/** A catalogue signature with every field set; `fields` overrides any. */
export function signatureInfo(id: string, fields: Partial<SignatureInfo> = {}): SignatureInfo {
  return {
    id,
    name: id,
    group: 'traceback',
    description: '',
    tags: [],
    level: 'high',
    links: [],
    metadata: {},
    default: true,
    redact: false,
    kind: 'regex',
    keywords: [],
    keywords_declared: false,
    line_pass: false,
    source: { builtin: true },
    overrides: false,
    disabled_by: null,
    examples: { match: [], no_match: [] },
    regex: null,
    block: null,
    run: null,
    measure: null,
    ...fields,
  };
}

export const TEST_GROUPS: GroupInfo[] = [
  { name: 'traceback', description: 'Stack traces', order: 1, count: 3, builtin: true },
  { name: 'secret', description: 'Keys and tokens', order: 2, count: 1, builtin: true },
  { name: 'sql', description: 'SQL statements', order: 3, count: 1, builtin: true },
  { name: 'pii', description: 'Personal data', order: 4, count: 2, builtin: true },
];

/** The catalogue in its order: group by group. */
export const TEST_SIGNATURES: SignatureInfo[] = [
  signatureInfo('python-traceback', { name: 'Python traceback', kind: 'block' }),
  signatureInfo('java-exception', { name: 'Java exception', kind: 'block' }),
  signatureInfo('legacy-trace', {
    name: 'Legacy trace',
    disabled_by: { file: '/home/u/.config/rx/signatures/team.yml', line: 3 },
  }),
  signatureInfo('aws-access-key', { name: 'AWS access key', group: 'secret', redact: true }),
  signatureInfo('sql-statement', { name: 'SQL statement', group: 'sql', level: 'info' }),
  signatureInfo('email-address', { name: 'Email address', group: 'pii', default: false }),
  signatureInfo('phone-number', { name: 'Phone number', group: 'pii', default: false }),
];

/** The ids of the default set of the test catalogue. */
export const TEST_DEFAULT_IDS = [
  'python-traceback',
  'java-exception',
  'aws-access-key',
  'sql-statement',
];

/** The test catalogue as the signatures store holds it once loaded. */
export function testCatalogue(): SignaturesState {
  return { loaded: true, list: TEST_SIGNATURES, groups: TEST_GROUPS, errors: [] };
}

/** A finding of `signature` on lines `start` to `end` (one line by default). */
export function finding(
  signature: string,
  start: number,
  end = start,
  fields: Partial<Finding> = {},
): Finding {
  return {
    signature,
    start_line: start,
    end_line: end,
    start_offset: start * 100,
    end_offset: end * 100 + 99,
    time_ms: null,
    excerpt: `LINE ${start} ${signature}`,
    ...fields,
  };
}

/** A findings answer: nothing checked and nothing found unless `fields` says so. */
export function findingsAnswer(fields: Partial<FindingsResponse> = {}): FindingsResponse {
  return {
    state: 'none',
    checked: [],
    missing: [],
    counts: {},
    series: {},
    total: 0,
    findings: [],
    ticks: null,
    cli_command: '',
    ...fields,
  };
}

/** The folder the fake findings backend lists, and its search root. */
export const FINDINGS_DIR = '/logs';

/** A file the fake backend holds findings for. */
interface FakeFile {
  /** Every finding of every signature, in line order: the stored ones. */
  findings: Finding[];
  /** The count of a signature whose findings were capped: more than it stores. */
  counts: Map<string, number>;
  /** The signatures with a current cache entry. */
  current: Set<string>;
  /** Not text: every findings request is refused with a 400. */
  isBinary: boolean;
}

/** A scan task of the fake backend. */
interface FakeTask {
  id: string;
  path: string;
  /** The ids the scan was started for. */
  ids: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  read: number | null;
  total: number | null;
  result: FindingsResponse | null;
  error: string | null;
}

/** One request the fake backend received. */
export interface FakeRequest {
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

export interface FindingsBackendOptions {
  /** Features `/health` lists; `signatures` by default. */
  features?: string[];
}

/**
 * A backend that serves the test catalogue and the findings of the files
 * `addFile` gives it, through a stubbed `fetch`, as rx-go answers
 * `GET /v1/findings` (selection, filters, paging), `POST /v1/findings`
 * (a task, or the running task of the file), `GET /v1/tasks/{id}` and
 * `DELETE /v1/tasks/{id}`. A test drives each task with `progress`,
 * `complete` and `fail`. `/v1/tree` lists the files under `FINDINGS_DIR`.
 * A log chain request (`/v1/logs/*`) is never answered, so a chain's tab
 * stays open while it waits for its description.
 */
export class FindingsBackend {
  readonly requests: FakeRequest[] = [];
  private readonly files = new Map<string, FakeFile>();
  private readonly tasks = new Map<string, FakeTask>();
  private taskCount = 0;
  /** Answer the next DELETE with a 409, as for a task that ended meanwhile. */
  cancelConflict = false;

  constructor(private readonly options: FindingsBackendOptions = {}) {}

  /** Hold `findings` for a file; `current` signatures have a cache entry. */
  addFile(path: string, findings: Finding[] = [], current: string[] = [], isBinary = false): void {
    this.files.set(path, { findings, current: new Set(current), isBinary, counts: new Map() });
  }

  /** Count `count` findings of `signature` in a file, of which only those it holds are stored. */
  setCount(path: string, signature: string, count: number): void {
    this.files.get(path)?.counts.set(signature, count);
  }

  /** The requests made with `method` to `pathname`. */
  requestsTo(method: string, pathname: string): FakeRequest[] {
    return this.requests.filter((r) => r.method === method && r.pathname === pathname);
  }

  /** The task started or joined last. */
  lastTask(): FakeTask | undefined {
    return [...this.tasks.values()].pop();
  }

  /** The tasks still queued or running. */
  unfinishedTasks(): FakeTask[] {
    return [...this.tasks.values()].filter((t) => t.status === 'queued' || t.status === 'running');
  }

  /** The scan `id` has read `read` of `total` bytes. */
  progress(id: string, read: number, total: number): void {
    const task = this.task(id);
    Object.assign(task, { status: 'running', read, total });
  }

  /** The scan `id` ends: its signatures are current and its result is the answer for them. */
  complete(id: string): void {
    const task = this.task(id);
    const file = this.files.get(task.path);
    for (const signature of task.ids) file?.current.add(signature);
    const result = this.findingsAnswer(
      task.path,
      new URLSearchParams({ signatures: task.ids.join(',') }),
    );
    Object.assign(task, { status: 'completed', result });
  }

  /** The scan `id` fails with `message`. */
  fail(id: string, message: string): void {
    Object.assign(this.task(id), { status: 'failed', error: message });
  }

  private task(id: string): FakeTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`no task ${id}`);
    return task;
  }

  /** The ids a selection names: `default`, `all`, or ids (an empty selection is the default set). */
  private resolve(selection: string): string[] {
    const active = TEST_SIGNATURES.filter((s) => !s.disabled_by).map((s) => s.id);
    if (selection === '' || selection === 'default') return [...TEST_DEFAULT_IDS];
    if (selection === 'all') return active;
    return selection.split(',').filter((id) => active.includes(id));
  }

  private findingsAnswer(path: string, query: URLSearchParams): FindingsResponse {
    const file = this.files.get(path) ?? {
      findings: [],
      current: new Set<string>(),
      isBinary: false,
      counts: new Map<string, number>(),
    };
    const selection = this.resolve(query.get('signatures') ?? '');
    const checked = selection.filter((id) => file.current.has(id));
    const missing = selection.filter((id) => !file.current.has(id));
    const isFull = TEST_DEFAULT_IDS.every((id) => file.current.has(id));
    const state = isFull ? 'full' : file.current.size > 0 ? 'partial' : 'none';
    const counts = Object.fromEntries(
      checked.map((id) => {
        const stored = file.findings.filter((f) => f.signature === id).length;
        return [id, { count: file.counts.get(id) ?? stored, stored }];
      }),
    );
    const only = query.getAll('signature');
    const text = (query.get('q') ?? '').toLowerCase();
    const filtered = file.findings.filter(
      (f) =>
        checked.includes(f.signature) &&
        (only.length === 0 || only.includes(f.signature)) &&
        (text === '' || f.excerpt.toLowerCase().includes(text)),
    );
    const offset = Number(query.get('offset') ?? 0);
    const limit = Number(query.get('limit') ?? 1000);
    return findingsAnswer({
      state,
      checked,
      missing,
      counts,
      total: filtered.length,
      findings: filtered.slice(offset, offset + limit),
      cli_command: `rx trace --signatures=${selection.join(',')} ${path}`,
    });
  }

  private taskStatus(task: FakeTask) {
    return {
      task_id: task.id,
      status: task.status,
      path: task.path,
      operation: 'findings',
      started_at: '2026-10-11T10:00:00Z',
      completed_at: null,
      error: task.error,
      progress: null,
      bytes_read: task.read,
      bytes_total: task.total,
      result: task.result,
    };
  }

  private startScan(body: Record<string, unknown> | undefined): Answer {
    const path = String(body?.path ?? '');
    const running = [...this.tasks.values()].find(
      (t) => t.path === path && (t.status === 'queued' || t.status === 'running'),
    );
    if (running) {
      return answer(202, { task_id: running.id, status: running.status, path, message: 'Joined' });
    }
    const id = `scan-${++this.taskCount}`;
    const ids = this.resolve(String(body?.signatures ?? ''));
    this.tasks.set(id, {
      id,
      path,
      ids,
      status: 'queued',
      read: null,
      total: null,
      result: null,
      error: null,
    });
    return answer(202, { task_id: id, status: 'queued', path, message: 'Scanning' });
  }

  private cancel(id: string): Answer {
    const task = this.tasks.get(id);
    if (!task) return answer(404, { detail: 'Task not found' });
    if (this.cancelConflict || (task.status !== 'queued' && task.status !== 'running')) {
      this.cancelConflict = false;
      return answer(409, { detail: 'the task has already ended' });
    }
    task.status = 'cancelled';
    return answer(200, this.taskStatus(task));
  }

  private answerFor(request: FakeRequest): Answer {
    const { method, pathname, query, body } = request;
    const route = `${method} ${pathname.startsWith('/v1/tasks/') ? '/v1/tasks/{id}' : pathname}`;
    const path = query.get('path') ?? '';
    switch (route) {
      case 'GET /health':
        return answer(200, {
          contract_version: '2.0',
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
        if (this.files.get(path)?.isBinary) return answer(400, { detail: `binary file: ${path}` });
        return answer(200, this.findingsAnswer(path, query));
      case 'POST /v1/findings':
        return this.startScan(body);
      case 'GET /v1/tasks/{id}': {
        const task = this.tasks.get(pathname.slice('/v1/tasks/'.length));
        return task
          ? answer(200, this.taskStatus(task))
          : answer(404, { detail: 'Task not found' });
      }
      case 'DELETE /v1/tasks/{id}':
        return this.cancel(pathname.slice('/v1/tasks/'.length));
      default:
        return answer(404, { detail: 'not found' });
    }
  }

  private treeAnswer(path: string | null) {
    const entries =
      path === null
        ? [{ path: FINDINGS_DIR, name: 'logs', type: 'directory' }]
        : path === FINDINGS_DIR
          ? [...this.files.keys()].map((file) => ({
              path: file,
              name: file.slice(file.lastIndexOf('/') + 1),
              type: 'file',
              is_text: !this.files.get(file)?.isBinary,
            }))
          : [];
    return {
      path: path ?? '',
      parent: null,
      is_search_root: path === null,
      entries: entries.map((entry) => ({
        children_count: null,
        compression_format: null,
        is_compressed: false,
        is_indexed: false,
        is_text: null,
        line_count: null,
        findings: null,
        modified_at: null,
        size: 100,
        size_human: '100 B',
        ...entry,
      })),
      total_entries: entries.length,
      total_size: null,
      total_size_human: null,
    };
  }

  async fetch(url: string, init?: RequestInit): Promise<Answer> {
    const parsed = new URL(url, 'http://localhost');
    const request: FakeRequest = {
      method: init?.method ?? 'GET',
      pathname: parsed.pathname,
      query: parsed.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    this.requests.push(request);
    if (request.pathname.startsWith('/v1/logs/')) return new Promise<Answer>(() => {});
    return this.answerFor(request);
  }
}

/** Serve `backend` as the whole backend, through a stubbed `fetch`. */
export function serveFindings(backend: FindingsBackend) {
  const spy = vi.fn((url: string, init?: RequestInit) => backend.fetch(url, init));
  vi.stubGlobal('fetch', spy);
  return spy;
}
