/**
 * Invented signatures, findings and findings answers for tests: a small
 * catalogue of four groups (`traceback`, `secret`, `sql`, `pii`), with
 * two opt-in `pii` signatures and one built-in a user file disabled; and
 * a backend that serves them (`FindingsBackend`).
 */
import { vi } from 'vitest';
import type { SignaturesState } from '../stores/signatures';
import type { Finding, FindingsResponse, GroupInfo, SignatureInfo, TreeFindings } from '../types';

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
  /** The file's first and last time, read in UTC, for `ticks`; none until `setTimeRange`. */
  timeRange?: { startMs: number; endMs: number };
}

/** A zone `file_tz` names as `±HH:MM`: how far its wall clock is ahead of UTC, in ms; 0 for others. */
function zoneOffsetMs(zone: string | null): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(zone ?? '');
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 3_600_000 + Number(match[3]) * 60_000);
}

/** The text of line `n` of every file the fake backend holds. */
export function fakeLineText(n: number): string {
  return `LINE ${n}`;
}

/** The bytes a line costs in a text budget: its UTF-8 bytes and one for its line break. */
function lineCost(line: string): number {
  return new TextEncoder().encode(line).length + 1;
}

/**
 * Fill each finding's `lines` and `before` as rx-go does for `text=true`:
 * its own `lines` if the test gave them, else `LINE n`; `before` lines
 * above it, none before line 1; within `budget` bytes, after which the
 * finding at which it runs out and every later one lose their text and
 * are marked `lines_truncated`.
 */
function withText(found: Finding[], before: number, budget: number): Finding[] {
  let remaining = budget;
  let isSpent = false;
  return found.map((f) => {
    const firstBefore = Math.max(1, f.start_line - before);
    const above = Array.from({ length: f.start_line - firstBefore }, (_, i) =>
      fakeLineText(firstBefore + i),
    );
    const lines =
      f.lines ??
      Array.from({ length: f.end_line - f.start_line + 1 }, (_, i) =>
        fakeLineText(f.start_line + i),
      );
    const cost = [...above, ...lines].reduce((sum, line) => sum + lineCost(line), 0);
    if (isSpent || cost > remaining) {
      isSpent = true;
      const { lines: _lines, ...rest } = f;
      return { ...rest, lines_truncated: true };
    }
    remaining -= cost;
    return { ...f, lines, before: above };
  });
}

/** A scan task of the fake backend. */
interface FakeTask {
  id: string;
  path: string;
  /** The ids the scan was started for. */
  ids: string[];
  /** The `rx scan` command rx-go gives the task. */
  cliCommand: string;
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
 * `GET /v1/findings` (selection, filters, paging, `text` within
 * `max_bytes`, `ticks` over the range `setTimeRange` gives, times read in
 * a `±HH:MM` `file_tz`), `POST /v1/findings`
 * (a task, or the running task of the file), `GET /v1/tasks/{id}` and
 * `DELETE /v1/tasks/{id}`. A test drives each task with `progress`,
 * `complete` and `fail`. `/v1/tree` lists the files under `FINDINGS_DIR`,
 * each with the label `listFindings` gave it, or none.
 * A log chain request (`/v1/logs/*`) is never answered, so a chain's tab
 * stays open while it waits for its description.
 */
export class FindingsBackend {
  readonly requests: FakeRequest[] = [];
  private readonly files = new Map<string, FakeFile>();
  private readonly tasks = new Map<string, FakeTask>();
  /** The findings label `/v1/tree` gives a file; none when it is not here. */
  private readonly treeLabels = new Map<string, TreeFindings>();
  private taskCount = 0;
  /** Answer the next DELETE with a 409, as for a task that ended meanwhile. */
  cancelConflict = false;
  /** Whether `GET /v1/findings` answers wait for `release`. */
  private isHoldingFindings = false;
  private waiting: (() => void)[] = [];

  constructor(private readonly options: FindingsBackendOptions = {}) {}

  /** Hold `findings` for a file; `current` signatures have a cache entry. */
  addFile(path: string, findings: Finding[] = [], current: string[] = [], isBinary = false): void {
    this.files.set(path, { findings, current: new Set(current), isBinary, counts: new Map() });
  }

  /** List `path` in `/v1/tree` with the findings label `label`. */
  listFindings(path: string, label: TreeFindings): void {
    this.treeLabels.set(path, label);
  }

  /** Count `count` findings of `signature` in a file, of which only those it holds are stored. */
  setCount(path: string, signature: string, count: number): void {
    this.files.get(path)?.counts.set(signature, count);
  }

  /** Give a file its first and last time, as read in UTC, which `ticks` spreads its columns over. */
  setTimeRange(path: string, startMs: number, endMs: number): void {
    const file = this.files.get(path);
    if (file) file.timeRange = { startMs, endMs };
  }

  /** The requests made with `method` to `pathname`. */
  requestsTo(method: string, pathname: string): FakeRequest[] {
    return this.requests.filter((r) => r.method === method && r.pathname === pathname);
  }

  /** Keep the answers of `GET /v1/findings` waiting until `release`. */
  holdFindings(): void {
    this.isHoldingFindings = true;
  }

  /** Answer every held request, and hold no more. */
  release(): void {
    this.isHoldingFindings = false;
    for (const answerNow of this.waiting.splice(0)) answerNow();
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
    Object.assign(task, { status: 'completed', result: this.scanAnswer(task) });
  }

  /**
   * The scan `id` ends with the answer for its signatures, but the cache
   * keeps nothing of it, as rx-go does for a file that grew while it was
   * scanned: a later summary lists them missing still.
   */
  completeUnkept(id: string): void {
    const task = this.task(id);
    const file = this.files.get(task.path);
    const before = new Set(file?.current);
    for (const signature of task.ids) file?.current.add(signature);
    const result = this.scanAnswer(task);
    if (file) file.current = before;
    Object.assign(task, { status: 'completed', result });
  }

