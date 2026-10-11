import { api, ApiError } from './api';
import { files, tree } from './stores';
import { commandLog } from './stores/commands';
import { chainDirectoryOf } from './utils/chainTree';
import { taskPolls, watchTask } from './utils/taskPolling';
import type {
  ChainEntry,
  ChainIndexTaskResult,
  IndexResponse,
  IndexTaskResult,
  TaskConflictError,
  TaskStatus,
  TreeEntry,
} from './types';

/**
 * The tree's context-menu items, and its Index and Re-index actions, from
 * the request to the refreshed tree badge and open file, and Index and
 * Re-index of a log chain's row. "Scan for findings" runs
 * `scanForFindings` (`scanForFindings.ts`).
 *
 * Every task of a file is followed through `taskPolls`, so an action on
 * a file whose task is already followed joins that poll instead of
 * starting another one. A chain's index task is followed through
 * `watchTask`, once per chain.
 */

export type TreeMenuAction = 'scanFindings' | 'index' | 'reindex';

export interface TreeMenuItem {
  action: TreeMenuAction;
  label: string;
}

const SCAN_ITEM: TreeMenuItem = { action: 'scanFindings', label: 'Scan for findings' };

/** What the backend lets the tree's menu do beyond indexing. */
export interface TreeMenuFeatures {
  /** The backend scans files for findings (`signatures` in `/health`). */
  canScanFindings: boolean;
}

const NO_MENU_FEATURES: TreeMenuFeatures = { canScanFindings: false };

/** The index item of a compressed file, keyed by whether it is indexed already. */
const INDEX_ITEM: Record<'true' | 'false', TreeMenuItem> = {
  false: { action: 'index', label: 'Index' },
  true: { action: 'reindex', label: 'Re-index' },
};

/**
 * The context-menu items of a tree entry.
 *
 * Only a text file has lines to scan and index; the backend answers a
 * directory or a binary file with a 400. "Scan for findings" comes first,
 * on a backend that scans. A plain file gets its index on first use, so
 * the explicit index item is offered on compressed files only.
 */
export function treeMenuItems(
  entry: Pick<TreeEntry, 'type' | 'is_text' | 'is_compressed' | 'is_indexed'>,
  features: TreeMenuFeatures = NO_MENU_FEATURES,
): TreeMenuItem[] {
  if (entry.type !== 'file' || entry.is_text === false) return [];
  const scan = features.canScanFindings ? [SCAN_ITEM] : [];
  if (!entry.is_compressed) return scan;
  return [...scan, INDEX_ITEM[entry.is_indexed ? 'true' : 'false']];
}

/**
 * The context-menu items of a log chain's row: Index, or Re-index once
 * every part it needs is indexed. A chain of more than 10,000 parts has
 * none: the backend reads no part of it.
 */
export function chainMenuItems(
  chain: Pick<ChainEntry, 'is_indexed' | 'too_many_parts'>,
): TreeMenuItem[] {
  if (chain.too_many_parts) return [];
  return [INDEX_ITEM[chain.is_indexed ? 'true' : 'false']];
}

const HTTP_CONFLICT = 409;

/** The prose form of a running task's ID in a 409: "... (task: <id>)". */
const TASK_ID_IN_PROSE = /task:\s*([^\s)]+)/i;

/**
 * The ID of the task a 409 "already indexing" names, or null.
 *
 * Reads the structured `task_id` member of the error body first, and
 * falls back to the ID in the `detail` sentence for a backend that only
 * names the task there.
 */
export function conflictTaskId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== HTTP_CONFLICT) return null;
  try {
    // Parsed, not trusted: a backend older than the field sends only `detail`.
    const body = JSON.parse(error.body) as Partial<TaskConflictError> | null;
    if (typeof body?.task_id === 'string' && body.task_id) return body.task_id;
  } catch {
    // Not JSON: only the prose can name the task.
  }
  return TASK_ID_IN_PROSE.exec(error.message)?.[1] ?? null;
}

interface IndexRequest {
  force: boolean;
  /** MB; 0 indexes a file of any size, which an explicit request wants. */
  threshold?: number;
}

/** Index requests wait for no dialog: their poll runs until the task ends. */
const NEVER_ABORTED = new AbortController().signal;

