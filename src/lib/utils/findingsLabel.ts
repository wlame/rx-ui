/**
 * The yellow label of a file the findings cache holds an answer for, in
 * the files panel and the editor header: its state and its findings
 * count, and the tooltip that says what they mean.
 *
 * The tooltip says K, the default signatures current for the file, only
 * from a summary the session read whose state and count are the label's:
 * the label comes from the tree's listing, which a reload can make newer
 * than the summary. No hover asks the backend.
 */
import type { TreeFindings } from '../types';
import type { FileSummary } from './findingsSummary';
import { formatCount, formatNumber } from './format';

/** A file's findings label: full or partial, and the findings of every current entry. */
export type FindingsLabel = NonNullable<TreeFindings>;

/** What the tooltip can say of how far a file is scanned. */
type ScanKnowledge = 'full' | 'someOf' | 'kOf' | 'optInOnly';

/** The parts of a tooltip: M, the default set; K, its current signatures; N, the findings. */
interface TooltipNumbers {
  /** "58 default signatures", or "default signatures" before the catalogue is loaded. */
  defaults: string;
  k: number;
  /** "45 findings". */
  found: string;
}

/** The tooltip of each case. */
const TOOLTIPS: Record<ScanKnowledge, (n: TooltipNumbers) => string> = {
  full: (n) => `Scanned with all ${n.defaults}: ${n.found}.`,
  kOf: (n) =>
    `Scanned with ${formatNumber(n.k)} of ${n.defaults}: ${n.found}. Open Findings to scan the rest.`,
  someOf: (n) =>
    `Scanned with some of the ${n.defaults}: ${n.found}. Open Findings to scan the rest.`,
  optInOnly: (n) =>
    `Scanned with opt-in signatures only: ${n.found}. Open Findings to scan the defaults.`,
};

/** Which case a label is, given the summary the session holds for its file. */
function knowledgeOf(label: FindingsLabel, file: FileSummary | null): ScanKnowledge {
  if (label.state === 'full') return 'full';
  const isSameAnswer = file !== null && file.state === label.state && file.n === label.count;
  if (!isSameAnswer) return 'someOf';
  return file.k === 0 ? 'optInOnly' : 'kOf';
}

/**
 * The tooltip of a file's label: "Scanned with all M default signatures:
 * N findings." for a full file; for a partial one, K of M when `file`,
 * the summary the session holds for it, says the same state and count,
 * "opt-in signatures only" when that summary counts no default
 * signature, and "some of the M" otherwise. `m` is the size of the
 * default set, 0 before the catalogue is loaded.
 */
export function findingsLabelTitle(
  label: FindingsLabel,
  file: FileSummary | null,
  m: number,
): string {
  const numbers: TooltipNumbers = {
    defaults: m > 0 ? formatCount(m, 'default signature') : 'default signatures',
    k: file?.k ?? 0,
    found: formatCount(label.count, 'finding'),
  };
  return TOOLTIPS[knowledgeOf(label, file)](numbers);
}

/**
 * The label of an open file: the tree's, when the tree lists the file
 * (`listed`; null when it lists it without findings), else the one the
 * summary the session read says, else none.
 */
export function findingsLabelOf(
  listed: TreeFindings | undefined,
  file: FileSummary | null,
): FindingsLabel | null {
  if (listed !== undefined) return listed;
  if (file === null || file.state === 'none') return null;
  return { state: file.state, count: file.n };
}
