import { get, writable, type Readable } from 'svelte/store';
import { api, ApiError } from '../api';
import { conflictTaskId } from '../indexTasks';
import type { FolderTaskResult, IndexTaskResponse, TaskState, TaskStatus } from '../types';
import { pickedIds } from '../utils/findingsPicker';
import {
  folderTaskEndMessage,
  folderTaskNotStopped,
  folderTaskNothingPicked,
  folderTaskRefused,
  folderTaskStillStopping,
  type FolderTaskEnd,
  type FolderTaskKind,
  type FolderTaskProgress,
} from '../utils/folderTaskText';
import { watchTask, type TaskEnd } from '../utils/taskPolling';
import { commandLog, type CommandAction } from './commands';
import { findingsByFile, refreshFindings } from './findings';
import { backendHas } from './health';
import { notifications } from './notifications';
import { settings } from './settings';
import { loadSignatures, signatures } from './signatures';
import { holdsPath, tree } from './tree';

/**
 * The tasks over every file of a folder that the files panel starts:
 * "Index all files" (`POST /v1/index`) and "Scan all files for findings"
 * (`POST /v1/findings`, with the Findings panel's picked signatures),
 * both over the folder and every folder under it, keyed by the folder's
 * path.
 *
 * A folder's item first asks (`askFolderTask`); the app draws the
 * question (`FolderTaskDialog.svelte`) over every panel, and its answer
 * starts the task (`startFolderTask`). The task's `rx` command goes to
 * the command line from the answer that starts it. The task is followed
 * here with `watchTask` until it ends, so it outlives a panel switch; the
 * folder's row shows its progress and its menu offers Stop
 * (`stopFolderTask`). When it ends, the folder's loaded rows are listed
 * again, so their labels show what the task did, the findings the store
 * holds for a file under it are read again, and a notification says how
 * it ended. One task per folder is followed at a time.
 */

/** A task over a folder that the viewer follows. */
export interface FolderTask extends FolderTaskProgress {
  /** Its id; empty while the request that starts it is on its way. */
  taskId: string;
}

const state = writable(new Map<string, FolderTask>());

/** The followed task of each folder, by the folder's path. */
export const folderTasks: Readable<ReadonlyMap<string, FolderTask>> = {
  subscribe: state.subscribe,
};

/** The task followed for the folder at `path`, or null. */
export function folderTaskOf(path: string): FolderTask | null {
  return get(state).get(path) ?? null;
}

/** A task over a folder that waits for the user's answer. */
export interface FolderTaskAsk {
  path: string;
  kind: FolderTaskKind;
  /** How many signatures a scan uses; null for an index. */
  signatureCount: number | null;
}

const asked = writable<FolderTaskAsk | null>(null);

/** The task the folder dialog asks about, or null while it is closed. */
export const folderTaskRequest: Readable<FolderTaskAsk | null> = { subscribe: asked.subscribe };

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/** The status of a stopped task over a folder whose worker has not stopped yet. */
const CANCELLING: TaskState = 'cancelling';

/** A folder task's poll runs until the task ends; Stop asks the backend, not the poll. */
const NEVER_ABORTED = new AbortController().signal;

/** What starts each kind of task over the folder at `path`: every file, of any size, nothing forced. */
const STARTS: Record<
  FolderTaskKind,
  (path: string, ids: readonly string[]) => Promise<IndexTaskResponse>
> = {
  index: (path) => api.startIndex(path, { force: false, threshold: 0 }),
  findings: (path, ids) => api.startFindingsScan(path, [...ids], false),
};

