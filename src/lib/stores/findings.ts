import { get, writable, type Readable } from 'svelte/store';
import { api, ApiError, type FindingsQuery } from '../api';
import type { Finding, FindingsResponse, TaskStatus } from '../types';
import { findingId, type SignatureCounts } from '../utils/findingRows';
import { selectionOf } from '../utils/findingsPicker';
import {
  fileSummaryOf,
  isCovered,
  isJoinedScan,
  isScanNotKept,
  stillMissing,
  type FileSummary,
} from '../utils/findingsSummary';
import { LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import { watchTask, type TaskEnd } from '../utils/taskPolling';
import { commandLog } from './commands';
import { files } from './files';
import { backendHas } from './health';
import { notifications } from './notifications';
import { settings } from './settings';
import { defaultSetIds, loadSignatures, signatures, type SignaturesState } from './signatures';
import { tree } from './tree';

/**
 * The findings of each file the findings panel has shown, and the scans
 * that run for them, keyed by the file's path.
 *
 * A scan belongs to its file, not to a tab or to the panel: it is
 * followed here, so it keeps running while another tab is shown or the
 * file's tab is closed, and when it ends the file's summary is read again
 * and its tree label updated. Only `cancelScan` stops it.
 *
 * The panel lists the findings of the picker's selection
 * (`AppSettings.findingsPicker`), narrowed by the filter text
 * (`findingsFilter`). The summary request brings the first page of the
 * line list; further pages, and the list of each signature the group
 * view expands, load by page (`loadFindingsPage`), each page once. The
 * group view also lists the signatures the choice hides that hold
 * findings, from the counts of every signature (`fileCounts`). Every
 * request reads the backend's cache and never scans; a finding's text
 * is its `excerpt`, masked by the backend.
 */

/** How many findings a page holds. */
export const FINDINGS_PAGE_SIZE = 200;

/** The key of the line view's list in `FindingsTabState.pages`; a signature's list is keyed by its id. */
export const LINE_LIST = '';

/** A scan running for a file: its task, the bytes read of the file's, and whether it joined another request's scan. */
export interface ScanState {
  taskId: string;
  read: number;
  total: number;
  joined: boolean;
}

/**
 * How the last scan of a file ended when its findings did not reach the
 * cache: cancelled, failed, or completed with nothing kept (`notKept`).
 */
export type ScanEnd =
  { kind: 'cancelled' } | { kind: 'failed'; message: string } | { kind: 'notKept' };

export interface FindingsTabState {
  /** The last summary of the picker's selection, or null before one arrived. */
  summary: FindingsResponse | null;
  /**
   * What the cache holds for the file, whatever is picked: its state, the
   * default signatures current (K of M) and the findings of every current
   * entry (N). The state line and the file's tree label say these
   * numbers. Null before the first summary arrived.
   */
  fileSummary: FileSummary | null;
  /**
   * The findings count of every signature with a current entry, picked
   * or not, from the same read as `fileSummary`: the group view lists a
   * hidden signature from it. Empty before the first summary arrived.
   */
  fileCounts: SignatureCounts;
  scan: ScanState | null;
  /** The finding opened last (`findingId`), the list's current row. */
  currentId: string | null;
  /** Why the summary could not be read (a file that is not text), or null. */
  error: string | null;
  scanEnd: ScanEnd | null;
  /**
   * The findings loaded of each list: `LINE_LIST`, or a signature's id.
   * Each list is a sparse array as long as the list, its loaded findings
   * at their places.
   */
  pages: ReadonlyMap<string, readonly Finding[]>;
}

const EMPTY: FindingsTabState = {
  summary: null,
  fileSummary: null,
  fileCounts: {},
  scan: null,
  currentId: null,
  error: null,
  scanEnd: null,
  pages: new Map(),
};

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

const state = writable(new Map<string, FindingsTabState>());

/** The findings state of each file, by path. */
export const findingsByFile: Readable<Map<string, FindingsTabState>> = {
  subscribe: state.subscribe,
};

/** The filter box's text, sent as `q`; not in the URL. */
export const findingsFilter = writable('');

/** The most lines before each finding a copy of findings holds. */
export const MAX_COPY_LINES_BEFORE = 3;

/** How many lines before each finding a copy of findings holds, 0 to 3; for this page only. */
export const copyLinesBefore = writable(1);

/** The findings state of `path`; empty for a file not shown yet. */
export function findingsOf(map: ReadonlyMap<string, FindingsTabState>, path: string) {
  return map.get(path) ?? EMPTY;
}

function patch(path: string, changes: (current: FindingsTabState) => Partial<FindingsTabState>) {
  state.update((map) => {
    const current = map.get(path) ?? EMPTY;
    return new Map(map).set(path, { ...current, ...changes(current) });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The newest summary request of each file wins. */
const summaries = new LatestRequestMap();

/** What the page requests of a file belong to: a summary, and the pages asked since. */
interface PageRound {
  controller: AbortController;
  asked: Set<string>;
  /** Whether its summary arrived: until then no page is asked, or it would fill the old list. */
  isReady: boolean;
}

/** The page requests of each file for its last summary; a summary request starts a new round. */
const pageRounds = new Map<string, PageRound>();

/** The poll of each file's running scan; aborting it stops following the scan. */
const scans = new Map<string, AbortController>();

/**
 * The findings the panel lists, as a request asks for them: the picker's
 * selection and the filter text. Null when nothing is picked, so the
 * panel lists nothing.
 */
export function panelFilters(): FindingsQuery | null {
  return filtersOf(get(settings).findingsPicker, get(signatures), get(findingsFilter));
}

/** The panel's filters for the stored choice `picker`, read against `catalogue`, and the filter text. */
export function filtersOf(
  picker: readonly string[] | null,
  catalogue: Pick<SignaturesState, 'list'>,
  filter: string,
): FindingsQuery | null {
  const selection = selectionOf(picker, catalogue);
  return selection === null ? null : { signatures: selection, q: filter };
}

/**
 * The query of every list request: the panel's filters, with the default
 * set when nothing is picked, so the state still reads.
 */
function listQuery(): FindingsQuery {
  return panelFilters() ?? { signatures: [], q: get(findingsFilter) };
}

/**
 * The query of a list's pages: the line list's is every list request's;
 * a signature's names it among every signature, so the list of one the
 * choice hides, which the selection leaves out, reads too.
 */
function pageQuery(list: string): FindingsQuery {
  if (list === LINE_LIST) return listQuery();
  return { signatures: ['all'], signature: [list], q: get(findingsFilter) };
}

function pageKey(list: string, page: number): string {
  return `${list}\u0000${page}`;
}

/** Start a new round of page requests for `path`, cancelling the requests of the last one. */
function newPageRound(path: string): PageRound {
  pageRounds.get(path)?.controller.abort();
  const round = {
    controller: new AbortController(),
    asked: new Set([pageKey(LINE_LIST, 0)]),
    isReady: false,
  };
  pageRounds.set(path, round);
  return round;
}

/** `pages` with `found` placed at `offset` in the list `list` of `total` findings. */
function withPage(
  pages: ReadonlyMap<string, readonly Finding[]>,
  list: string,
  total: number,
  offset: number,
  found: readonly Finding[],
): Map<string, readonly Finding[]> {
  // `slice` keeps the holes of a sparse list, where a spread would fill them.
  const placed = pages.get(list)?.slice() ?? new Array<Finding>(total);
  found.forEach((item, i) => {
    if (offset + i < placed.length) placed[offset + i] = item;
  });
  return new Map(pages).set(list, placed);
}

/** The query of a summary of every signature: which have a current entry, and their counts. */
const EVERY_SIGNATURE: FindingsQuery = { signatures: ['all'], limit: 1 };

/** Label `path` in the tree with what its summary says, when the label says something else. */
function labelInTree(path: string, file: FileSummary): void {
  const shown = tree.nodeAt(path)?.findings;
  if (shown === undefined) return;
  const isSame =
    file.state === 'none' ? shown === null : shown?.state === file.state && shown.count === file.n;
  if (!isSame) tree.markFindings(path, file.state, file.n);
}

/**
 * Read from the cache the summary of `path` for the picker's selection
 * and the filter, with the first page of its line list, and the summary
 * of every signature, which says what the file holds (`fileSummary`,
 * `fileCounts`) and labels it in the tree. The pages loaded before are
 * dropped; pages asked meanwhile wait for the new summary. Does nothing
 * on a backend without `signatures`.
 */
export async function refreshFindings(path: string): Promise<void> {
  if (!backendHas('signatures')) return;
  const round = newPageRound(path);
  await loadSignatures();
  const query: FindingsQuery = { ...listQuery(), limit: FINDINGS_PAGE_SIZE };
  let answers: [FindingsResponse, FindingsResponse] | typeof SUPERSEDED;
  try {
    answers = await summaries.run(path, (signal) =>
      Promise.all([
        api.getFindings(path, query, { signal }),
        api.getFindings(path, EVERY_SIGNATURE, { signal }),
      ]),
    );
  } catch (error) {
    if (isAbortError(error) || pageRounds.get(path) !== round) return;
    patch(path, () => ({
      summary: null,
      fileSummary: null,
      fileCounts: {},
      pages: new Map(),
      error: messageOf(error),
    }));
    return;
  }
  if (answers === SUPERSEDED) return;
  const [summary, everySignature] = answers;
  const fileSummary = fileSummaryOf(everySignature, defaultSetIds(get(signatures)));
  round.isReady = true;
  const pages = withPage(new Map(), LINE_LIST, summary.total, 0, summary.findings);
  const fileCounts = everySignature.counts;
  patch(path, () => ({ summary, fileSummary, fileCounts, pages, error: null }));
  labelInTree(path, fileSummary);
}

/**
 * Load page `page` of the list `list` of `path` (`LINE_LIST`, or a
 * signature's id), once per summary; a page that failed may be asked
 * again. Does nothing before the file's first summary.
 */
export async function loadFindingsPage(path: string, list: string, page: number): Promise<void> {
  const round = pageRounds.get(path);
  const key = pageKey(list, page);
  if (!round || !round.isReady || round.asked.has(key)) return;
  round.asked.add(key);
  const query: FindingsQuery = {
    ...pageQuery(list),
    offset: page * FINDINGS_PAGE_SIZE,
    limit: FINDINGS_PAGE_SIZE,
  };
  try {
    const answer = await api.getFindings(path, query, { signal: round.controller.signal });
    if (pageRounds.get(path) !== round) return;
    patch(path, (current) => ({
      pages: withPage(current.pages, list, answer.total, query.offset ?? 0, answer.findings),
    }));
  } catch (error) {
    if (pageRounds.get(path) !== round || isAbortError(error)) return;
    round.asked.delete(key);
    console.error('Failed to load a page of findings:', error);
  }
}

/** The findings answer a completed scan task holds, or null for any other result. */
function scanResult(task: TaskStatus): FindingsResponse | null {
  const result = task.result;
  return result !== null && 'checked' in result && 'cli_command' in result ? result : null;
}

/**
 * The signatures with a current cache entry for `path`, picked or not,
 * for the picker's marks; none when the backend does not answer.
 */
export async function currentSignatures(path: string): Promise<string[]> {
  if (!backendHas('signatures')) return [];
  try {
    return (await api.getFindings(path, EVERY_SIGNATURE)).checked;
  } catch (error) {
    console.warn('Failed to read which signatures are current for a file:', error);
    return [];
  }
}

function noteProgress(path: string, task: TaskStatus): void {
  patch(path, (current) =>
    current.scan?.taskId === task.task_id
      ? { scan: { ...current.scan, read: task.bytes_read ?? 0, total: task.bytes_total ?? 0 } }
      : {},
  );
}

/**
 * Act on how a scan of `path` ended. A completed scan records its
 * command and reads the summaries again, which updates the tree label.
 * When the summary still lists every signature it checked missing, the
 * cache kept nothing of it (the file grew while it was read), and the
 * panel says so. When it was another request's scan (its result left a
 * requested signature out) and the summary still lists one missing, the
 * missing ones are scanned once more, if `mayScanAgain`.
 */
async function settleScan(
  path: string,
  end: TaskEnd,
  requested: readonly string[],
  mayScanAgain: boolean,
): Promise<void> {
  if (end.kind === 'failed') {
    const message = end.task.error || 'The scan failed';
    patch(path, () => ({ scan: null, scanEnd: { kind: 'failed', message } }));
    return;
  }
  if (end.kind === 'cancelled') {
    patch(path, () => ({ scan: null, scanEnd: { kind: 'cancelled' } }));
    await refreshFindings(path);
    return;
  }
  const result = end.kind === 'completed' ? scanResult(end.task) : null;
  if (result) commandLog.record(result.cli_command, 'findings');
  patch(path, () => ({ scan: null }));
  await refreshFindings(path);
  const summary = findingsOf(get(state), path).summary;
  if (result && summary && isScanNotKept(requested, result, summary)) {
    patch(path, () => ({ scanEnd: { kind: 'notKept' } }));
    return;
  }
  if (!mayScanAgain || (result && isCovered(requested, result))) return;
  const left = summary ? stillMissing(requested, summary) : [];
  if (left.length > 0) await runScan(path, left, false, false);
}

async function runScan(
  path: string,
  ids: readonly string[],
  force: boolean,
  mayScanAgain: boolean,
): Promise<void> {
  if (!backendHas('signatures') || scans.has(path)) return;
  const controller = new AbortController();
  scans.set(path, controller);
  patch(path, () => ({ scan: { taskId: '', read: 0, total: 0, joined: false }, scanEnd: null }));

  let end: TaskEnd;
  try {
    const task = await api.startFindingsScan(path, [...ids], force);
    const joined = isJoinedScan(task);
    patch(path, () => ({ scan: { taskId: task.task_id, read: 0, total: 0, joined } }));
    end = await watchTask(task.task_id, {
      fetchStatus: (taskId, signal) => api.getTaskStatus(taskId, { signal }),
      signal: controller.signal,
      onStatus: (status) => noteProgress(path, status),
    });
  } catch (error) {
    // An aborted poll was stopped by `cancelScan`, which shows the end.
    if (controller.signal.aborted) return;
    patch(path, () => ({ scan: null, scanEnd: { kind: 'failed', message: messageOf(error) } }));
    return;
  } finally {
    if (scans.get(path) === controller) scans.delete(path);
  }
  await settleScan(path, end, ids, mayScanAgain);
}

/**
 * Scan `path` for the signatures `ids` (`force`: those already current
 * too), follow the scan to its end and read the summary again. Joins the
 * scan the backend already runs for the file. Nothing happens while a
 * scan of the file is followed. Resolves when the scan has ended.
 */
export function startScan(path: string, ids: readonly string[], force: boolean): Promise<void> {
  return runScan(path, ids, force, true);
}

/**
 * Cancel the scan of `path` (`DELETE /v1/tasks/{task_id}`): it stops and
 * writes nothing, and the panel shows it was cancelled. A scan that ended
 * meanwhile (409, or 404 once the backend forgot it) ends as its poll
 * reports; the summary is read again.
 */
export async function cancelScan(path: string): Promise<void> {
  const taskId = findingsOf(get(state), path).scan?.taskId;
  const controller = scans.get(path);
  if (!taskId || !controller) return;
  try {
    await api.cancelTask(taskId);
  } catch (error) {
    const hasEnded =
      error instanceof ApiError &&
      (error.status === HTTP_CONFLICT || error.status === HTTP_NOT_FOUND);
    if (hasEnded) await refreshFindings(path);
    else notifications.error(`Cannot cancel the scan: ${messageOf(error)}`, 5000);
    return;
  }
  controller.abort();
  scans.delete(path);
  patch(path, () => ({ scan: null, scanEnd: { kind: 'cancelled' } }));
  await refreshFindings(path);
}

/**
 * Open a finding of the file `path`: select its lines, move the editor
 * to its first line, and make it the list's current row. The URL then
 * holds `sel` and `line`.
 */
export function openFinding(path: string, finding: Finding): void {
  files.setSelection(path, [{ start: finding.start_line, end: finding.end_line }]);
  void files.jumpToLine(path, finding.start_line);
  patch(path, () => ({ currentId: findingId(finding) }));
}

/**
 * Drop the findings of every file but those of `keep` (the open tabs),
 * except a file whose scan runs: it is kept until the scan ends.
 */
export function forgetFindings(keep: Iterable<string>): void {
  const kept = new Set(keep);
  const isKept = (path: string) => kept.has(path) || scans.has(path);
  for (const path of [...pageRounds.keys()]) {
    if (isKept(path)) continue;
    pageRounds.get(path)?.controller.abort();
    pageRounds.delete(path);
    summaries.forget(path);
  }
  if ([...get(state).keys()].every(isKept)) return;
  state.update((map) => new Map([...map].filter(([path]) => isKept(path))));
}
