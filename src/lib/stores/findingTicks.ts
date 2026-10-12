import { get } from 'svelte/store';
import { api, type FindingsQuery } from '../api';
import { LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import { isChainKey } from '../utils/tabKey';
import type { TimeAxis } from '../utils/timeline';
import { holdsNoFindings, type MarkInputs } from './editorFindings';
import { activeOpenFile, files } from './files';
import { findingsOf, openFinding, panelFilters } from './findings';
import { notifications } from './notifications';
import { tree } from './tree';

/**
 * The findings of the active file on the timeline: which request asks
 * for its ticks, and what a click on a tick opens.
 *
 * The ticks come from `GET /v1/findings?ticks=W`, W the track's width in
 * pixels, with the Findings panel's filters (the picker's choice and the
 * filter text), so the timeline shows what the panel lists, and in the
 * zone the tab reads the file in (`file_tz`), so the columns span the
 * same instants as the axis. The request reads the backend's cache and
 * never scans.
 */

/** The most columns `ticks=W` takes. */
export const MAX_TICK_COLUMNS = 4000;

/** What the ticks of a file are asked with. */
export interface TicksInputs {
  /** The track's width in pixels: one column per pixel. */
  width: number;
  /** The axis the timeline draws; another range asks again. */
  axis: TimeAxis;
  /** The zone the tab reads the file in, when one is chosen and the backend takes `file_tz`. */
  zone: string | undefined;
  /** The backend's features, the panel's filters and what the store read each file to hold. */
  marks: MarkInputs;
}

/** A ticks request: its query, and a key that is the same only for the same request. */
export interface TicksRequest {
  key: string;
  query: FindingsQuery;
}

/**
 * The request for the ticks of `path`, or null when none is asked: on a
 * backend without signatures, for a log chain's tab, with nothing picked,
 * for a track not laid out, or for a file known to hold no findings. Its
 * key changes with the width, the filters, the zone, the axis and what a
 * scan changed in the file (the summary's state and count, the tree's
 * label), so each of those asks again.
 */
export function ticksRequestOf(path: string, inputs: TicksInputs): TicksRequest | null {
  const { marks } = inputs;
  const columns = Math.min(MAX_TICK_COLUMNS, Math.floor(inputs.width));
  if (!marks.hasSignatures || isChainKey(path) || marks.filters === null || columns < 1) {
    return null;
  }
  const file = findingsOf(marks.byFile, path).fileSummary;
  // undefined: the tree does not list the file; null: it lists no findings.
  const listed = tree.nodeAt(path)?.findings;
  if (holdsNoFindings(listed, file)) return null;
  const query: FindingsQuery = {
    ...marks.filters,
    ticks: columns,
    limit: 1,
    ...(inputs.zone ? { fileTz: inputs.zone } : {}),
  };
  const key = JSON.stringify([
    path,
    query,
    inputs.axis.startMs,
    inputs.axis.endMs,
    file && [file.state, file.n],
    listed === undefined ? 'unlisted' : listed,
  ]);
  return { key, query };
}

/** The newest click of each file wins. */
const openRequests = new LatestRequestMap();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A click on a tick: open the first finding of the tick's `signatures`
 * (its group's in its column) that the panel lists and that starts on
 * `line` or after it, as a click on it in the list does (its lines
 * selected, the editor at its first line). `line` is the first line of
 * the group's first finding in the column, so that finding is the one
 * opened unless a scan changed the file meanwhile, and never another
 * group's finding on the same line. Nothing happens once another tab is
 * shown.
 */
export async function openTickFinding(
  path: string,
  line: number,
  signatures: readonly string[],
): Promise<void> {
  const filters = panelFilters();
  if (filters === null) return;
  const query: FindingsQuery = {
    ...filters,
    signature: [...signatures],
    afterLine: line - 1,
    limit: 1,
  };
  let answer;
  try {
    answer = await openRequests.run(path, (signal) => api.getFindings(path, query, { signal }));
  } catch (error) {
    if (!isAbortError(error)) notifications.error(`Cannot read the findings: ${messageOf(error)}`);
    return;
  }
  if (answer === SUPERSEDED || activeOpenFile(get(files))?.path !== path) return;
  const [found] = answer.findings;
  if (found) openFinding(path, found);
  else void files.jumpToLine(path, line);
}