  /** The answer for the signatures of `task`, as the cache holds them now. */
  private scanAnswer(task: FakeTask): FindingsResponse {
    return this.findingsAnswer(task.path, new URLSearchParams({ signatures: task.ids.join(',') }));
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
    const groups = query.getAll('group');
    const groupOf = (id: string) => TEST_SIGNATURES.find((s) => s.id === id)?.group;
    const text = (query.get('q') ?? '').toLowerCase();
    const [first, last] = (query.get('lines') ?? '1-Infinity').split('-').map(Number);
    const after = Number(query.get('after_line') ?? 0);
    const before = Number(query.get('before_line') ?? 0);
    const filtered = this.inZone(file.findings, query.get('file_tz')).filter(
      (f) =>
        checked.includes(f.signature) &&
        (only.length === 0 || only.includes(f.signature)) &&
        (groups.length === 0 || groups.includes(groupOf(f.signature) ?? '')) &&
        (text === '' || f.excerpt.toLowerCase().includes(text)) &&
        f.end_line >= first &&
        f.start_line <= last &&
        (after === 0 || f.start_line > after) &&
        (before === 0 || f.start_line < before),
    );
    // before_line lists the nearest finding first.
    if (before > 0) filtered.reverse();
    const offset = Number(query.get('offset') ?? 0);
    const limit = Number(query.get('limit') ?? 1000);
    const page = filtered.slice(offset, offset + limit);
    const width = Number(query.get('ticks') ?? 0);
    return findingsAnswer({
      state,
      checked,
      missing,
      counts,
      total: filtered.length,
      findings:
        query.get('text') === 'true'
          ? withText(
              page,
              Number(query.get('before') ?? 0),
              Number(query.get('max_bytes') || Infinity),
            )
          : page,
      ticks: width > 0 ? this.ticksOf(file, filtered, width, query.get('file_tz')) : null,
      cli_command: `rx trace --signatures=${selection.join(',')} ${path}`,
    });
  }

  /**
   * `found` with their times read in `zone` as rx-go reads them with
   * `file_tz`: a line's wall clock in a zone ahead of UTC is an earlier
   * instant.
   */
  private inZone(found: Finding[], zone: string | null): Finding[] {
    const shift = zoneOffsetMs(zone);
    if (shift === 0) return found;
    return found.map((f) => ({ ...f, time_ms: f.time_ms === null ? null : f.time_ms - shift }));
  }

  /**
   * The `ticks` of rx-go: column k holds the findings whose time t has
   * floor((t - start) * width / (end - start + 1)) = k, over the file's
   * time range read in `zone`; per signature, the count and the first
   * finding's start line.
   */
  private ticksOf(file: FakeFile, found: Finding[], width: number, zone: string | null) {
    const shift = zoneOffsetMs(zone);
    const range = file.timeRange;
    const startMs = range ? range.startMs - shift : null;
    const endMs = range ? range.endMs - shift : null;
    const columns = new Map<number, Record<string, { count: number; first_line: number }>>();
    if (startMs !== null && endMs !== null) {
      const span = endMs - startMs + 1;
      for (const f of found) {
        if (f.time_ms === null || f.time_ms < startMs || f.time_ms > endMs) continue;
        const column = Math.floor(((f.time_ms - startMs) * width) / span);
        const bySignature = columns.get(column) ?? {};
        const seen = bySignature[f.signature];
        bySignature[f.signature] = {
          count: (seen?.count ?? 0) + 1,
          first_line: Math.min(seen?.first_line ?? Infinity, f.start_line),
        };
        columns.set(column, bySignature);
      }
    }
    return {
      start_ms: startMs,
      end_ms: endMs,
      width,
      columns: [...columns.keys()]
        .sort((a, b) => a - b)
        .map((column) => ({ column, signatures: columns.get(column) ?? {} })),
    };
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
      files_done: null,
      files_total: null,
      cli_command: task.cliCommand,
      result: task.result,
    };
  }

  private startScan(body: Record<string, unknown> | undefined): Answer {
    const path = String(body?.path ?? '');
    const running = [...this.tasks.values()].find(
      (t) => t.path === path && (t.status === 'queued' || t.status === 'running'),
    );
    if (running) {
      return answer(202, {
        task_id: running.id,
        status: running.status,
        path,
        message: 'Joined',
        cli_command: running.cliCommand,
      });
    }
    const id = `scan-${++this.taskCount}`;
    const selection = String(body?.signatures ?? '');
    const ids = this.resolve(selection);
    // --mask-secrets: a part only the server knows, as a server that
    // masks secrets adds it, so a command the viewer built fails a test.
    const cliCommand = `rx scan ${path} --signatures=${selection || 'default'} --mask-secrets`;
    this.tasks.set(id, {
      id,
      path,
      ids,
      cliCommand,
      status: 'queued',
      read: null,
      total: null,
      result: null,
      error: null,
    });
    return answer(202, {
      task_id: id,
      status: 'queued',
      path,
      message: 'Scanning',
      cli_command: cliCommand,
    });
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
              findings: this.treeLabels.get(file) ?? null,
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
    if (this.isHoldingFindings && request.method === 'GET' && request.pathname === '/v1/findings') {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    return this.answerFor(request);
  }
}

/** Serve `backend` as the whole backend, through a stubbed `fetch`. */
export function serveFindings(backend: FindingsBackend) {
  const spy = vi.fn((url: string, init?: RequestInit) => backend.fetch(url, init));
  vi.stubGlobal('fetch', spy);
  return spy;
}
