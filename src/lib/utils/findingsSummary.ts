/**
 * What the findings panel says about a file, and about a scan of it.
 *
 * The state line speaks of the file, as its label in the tree does:
 * its state against the default set, the default signatures with a
 * current cache entry, and the findings of every current entry, opt-in
 * ones included. Those come from a summary of every signature
 * (`signatures=all`). The scan button speaks of the picker's selection:
 * the `missing` of the summary for it.
 */
import type { FindingsResponse, IndexTaskResponse } from '../types';
import { formatCount } from './format';

/** What the cache holds for a file, as its state line and its tree label say it. */
export interface FileSummary {
  /** Full: every default signature current; partial: some signature; none: no signature. */
  state: FindingsResponse['state'];
  /** How many signatures of the default set have a current entry. */
  k: number;
  /** How many signatures the default set has. */
  m: number;
  /** The findings of every current entry, opt-in ones and those past the stored ones included. */
  n: number;
}

/** The findings of every checked signature together, those past the stored ones included. */
export function findingsCount(summary: Pick<FindingsResponse, 'checked' | 'counts'>): number {
  return summary.checked.reduce((sum, id) => sum + (summary.counts[id]?.count ?? 0), 0);
}

/** The file's summary, from a summary of every signature and the ids of the default set. */
export function fileSummaryOf(
  everySignature: Pick<FindingsResponse, 'state' | 'checked' | 'counts'>,
  defaultIds: readonly string[],
): FileSummary {
  const checked = new Set(everySignature.checked);
  return {
    state: everySignature.state,
    k: defaultIds.filter((id) => checked.has(id)).length,
    m: defaultIds.length,
    n: findingsCount(everySignature),
  };
}

/**
 * The state line: "full · N findings", "partial · K of M default
 * signatures · N findings", or "not scanned".
 */
export function stateLine(file: FileSummary): string {
  if (file.state === 'none') return 'not scanned';
  const found = formatCount(file.n, 'finding');
  if (file.state === 'full') return `full · ${found}`;
  return `partial · ${file.k} of ${formatCount(file.m, 'default signature')} · ${found}`;
}

/**
 * Whether the answer of a scan request is a scan the backend already
 * had for the file (its own, or another request's): one it has started
 * is past `queued`, and rx-go names a task it hands back "Joined …",
 * running or still waiting for its turn.
 */
export function isJoinedScan(task: Pick<IndexTaskResponse, 'status' | 'message'>): boolean {
  return task.status !== 'queued' || task.message.startsWith('Joined');
}

/** The scan button's label: how many selected signatures it would scan, or "Up to date". */
export function scanLabel(missing: number): string {
  return missing > 0 ? `Scan ${missing} missing` : 'Up to date';
}

/** Whether a scan's result checked every requested signature (a joined scan may not). */
export function isCovered(
  requested: readonly string[],
  result: Pick<FindingsResponse, 'checked'>,
): boolean {
  return requested.every((id) => result.checked.includes(id));
}

/** The requested signatures a summary still lists as missing. */
export function stillMissing(
  requested: readonly string[],
  summary: Pick<FindingsResponse, 'missing'>,
): string[] {
  return requested.filter((id) => summary.missing.includes(id));
}
