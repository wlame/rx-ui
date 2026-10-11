/**
 * The text a copy of lines puts on the clipboard: each block of lines
 * under a header that names the file and the lines, as `tail` heads the
 * files it prints, with an empty line between blocks.
 *
 * ```
 * ==> app.log:120-134 <==
 * …lines…
 *
 * ==> app.log:200 <==
 * …line…
 * ```
 *
 * A finding's block also names its signature, and the lines before the
 * finding when it holds some, which come above its own lines:
 *
 * ```
 * ==> app.log:120-134  python-traceback  (1 line before) <==
 * …the line before…
 * …the finding's lines…
 * ```
 *
 * The text stays within a byte budget, counted as UTF-8. When the blocks
 * do not all fit, whole blocks are copied while they fit, and a last
 * line says how many were. Pure.
 */
import { formatCount, formatNumber, formatSize } from './format';
import { rangeText } from './lineSelection';

/** One block of lines to copy: the file's name, its first and last line, and the lines. */
export interface CopyBlock {
  file: string;
  start: number;
  end: number;
  /** The signature of a finding's block, named in its header. */
  signature?: string;
  /** Lines just before `start`, copied above the lines and counted in the header. */
  before?: readonly string[];
  lines: readonly string[];
}

/** What the blocks of a copy are, as its last line names them. */
export type CopyUnit = 'range' | 'finding';

/** Each unit's noun, singular and plural. */
const UNIT_NOUNS: Readonly<Record<CopyUnit, { singular: string; plural: string }>> = {
  range: { singular: 'range', plural: 'ranges' },
  finding: { singular: 'finding', plural: 'findings' },
};

/** How many findings the signatures of a copy found, and how many of them are stored. */
export interface CopyCap {
  found: number;
  stored: number;
}

export interface CopyOptions {
  /** What a block is: a range of lines (the default) or a finding. */
  unit?: CopyUnit;
  /**
   * How many blocks the copy stands for, when the blocks given are fewer
   * (the rest did not fit before they were formatted); the number of
   * blocks given by default.
   */
  total?: number;
  /** For findings of a signature that stores fewer than it found: both counts, said in a last line. */
  cap?: CopyCap | null;
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** A block's header: the file and its lines, then the signature and the lines before, if any. */
function headerOf(block: CopyBlock): string {
  const parts = [`${block.file}:${rangeText(block)}`];
  if (block.signature) parts.push(block.signature);
  const before = block.before?.length ?? 0;
  if (before > 0) parts.push(`(${formatCount(before, 'line')} before)`);
  return `==> ${parts.join('  ')} <==`;
}

/** A block under its header, each line ended by a newline. */
function blockText(block: CopyBlock): string {
  return [headerOf(block), ...(block.before ?? []), ...block.lines]
    .map((line) => `${line}\n`)
    .join('');
}

/**
 * The bytes a block takes in a copy, with the empty line that parts it
 * from the next one: what a copy of many blocks spends on it.
 */
export function copyBlockBytes(block: CopyBlock): number {
  return byteLength(blockText(block)) + 1;
}

/**
 * The last line of a copy that holds fewer blocks than it stands for, or
 * whose findings were capped; null when there is nothing to say.
 */
function copyNote(
  copied: number,
  total: number,
  budgetBytes: number,
  options: CopyOptions,
): string | null {
  const isCut = copied < total;
  const cap = options.cap ?? null;
  if (!isCut && cap === null) return null;
  const { singular, plural } = UNIT_NOUNS[options.unit ?? 'range'];
  const counted = isCut
    ? `${formatNumber(copied)} of ${formatNumber(total)} ${plural}`
    : formatCount(copied, singular, plural);
  const capped = cap
    ? ` (of ${formatNumber(cap.found)} found, ${formatNumber(cap.stored)} stored)`
    : '';
  const cut = isCut ? `: the copy stops at ${formatSize(budgetBytes)}` : '';
  return `[${counted} copied${capped}${cut}]\n`;
}

/** The blocks' texts and the note after them, an empty line between each. */
function joined(texts: readonly string[], note: string | null): string {
  return (note === null ? texts : [...texts, note]).join('\n');
}

/**
 * The text of `blocks` within `budgetBytes`, with how many blocks it
 * holds in full (`copied`) of how many the copy stands for (`total`:
 * `options.total`, or the blocks given).
 */
export function formatCopyBlocks(
  blocks: readonly CopyBlock[],
  budgetBytes: number,
  options: CopyOptions = {},
): { text: string; copied: number; total: number } {
  const total = Math.max(options.total ?? blocks.length, blocks.length);
  const noteOf = (copied: number) => copyNote(copied, total, budgetBytes, options);
  const texts = blocks.map(blockText);
  const whole = joined(texts, noteOf(texts.length));
  if (byteLength(whole) <= budgetBytes) return { text: whole, copied: texts.length, total };

  // A note goes after an empty line when a block comes before it.
  const noteBytes = (copied: number) => {
    const note = noteOf(copied);
    return note === null ? 0 : (copied > 0 ? 1 : 0) + byteLength(note);
  };
  const kept: string[] = [];
  let used = 0;
  for (const text of texts) {
    const added = (kept.length > 0 ? 1 : 0) + byteLength(text);
    if (used + added + noteBytes(kept.length + 1) > budgetBytes) break;
    kept.push(text);
    used += added;
  }
  return { text: joined(kept, noteOf(kept.length)), copied: kept.length, total };
}
