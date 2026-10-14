import type { FolderTaskResult } from '../types';
import { formatCount, formatNumber } from './format';

/**
 * The words of a task over every file of a folder, started from the
 * files panel: the folder row's label while it runs, the question before
 * it starts, and the notification that says how it ended.
 */

/** What a task over a folder does: build every file's line index, or scan every file for findings. */
export type FolderTaskKind = 'index' | 'findings';

/** The words each kind of folder task is told in. */
interface KindWords {
  /** The row's label while it runs: `scanning 12/214`. */
  running: string;
  /** The verb of the end message: `Scanned 210 files`. */
  done: string;
  /** The verb of the question and of the dialog's button: `Scan every file under logs/?`. */
  verb: string;
  /** What the task is called: `The scan of logs/ has ended`. */
  noun: string;
}

const WORDS: Record<FolderTaskKind, KindWords> = {
  index: { running: 'indexing', done: 'Indexed', verb: 'Index', noun: 'index task' },
  findings: { running: 'scanning', done: 'Scanned', verb: 'Scan', noun: 'scan' },
};

/** A folder by its last part and a slash, as the messages name it: `logs/`. */
export function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return '/';
  return `${trimmed.slice(trimmed.lastIndexOf('/') + 1)}/`;
}

/** How far a folder task is, as its row shows it. */
export interface FolderTaskProgress {
  kind: FolderTaskKind;
  /** The files ended (done, skipped or failed); null while the backend lists the folder. */
  filesDone: number | null;
  /** The files listed under the folder; null while the backend lists it. */
  filesTotal: number | null;
  /** Stop was asked and the task has not ended yet. */
  isStopping: boolean;
}

/** The folder row's label while its task runs: `scanning 12/214`, `indexing…`, `stopping…`. */
export function folderTaskLabel(task: FolderTaskProgress): string {
  if (task.isStopping) return 'stopping…';
  const running = WORDS[task.kind].running;
  if (task.filesDone === null || task.filesTotal === null) return `${running}…`;
  return `${running} ${formatNumber(task.filesDone)}/${formatNumber(task.filesTotal)}`;
}

/** The dialog's button that starts the task: Index or Scan. */
export function folderTaskVerb(kind: FolderTaskKind): string {
  return WORDS[kind].verb;
}

/** The question before the task starts: `Scan every file under logs/?`. */
export function folderTaskQuestion(kind: FolderTaskKind, path: string): string {
  return `${WORDS[kind].verb} every file under ${folderName(path)}?`;
}

/**
 * What the task will do, under the question. A scan names how many
 * signatures the Findings panel picks (`signatureCount`).
 */
export function folderTaskDescription(kind: FolderTaskKind, signatureCount: number | null): string {
  const along = 'one file at a time, in the folder and every folder under it';
  if (kind === 'index') {
    return `Builds the line index of every file, ${along}. A file whose index is up to date, and a file that is not text, is skipped.`;
  }
  const picked = formatCount(signatureCount ?? 0, 'signature');
  return `Scans every file for the ${picked} the Findings panel picks, ${along}. A file already scanned for them, and a file that is not text, is skipped.`;
}

/** How a folder task ended, as its notification tells it. */
export type FolderTaskEnd =
  | { kind: 'completed'; result: FolderTaskResult }
  | { kind: 'cancelled'; filesDone: number | null; filesTotal: number | null }
  | { kind: 'failed'; error: string }
  /** The backend no longer knows the task (a restart, or its retention ran out). */
  | { kind: 'gone' }
  /** Its status could not be read, several times in a row. */
  | { kind: 'lost'; error: string };

/** A notification: its tone (the store's method) and its text. */
export interface FolderTaskMessage {
  tone: 'success' | 'warning' | 'info' | 'error';
  message: string;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The counts of a completed task: done, then up to date, other skipped and failed when there are any. */
function completedMessage(words: KindWords, folder: string, result: FolderTaskResult) {
  const otherSkipped = result.skipped - result.current;
  const parts = [`${words.done} ${formatCount(result.done, 'file')} under ${folder}`];
  if (result.current > 0) parts.push(`${formatNumber(result.current)} up to date`);
  if (otherSkipped > 0) parts.push(`skipped ${formatNumber(otherSkipped)}`);
  if (result.failed > 0) parts.push(`failed ${formatNumber(result.failed)}`);
  const tone: FolderTaskMessage['tone'] = result.failed > 0 ? 'warning' : 'success';
  return { tone, message: parts.join(', ') };
}

type EndOf<K extends FolderTaskEnd['kind']> = Extract<FolderTaskEnd, { kind: K }>;

/** The notification of each way a folder task ends. */
const END_MESSAGES: {
  [K in FolderTaskEnd['kind']]: (w: KindWords, folder: string, end: EndOf<K>) => FolderTaskMessage;
} = {
  completed: (w, folder, end) => completedMessage(w, folder, end.result),
  cancelled: (w, folder, end) => ({
    tone: 'info',
    message:
      end.filesDone === null || end.filesTotal === null
        ? `Stopped ${w.running} ${folder}`
        : `Stopped ${w.running} ${folder} after ${formatNumber(end.filesDone)} of ${formatCount(end.filesTotal, 'file')}`,
  }),
  failed: (w, folder, end) => ({
    tone: 'error',
    message: `${capitalized(w.running)} ${folder} failed: ${end.error}`,
  }),
  gone: (w, folder) => ({ tone: 'info', message: `The ${w.noun} of ${folder} has ended` }),
  lost: (w, folder, end) => ({
    tone: 'error',
    message: `Lost track of the ${w.noun} of ${folder}: ${end.error}`,
  }),
};

/** The notification that says how the task over the folder at `path` ended. */
export function folderTaskEndMessage(
  kind: FolderTaskKind,
  path: string,
  end: FolderTaskEnd,
): FolderTaskMessage {
  const describe = END_MESSAGES[end.kind] as (
    w: KindWords,
    folder: string,
    end: FolderTaskEnd,
  ) => FolderTaskMessage;
  return describe(WORDS[kind], folderName(path), end);
}

/** The notification when the backend refused to start the task. */
export function folderTaskRefused(kind: FolderTaskKind, path: string, reason: string): string {
  return `Cannot ${WORDS[kind].verb.toLowerCase()} ${folderName(path)}: ${reason}`;
}

/** The notification when the backend refused to stop the task. */
export function folderTaskNotStopped(kind: FolderTaskKind, path: string, reason: string): string {
  return `Cannot stop the ${WORDS[kind].noun} of ${folderName(path)}: ${reason}`;
}

/** The notification when a task of the folder that was stopped has not ended yet. */
export function folderTaskStillStopping(kind: FolderTaskKind, path: string): string {
  return `The ${WORDS[kind].noun} of ${folderName(path)} is still stopping; try again in a moment`;
}

/** The notification when a scan is asked for with no signature picked. */
export function folderTaskNothingPicked(path: string): string {
  return `Pick signatures in the Findings panel to scan ${folderName(path)}`;
}
