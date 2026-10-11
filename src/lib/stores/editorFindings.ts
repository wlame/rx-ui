import { derived, get, writable, type Readable } from 'svelte/store';
import { api, type FindingsQuery } from '../api';
import type { Finding, TreeFindings } from '../types';
import type { FileSummary } from '../utils/findingsSummary';
import { LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import { isChainKey } from '../utils/tabKey';
import { activeOpenFile, files } from './files';
import {
  findingsByFile,
  findingsFilter,
  filtersOf,
  findingsOf,
  openFinding,
  panelFilters,
  type FindingsTabState,
} from './findings';
import { backendHas, health } from './health';
import { notifications } from './notifications';
import { settings } from './settings';
import { loadSignatures, signatures } from './signatures';
import { tree } from './tree';

/**
 * The findings in the editor: the findings of the window of a file the
 * editor holds, which it marks, and the steps of F8 and Shift+F8 from
 * one finding to the next. Both ask `GET /v1/findings` with the findings
 * panel's filters (the picker's choice and the filter text), so the
 * editor marks and steps through what the panel lists. Both read the
 * backend's cache and never scan; neither reads a finding's text.
 */

/**
 * The most findings a window's request asks for: the backend's largest
 * page. A window holds at most five pages of 1,000 lines.
 */
export const WINDOW_FINDINGS_LIMIT = 10_000;

/** The findings of a window that has none, or whose findings are not asked for. */
export const NO_FINDINGS: readonly Finding[] = Object.freeze([]);

const state = writable(new Map<string, readonly Finding[]>());

/** The findings of the window each file's editor showed last, by path. */
export const windowFindings: Readable<Map<string, readonly Finding[]>> = {
  subscribe: state.subscribe,
};

/** The findings of `path`'s window; none for a file without. */
export function windowFindingsOf(
  map: ReadonlyMap<string, readonly Finding[]>,
  path: string,
): readonly Finding[] {
  return map.get(path) ?? NO_FINDINGS;
}

/** What a window's findings are asked with, besides the window. */
export interface MarkInputs {
  /** Whether the backend serves findings. */
  hasSignatures: boolean;
  /** The panel's filters (`panelFilters`), or null when nothing is picked. */
  filters: FindingsQuery | null;
  /** What the findings store last read each file to hold. */
  byFile: ReadonlyMap<string, FindingsTabState>;
}

/**
 * The inputs of the window requests, anew when any changes: the backend's
 * features, the picker's choice, the filter, the catalogue (which reads
 * the choice), the files' summaries and the tree's labels. The editor
 * asks again with each; a request goes out only for a new window or
 * other inputs (`requestWindowFindings`).
 */
export const markInputs: Readable<MarkInputs> = derived(
  [health, settings, findingsFilter, signatures, findingsByFile, tree],
  ([$health, $settings, $filter, $signatures, $byFile]) => ({
    hasSignatures: backendHas('signatures', $health),
    filters: filtersOf($settings.findingsPicker, $signatures, $filter),
    byFile: $byFile,
  }),
);

/** The key of the last window asked for each file, so each is asked once. */
const askedKeys = new Map<string, string>();

/** The newest window request of each file wins. */
const windowRequests = new LatestRequestMap();

/** The newest step of each file wins. */
const stepRequests = new LatestRequestMap();

/**
 * Whether what is known of `path` says it holds no findings: the store's
 * summary says none, or, before one, the tree lists it without a label.
 */
function holdsNone(listed: TreeFindings | undefined, file: FileSummary | null): boolean {
  return file ? file.state === 'none' : listed === null;
}

/**
 * Drop the window findings, the asked windows, the window requests and
 * the steps of every file but those of `keep`.
 */
export function forgetWindowFindings(keep: Iterable<string>): void {
  const kept = new Set(keep);
  for (const path of [...askedKeys.keys()]) {
    if (!kept.has(path)) askedKeys.delete(path);
  }
  windowRequests.forgetAllBut(kept);
  stepRequests.forgetAllBut(kept);
  if ([...get(state).keys()].every((path) => kept.has(path))) return;
  state.update((map) => new Map([...map].filter(([path]) => kept.has(path))));
}

/** Hold `found` as the window findings of `path`, and forget those of closed tabs. */
function holdWindowFindings(path: string, found: readonly Finding[]): void {
  const open = get(files).openFiles.map((file) => file.path);
  forgetWindowFindings([...open, path]);
  state.update((map) => new Map(map).set(path, found));
}

async function loadWindowFindings(path: string, query: FindingsQuery): Promise<void> {
  try {
    const answer = await windowRequests.run(path, (signal) =>
      api.getFindings(path, query, { signal }),
    );
    if (answer !== SUPERSEDED) holdWindowFindings(path, answer.findings);
  } catch (error) {
    // The window keeps the marks it had; it is asked again for other inputs.
    if (!isAbortError(error)) console.warn('Failed to read the findings of the window:', error);
  }
}

/**
 * Ask for the findings of lines `firstLine` to `lastLine` of `path` that
 * the panel lists, once for each window and inputs: a page the editor
 * loads, a change of the panel's choice or filter, and a scan that
 * changed what the file holds each ask again, and the newest answer
 * wins. Asks nothing for a log chain's tab, on a backend without
 * signatures, with nothing picked or for a file known to hold no
 * findings; the last two hold none for the file.
 */
export function requestWindowFindings(
  path: string,
  firstLine: number,
  lastLine: number,
  inputs: MarkInputs,
): void {
  if (!inputs.hasSignatures || isChainKey(path) || lastLine < firstLine) return;
  const file = findingsOf(inputs.byFile, path).fileSummary;
  // undefined: the tree does not list the file; null: it lists no findings.
  const listed = tree.nodeAt(path)?.findings;
  const key = JSON.stringify([
    firstLine,
    lastLine,
    inputs.filters,
    file && [file.state, file.n],
    listed === undefined ? 'unlisted' : listed,
  ]);
  if (askedKeys.get(path) === key) return;
  askedKeys.set(path, key);
  if (inputs.filters === null || holdsNone(listed, file)) {
    windowRequests.forget(path);
    holdWindowFindings(path, NO_FINDINGS);
    return;
  }
  const window: [number, number] = [firstLine, lastLine];
  void loadWindowFindings(path, { ...inputs.filters, lines: window, limit: WINDOW_FINDINGS_LIMIT });
}

/** Which way F8 (`next`) and Shift+F8 (`previous`) step. */
export type StepDirection = 'next' | 'previous';

/** The bound of a step's request: the findings that start after, or before, the anchor line. */
const STEP_BOUND: Record<StepDirection, (anchorLine: number) => FindingsQuery> = {
  next: (anchorLine) => ({ afterLine: anchorLine }),
  previous: (anchorLine) => ({ beforeLine: anchorLine }),
};

/** What a step that found nothing says. */
export const STEP_END: Record<StepDirection, string> = {
  next: 'No more findings below',
  previous: 'No more findings above',
};

const NOTHING_PICKED = 'No signatures are picked in the Findings panel.';
const NOT_SCANNED = 'This file is not scanned for the picked signatures. Open Findings to scan it.';

/** How long a step's notice shows. */
const STEP_NOTICE_MS = 2500;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runStep(path: string, anchorLine: number, direction: StepDirection) {
  await loadSignatures();
  const filters = panelFilters();
  if (filters === null) {
    notifications.info(NOTHING_PICKED, STEP_NOTICE_MS);
    return;
  }
  const query: FindingsQuery = { ...filters, ...STEP_BOUND[direction](anchorLine), limit: 1 };
  let answer;
  try {
    answer = await stepRequests.run(path, (signal) => api.getFindings(path, query, { signal }));
  } catch (error) {
    if (!isAbortError(error)) notifications.error(`Cannot read the findings: ${messageOf(error)}`);
    return;
  }
  // The answer of a step is for the tab it was asked from, while it is shown.
  if (answer === SUPERSEDED || activeOpenFile(get(files))?.path !== path) return;
  const [found] = answer.findings;
  if (found) openFinding(path, found);
  else
    notifications.info(
      answer.checked.length > 0 ? STEP_END[direction] : NOT_SCANNED,
      STEP_NOTICE_MS,
    );
}

/**
 * F8 or Shift+F8 in the editor of `path`: open the first finding the
 * panel lists that starts after (`next`) or before (`previous`) the
 * anchor line, as a click on it in the panel does, or say there is none.
 * Returns whether it acted: not in a log chain's tab, nor on a backend
 * without signatures, where the key is left to the editor.
 */
export function stepFinding(path: string, anchorLine: number, direction: StepDirection): boolean {
  if (!backendHas('signatures') || isChainKey(path)) return false;
  void runStep(path, anchorLine, direction);
  return true;
}