/** Start an index task, or join the one a 409 names, and wait for its result. */
async function runIndexTask(
  path: string,
  request: IndexRequest,
  signal: AbortSignal,
  onStatus?: (task: TaskStatus) => void,
): Promise<IndexTaskResult> {
  let taskId: string;
  try {
    taskId = (await api.startIndex(path, request)).task_id;
  } catch (error) {
    const runningTaskId = conflictTaskId(error);
    if (!runningTaskId) throw error;
    taskId = runningTaskId;
  }
  return taskPolls.join(path, taskId, { signal, onStatus });
}

/**
 * Show a freshly built index in the tree and in the open file, and its
 * equivalent command in the command line.
 */
function publishIndex(path: string, indexData: IndexResponse): IndexResponse {
  tree.markIndexed(path, indexData.line_count ?? null);
  files.applyIndex(path, indexData);
  commandLog.record(indexData.cli_command, 'index');
  return indexData;
}

export interface IndexOptions {
  /** Rebuild an index that exists; without it the backend returns the cached one. */
  reindex: boolean;
}

/**
 * Build a file's index whatever its size, and show it in the tree and
 * the open file.
 */
export async function indexFile(path: string, options: IndexOptions): Promise<IndexResponse> {
  const request: IndexRequest = { force: options.reindex, threshold: 0 };
  const result = await runIndexTask(path, request, NEVER_ABORTED);
  return publishIndex(path, result);
}

/**
 * How a chain's index task ended: `completed`, or `ended` when the
 * backend no longer knew the task (it keeps a finished task for a while
 * only), so only the listing says what it left.
 */
export type ChainIndexOutcome = { kind: 'completed' } | { kind: 'ended' };

/** The index run of each chain, by handle: a second request while one runs joins it. */
const chainIndexRuns = new Map<string, Promise<ChainIndexOutcome>>();

/** Requests that met the chain's files changing (a 409) sent again before giving up. */
const CHANGED_FILES_RETRIES = 1;

function nameOf(handle: string): string {
  return handle.slice(handle.lastIndexOf('/') + 1);
}

/**
 * Start or join the chain's index task, and return its ID. The backend
 * answers 409 when a part was replaced while it read the chain; the
 * request is sent once more, then refused.
 */
async function startChainIndex(handle: string, force: boolean): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const answer = await api.logIndex(handle, { force });
    if (answer.kind === 'task') return answer.task.task_id;
    if (attempt >= CHANGED_FILES_RETRIES) {
      throw new Error(`The files of ${nameOf(handle)} keep changing on disk; index it again later`);
    }
  }
}

function isChainIndexResult(result: TaskStatus['result']): result is ChainIndexTaskResult {
  return result !== null && 'built' in result;
}

/**
 * Build the chain's indexes and follow the task to its end; then show
 * what it built: the parts' tree badges, the chain's row (its directory's
 * chains listed again), its open tab (described again) and the command.
 */
async function runChainIndex(handle: string, force: boolean): Promise<ChainIndexOutcome> {
  const taskId = await startChainIndex(handle, force);
  const end = await watchTask(taskId, {
    fetchStatus: (id, signal) => api.getTaskStatus(id, { signal }),
    signal: NEVER_ABORTED,
  });
  if (end.kind === 'failed') {
    throw new Error(end.task.error || `The index task of ${nameOf(handle)} failed`);
  }
  const dir = chainDirectoryOf(handle);
  if (end.kind === 'completed' && isChainIndexResult(end.task.result)) {
    const result = end.task.result;
    for (const name of result.built) tree.markIndexed(`${dir}/${name}`, null);
    commandLog.record(result.cli_command, 'index');
  }
  await Promise.all([tree.refreshChains(dir), files.refreshChain(handle)]);
  return { kind: end.kind === 'completed' ? 'completed' : 'ended' };
}

/**
 * Build the line index of every part of the log chain `handle` (every
 * part again on re-index), and resolve when the chain's index task has
 * ended. Rejects with the task's error when it fails. A request while
 * the chain's index runs joins that run.
 */
export function indexChain(handle: string, options: IndexOptions): Promise<ChainIndexOutcome> {
  const running = chainIndexRuns.get(handle);
  if (running) return running;
  const run = runChainIndex(handle, options.reindex).finally(() => chainIndexRuns.delete(handle));
  chainIndexRuns.set(handle, run);
  return run;
}
