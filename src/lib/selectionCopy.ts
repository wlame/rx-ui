/**
 * Copying a tab's selected lines to the clipboard.
 *
 * All ranges are asked in one samples request, without context lines:
 * `/v1/samples` for a file's tab, `/v1/logs/samples` by global line for
 * a ready log chain's tab, which answers each range as pieces, one per
 * part it touches. The answer's command goes to the command log. The
 * text is laid out by `utils/copyFormat.ts` within `COPY_BUDGET_BYTES`,
 * and a notification says what was copied.
 */
import { api, type LogSamplesAnswer } from './api';
import { commandLog } from './stores/commands';
import { notifications } from './stores/notifications';
import type { OpenFile } from './types';
import { copyText } from './utils/clipboard';
import { formatCopyBlocks, type CopyBlock } from './utils/copyFormat';
import { formatCount, formatSize } from './utils/format';
import { rangeText } from './utils/lineSelection';

/** The most bytes a copy puts on the clipboard: 8 MiB. */
export const COPY_BUDGET_BYTES = 8 * 1024 * 1024;

/** The blocks of a copy, and what produced them, as the command log records it. */
interface CopyRead {
  blocks: CopyBlock[];
  command: string | null;
  details: string[];
}

/**
 * Whether the tab's selection can be copied: a file's tab, or a log
 * chain's tab whose lines carry global numbers (a ready chain). A pending
 * chain numbers its lines by positions in the parts it read, which no
 * request names.
 */
export function canCopySelection(file: OpenFile): boolean {
  return file.chain === undefined || file.chain.numbering === 'global';
}

/** The selected lines of a file's tab, one block per range. */
async function readFileRanges(file: OpenFile): Promise<CopyRead> {
  const keys = file.selectedLines.map(rangeText);
  const answer = await api.getSamples(file.path, keys, 0);
  if (answer.kind !== 'samples') throw new Error('the file is still being indexed');
  const { samples } = answer;
  const blocks = file.selectedLines.flatMap((range, i) => {
    const lines = samples.samples[keys[i]];
    return lines ? [{ file: file.name, start: range.start, end: range.end, lines }] : [];
  });
  return { blocks, command: samples.cli_command, details: [] };
}

/** Why a chain's answer holds no lines, in words. */
const CHAIN_REFUSALS: Record<Exclude<LogSamplesAnswer['kind'], 'samples'>, string> = {
  building: 'the chain is still being indexed',
  changed: 'the files of the chain changed; select the lines again',
  invalid: 'the chain cannot be read as one text',
};

/** The selected lines of a ready chain's tab, one block per piece: each in its part's own numbers. */
async function readChainRanges(file: OpenFile, handle: string): Promise<CopyRead> {
  const keys = file.selectedLines.map(rangeText);
  const fingerprint = file.chain?.description?.fingerprint;
  const answer = await api.logSamples({ handle, lines: keys, context: 0 }, { fingerprint });
  if (answer.kind !== 'samples') throw new Error(CHAIN_REFUSALS[answer.kind]);
  const pieces = keys.flatMap((key) => answer.samples.samples[key] ?? []);
  const blocks = pieces.map((piece) => ({
    file: piece.part,
    start: piece.first_local_line,
    end: piece.first_local_line + piece.lines.length - 1,
    lines: piece.lines,
  }));
  return {
    blocks,
    command: answer.samples.cli_command,
    details: pieces.map((piece) => piece.cli_command),
  };
}

/** Why a copy failed, in words. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Copy the selected lines of `file` to the clipboard, and say what was
 * copied, or why nothing was. Nothing happens without a selection or for
 * a tab whose selection cannot be copied (`canCopySelection`).
 */
export async function copySelection(file: OpenFile): Promise<void> {
  if (file.selectedLines.length === 0 || !canCopySelection(file)) return;
  let read: CopyRead;
  try {
    read = file.chain ? await readChainRanges(file, file.chain.handle) : await readFileRanges(file);
  } catch (error) {
    notifications.error(`Could not copy the selected lines: ${reasonOf(error)}`, 5000);
    return;
  }
  commandLog.record(read.command, 'file', read.details);

  const { text, copied, total } = formatCopyBlocks(read.blocks, COPY_BUDGET_BYTES);
  if (!(await copyText(text))) {
    notifications.error(
      'Could not copy the selected lines: the browser refused the clipboard',
      5000,
    );
    return;
  }
  if (copied === total) {
    notifications.success(`Copied ${formatCount(total, 'range')}`, 2000);
  } else {
    const limit = formatSize(COPY_BUDGET_BYTES);
    notifications.warning(`Copied ${copied} of ${total} ranges: the copy stops at ${limit}`, 5000);
  }
}
