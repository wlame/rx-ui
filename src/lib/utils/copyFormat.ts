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
 * The text stays within a byte budget, counted as UTF-8. When the blocks
 * do not all fit, whole blocks are copied while they fit, and a last
 * line says how many were. Pure.
 */
import { formatSize } from './format';
import { rangeText } from './lineSelection';

/** One block of lines to copy: the file's name, its first and last line, and the lines. */
export interface CopyBlock {
  file: string;
  start: number;
  end: number;
  lines: readonly string[];
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** A block under its header, each line ended by a newline. */
function blockText(block: CopyBlock): string {
  const header = `==> ${block.file}:${rangeText(block)} <==`;
  return [header, ...block.lines].map((line) => `${line}\n`).join('');
}

/** The last line of a copy cut at the budget. */
function cutNotice(copied: number, total: number, budgetBytes: number): string {
  return `[${copied} of ${total} ranges copied: the copy stops at ${formatSize(budgetBytes)}]\n`;
}

/**
 * The text of `blocks` within `budgetBytes`, with how many blocks it
 * holds in full (`copied`) of how many were given (`total`).
 */
export function formatCopyBlocks(
  blocks: readonly CopyBlock[],
  budgetBytes: number,
): { text: string; copied: number; total: number } {
  const total = blocks.length;
  const texts = blocks.map(blockText);
  const whole = texts.join('\n');
  if (byteLength(whole) <= budgetBytes) return { text: whole, copied: total, total };

  // The notice goes after an empty line when a block comes before it.
  const noticeBytes = (copied: number) =>
    (copied > 0 ? 1 : 0) + byteLength(cutNotice(copied, total, budgetBytes));
  const kept: string[] = [];
  let used = 0;
  for (const text of texts) {
    const added = (kept.length > 0 ? 1 : 0) + byteLength(text);
    if (used + added + noticeBytes(kept.length + 1) > budgetBytes) break;
    kept.push(text);
    used += added;
  }
  const notice = cutNotice(kept.length, total, budgetBytes);
  return { text: [...kept, notice].join('\n'), copied: kept.length, total };
}