/** The command line's action of each kind. */
const COMMAND_ACTIONS: Record<FolderTaskKind, CommandAction> = {
  index: 'index',
  findings: 'findings',
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function patch(path: string, changes: Partial<FolderTask>): void {
  state.update((map) => {
    const current = map.get(path);
    return current ? new Map(map).set(path, { ...current, ...changes }) : map;
  });
}

function forget(path: string): void {
  state.update((map) => {
    if (!map.has(path)) return map;
    const next = new Map(map);
    next.delete(path);
    return next;
  });
}

/** The ids of the signatures the Findings panel picks, once the catalogue is loaded. */
async function pickedSignatures(): Promise<string[]> {
  await loadSignatures();
  return pickedIds(get(settings).findingsPicker, get(signatures));
}

/**
 * Ask the user to confirm a task over every file of the folder at
 * `path`: the folder dialog opens. A scan with no signature picked asks
 * nothing and says why.
 */
export async function askFolderTask(path: string, kind: FolderTaskKind): Promise<void> {
  const signatureCount = kind === 'findings' ? (await pickedSignatures()).length : null;
  if (signatureCount === 0) {
    notifications.warning(folderTaskNothingPicked(path));
    return;
  }
  asked.set({ path, kind, signatureCount });
}

/** Close the folder dialog without starting anything. */
export function closeFolderTaskRequest(): void {
  asked.set(null);
}

/**
 * What a start request did: started or joined a task (with its command
 * when the answer gave one), or met a stopped task of the folder that
 * still holds it.
 */
type StartAnswer = { kind: 'started'; taskId: string; command: string } | { kind: 'stopping' };

/**
 * Start the task, or join the one a 409 names for the folder, unless
 * that one was stopped and has not ended: then nothing can start yet.
 */
async function startOrJoin(
  path: string,
  kind: FolderTaskKind,
  ids: readonly string[],
): Promise<StartAnswer> {
  try {
    const answer = await STARTS[kind](path, ids);
    return { kind: 'started', taskId: answer.task_id, command: answer.cli_command };
  } catch (error) {
    const runningTaskId = conflictTaskId(error);
    if (!runningTaskId) throw error;
    const running = await api.getTaskStatus(runningTaskId);
    if (running.status === CANCELLING) return { kind: 'stopping' };
    return { kind: 'started', taskId: runningTaskId, command: running.cli_command };
  }
}

/** A status's counts, and whether it says the task is stopping. */
function progressOf(status: TaskStatus): Partial<FolderTask> {
  const counts = { filesDone: status.files_done, filesTotal: status.files_total };
  return status.status === CANCELLING ? { ...counts, isStopping: true } : counts;
}

function isFolderResult(result: TaskStatus['result']): result is FolderTaskResult {
  return result !== null && 'files_total' in result && 'skipped_files' in result;
}

type TaskEndOf<K extends TaskEnd['kind']> = Extract<TaskEnd, { kind: K }>;

/** How each end of the poll is told, with the counts the folder's row showed last. */
const END_OF: {
  [K in TaskEnd['kind']]: (end: TaskEndOf<K>, shown: FolderTask | null) => FolderTaskEnd;
} = {
  completed: (end) =>
    isFolderResult(end.task.result)
      ? { kind: 'completed', result: end.task.result }
      : { kind: 'gone' },
  cancelled: (end, shown) => ({
    kind: 'cancelled',
    filesDone: end.task.files_done ?? shown?.filesDone ?? null,
    filesTotal: end.task.files_total ?? shown?.filesTotal ?? null,
  }),
  failed: (end) => ({ kind: 'failed', error: end.task.error || 'the backend gave no reason' }),
  gone: () => ({ kind: 'gone' }),
};

function endOf(end: TaskEnd, shown: FolderTask | null): FolderTaskEnd {
  const tell = END_OF[end.kind] as (end: TaskEnd, shown: FolderTask | null) => FolderTaskEnd;
  return tell(end, shown);
}

/** Read again the findings the store holds for files under the folder at `path`. */
async function refreshFindingsUnder(path: string): Promise<void> {
  const held = [...get(findingsByFile).keys()].filter((file) => holdsPath(path, file));
  await Promise.all(held.map((file) => refreshFindings(file)));
}

/**
 * The task over the folder at `path` has ended: the folder shows no task,
 * a notification says how it ended, and the folder's loaded rows (and
 * after a scan the findings held for its files) are read again.
 */
async function settle(path: string, kind: FolderTaskKind, end: FolderTaskEnd): Promise<void> {
  forget(path);
  const { tone, message } = folderTaskEndMessage(kind, path, end);
  notifications.show(tone, message);
  await Promise.all([
    tree.reloadFolder(path),
    kind === 'findings' ? refreshFindingsUnder(path) : Promise.resolve(),
  ]);
}

/** Record the task's command in the command line; false when it has none. */
function recordCommand(command: string | null | undefined, kind: FolderTaskKind): boolean {
  if (!command) return false;
  commandLog.record(command, COMMAND_ACTIONS[kind]);
  return true;
}

/**
 * Start a task over every file of the folder at `path`, or join the one
 * the backend runs for it, and follow it to its end. A scan takes the
 * signatures the Findings panel picks; with none picked nothing starts.
 * While a stopped task of the folder has not ended, nothing starts and a
 * notification asks to try again. A scan starts only on a backend that
 * serves signatures.
 * The task's command goes to the command line as soon as it is known.
 * Nothing starts while a task of the folder is followed. Resolves once
 * the task has ended and the folder's rows are read again.
 */
export async function startFolderTask(path: string, kind: FolderTaskKind): Promise<void> {
  if (get(state).has(path)) return;
  if (kind === 'findings' && !backendHas('signatures')) return;
  state.update((map) =>
    new Map(map).set(path, {
      kind,
      taskId: '',
      filesDone: null,
      filesTotal: null,
      isStopping: false,
    }),
  );
  const ids = kind === 'findings' ? await pickedSignatures() : [];
  if (kind === 'findings' && ids.length === 0) {
    forget(path);
    notifications.warning(folderTaskNothingPicked(path));
    return;
  }

  let started: StartAnswer;
  try {
    started = await startOrJoin(path, kind, ids);
  } catch (error) {
    forget(path);
    notifications.error(folderTaskRefused(kind, path, messageOf(error)));
    return;
  }
  if (started.kind === 'stopping') {
    forget(path);
    notifications.info(folderTaskStillStopping(kind, path));
    return;
  }
  patch(path, { taskId: started.taskId });
  let isRecorded = recordCommand(started.command, kind);

  let end: TaskEnd;
  try {
    end = await watchTask(started.taskId, {
      fetchStatus: (taskId, signal) => api.getTaskStatus(taskId, { signal }),
      signal: NEVER_ABORTED,
      onStatus: (status) => {
        if (!isRecorded) isRecorded = recordCommand(status.cli_command, kind);
        patch(path, progressOf(status));
      },
    });
  } catch (error) {
    await settle(path, kind, { kind: 'lost', error: messageOf(error) });
    return;
  }
  await settle(path, kind, endOf(end, folderTaskOf(path)));
}

/**
 * Stop the task followed for the folder at `path`
 * (`DELETE /v1/tasks/{task_id}`): the folder shows it stopping until its
 * poll sees it end (`cancelling` is not an end), which tells how far it
 * got. A task that ended
 * meanwhile (409, or 404 once the backend forgot it) is left to its
 * poll, which reports its end.
 */
export async function stopFolderTask(path: string): Promise<void> {
  const task = folderTaskOf(path);
  if (!task || task.taskId === '' || task.isStopping) return;
  try {
    await api.cancelTask(task.taskId);
  } catch (error) {
    const hasEnded =
      error instanceof ApiError &&
      (error.status === HTTP_CONFLICT || error.status === HTTP_NOT_FOUND);
    if (!hasEnded) notifications.error(folderTaskNotStopped(task.kind, path, messageOf(error)));
    return;
  }
  patch(path, { isStopping: true });
}
