/**
 * The selected lines of a log chain's tab, between the tab's line
 * numbers and the parts' own.
 *
 * A chain's tab numbers the lines it holds by global line once the chain
 * is ready, and before that by positions: a part's line L at the part's
 * base plus L (`chainWindow.ts`). Either way a part's lines sit at an
 * offset, and line L of part P is the tab's line `offset(P) + L`. The
 * selection is held in the tab's numbers (`OpenFile.selectedLines`); the
 * URL names each range in its part's own numbers,
 * `sel=syslog.3.gz:120-134`, with a range that crosses into the next part
 * split there. When the tab's numbering changes (the chain becomes ready,
 * a pending chain reads another part from a new base) the selection is
 * moved through the parts' numbers, and when the chain's files change it
 * is dropped, as it may name other lines now.
 *
 * Pure.
 */
import type { ChainTab, OpenFile } from '../types';
import {
  normalize,
  splitAtParts,
  type LineRange,
  type PartLines,
  type SelEntry,
} from './lineSelection';

/** What the conversions read of a chain's tab. */
type ChainNumbers = Pick<ChainTab, 'numbering' | 'bases' | 'counts' | 'description'>;

/** The line count of a part as the tab knows it, or null. */
function knownCount(chain: ChainNumbers, part: { name: string; line_count: number | null }) {
  return part.line_count ?? chain.counts.get(part.name) ?? null;
}

/**
 * Where each part's lines sit among the tab's lines: line L of part P is
 * the tab's line `offset(P) + L`. A ready chain's parts sit at their
 * global start. A pending chain's parts sit at the bases the tab read,
 * and its other parts next to those, as far as the line counts between
 * are known.
 */
export function partOffsets(chain: ChainNumbers): Map<string, number> {
  const parts = chain.description?.parts ?? [];
  const offsets = new Map<string, number>();
  if (chain.numbering === 'global') {
    for (const part of parts) {
      if (part.global_start !== null) offsets.set(part.name, part.global_start - 1);
    }
    return offsets;
  }
  const placed: (number | null)[] = parts.map((part) => chain.bases.get(part.name) ?? null);
  // Forward: a part starts where the part before it ends.
  for (let i = 1; i < parts.length; i++) {
    const before = placed[i - 1];
    const count = knownCount(chain, parts[i - 1]);
    if (placed[i] === null && before !== null && count !== null) placed[i] = before + count;
  }
  // Back: a part ends where the part after it starts.
  for (let i = parts.length - 2; i >= 0; i--) {
    const after = placed[i + 1];
    const count = knownCount(chain, parts[i]);
    if (placed[i] === null && after !== null && count !== null) placed[i] = after - count;
  }
  parts.forEach((part, i) => {
    const offset = placed[i];
    if (offset !== null) offsets.set(part.name, offset);
  });
  return offsets;
}

/**
 * The parts of the chain in order with their line counts, for splitting
 * a range at a part edge. The active file may grow, so its count, and
 * one not known, is open (`Infinity`).
 */
function partLines(chain: ChainNumbers): PartLines[] {
  return (chain.description?.parts ?? []).map((part) => ({
    name: part.name,
    lines: part.is_active ? Infinity : (knownCount(chain, part) ?? Infinity),
  }));
}

/**
 * The URL's entries for a selection in the tab's numbers: each range in
 * the part it starts in, in that part's numbers, and split where it
 * crosses into the next part. A range before every placed part is dropped.
 */
export function chainSelEntries(ranges: readonly LineRange[], chain: ChainNumbers): SelEntry[] {
  const offsets = [...partOffsets(chain)].sort((a, b) => a[1] - b[1]);
  const entries = ranges.flatMap((range): SelEntry[] => {
    const holder = offsets.filter(([, offset]) => offset < range.start).at(-1);
    if (!holder) return [];
    const [part, offset] = holder;
    return [{ start: range.start - offset, end: range.end - offset, part }];
  });
  return splitAtParts(entries, partLines(chain));
}

/**
 * The tab's lines of the URL's entries. An entry with no part, or of a
 * part the tab cannot place, is dropped.
 */
export function chainSelRanges(entries: readonly SelEntry[], chain: ChainNumbers): LineRange[] {
  const offsets = partOffsets(chain);
  const ranges = entries.flatMap((entry) => {
    const offset = entry.part === null ? undefined : offsets.get(entry.part);
    return offset === undefined ? [] : [{ start: offset + entry.start, end: offset + entry.end }];
  });
  return normalize(ranges);
}

function isSameSelection(a: readonly LineRange[], b: readonly LineRange[]): boolean {
  return a.length === b.length && a.every((r, i) => r.start === b[i].start && r.end === b[i].end);
}

/**
 * The chain tab `after` a change of `before`, with the selection kept on
 * the same lines of the same parts: moved when the numbering changed,
 * dropped when the chain's files changed. A change that set a selection
 * itself, a file's tab, and a change that moves no line keep `after`.
 */
export function keepChainSelection(before: OpenFile, after: OpenFile): OpenFile {
  const was = before.chain;
  const now = after.chain;
  if (!was || !now || after.selectedLines.length === 0) return after;
  if (after.selectedLines !== before.selectedLines) return after;

  const wasFiles = was.description?.fingerprint;
  const nowFiles = now.description?.fingerprint;
  if (wasFiles && nowFiles && wasFiles !== nowFiles) return { ...after, selectedLines: [] };

  const isSameNumbering = was.numbering === now.numbering && was.bases === now.bases;
  if (isSameNumbering) return after;
  const moved = chainSelRanges(chainSelEntries(before.selectedLines, was), now);
  return isSameSelection(moved, before.selectedLines) ? after : { ...after, selectedLines: moved };
}
