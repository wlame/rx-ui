/**
 * What the findings panel says about a file, from the summary of a
 * findings answer (`GET /v1/findings` for the picker's selection): its
 * state line, the scan button's label, and whether a scan covered what
 * it was asked for.
 *
 * The state (`full`, `partial`, `none`) is the file's, measured against
 * the default set; `checked`, `missing` and `counts` are of the
 * selection the request sent.
 */
import type { FindingsResponse } from '../types';
import { formatCount } from './format';

/** The findings of every checked signature together, those past the stored ones included. */
export function findingsCount(summary: Pick<FindingsResponse, 'checked' | 'counts'>): number {
  return summary.checked.reduce((sum, id) => sum + (summary.counts[id]?.count ?? 0), 0);
}

/**
 * The state line: "full · N findings", "partial · K of M signatures"
 * (K checked of the M the selection names), or "not scanned".
 */
export function stateLine(
  summary: Pick<FindingsResponse, 'state' | 'checked' | 'missing' | 'counts'>,
): string {
  if (summary.state === 'none') return 'not scanned';
  if (summary.state === 'full') return `full · ${formatCount(findingsCount(summary), 'finding')}`;
  const selected = summary.checked.length + summary.missing.length;
  return `partial · ${summary.checked.length} of ${formatCount(selected, 'signature')}`;
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
