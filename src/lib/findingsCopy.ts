/**
 * Copying findings from the Findings panel to the clipboard: the
 * findings of a group header, of a signature header, or every finding
 * the panel lists (Copy all), each with the lines before it that the
 * panel's ⋯ menu chose (`copyLinesBefore`).
 *
 * The text comes only from `GET /v1/findings?text=true`, which masks it
 * and stops at the end of the text the scan read; `/v1/samples` gives
 * the lines unmasked and is never asked. The requests carry the panel's
 * filters (the picker's selection and the filter text) and ask pages of
 * `FINDINGS_COPY_PAGE_SIZE` findings, each within what is left of
 * `COPY_BUDGET_BYTES`, until the list ends, the backend cuts the text
 * or the budget is spent. `utils/copyFormat.ts` lays the text out, as
 * for a copy of selected lines, and a notification says what was copied.
 */
import { get } from 'svelte/store';
import { api, type FindingsQuery } from './api';
import { COPY_BUDGET_BYTES } from './selectionCopy';
import { commandLog } from './stores/commands';
import { copyLinesBefore, panelFilters } from './stores/findings';
import { notifications } from './stores/notifications';
import { signatures, type SignaturesState } from './stores/signatures';
import type { Finding, FindingsResponse } from './types';
import { copyText } from './utils/clipboard';
import { copyBlockBytes, formatCopyBlocks, type CopyBlock, type CopyCap } from './utils/copyFormat';
import { formatCount, formatNumber, formatSize } from './utils/format';

/** The most findings one page of a copy asks for: the backend's largest page. */
export const FINDINGS_COPY_PAGE_SIZE = 10_000;

/** What a copy takes: every finding the panel lists, a group's, or one signature's. */
export type FindingsCopyTarget =
  { kind: 'all' } | { kind: 'group'; group: string } | { kind: 'signature'; id: string };

/** The filter a target adds to the panel's filters: its group, its signature, or none. */
function targetQuery(target: FindingsCopyTarget): FindingsQuery {
  if (target.kind === 'group') return { group: [target.group] };
  if (target.kind === 'signature') return { signature: [target.id] };
  return {};
}

/**
 * The value of `rx trace --signatures=` that names the target: a group
 * as `group:<name>`, a signature by its id, and for Copy all the
 * picker's selection (`default` for the default set).
 */
function signaturesWord(target: FindingsCopyTarget, selection: readonly string[]): string {
  if (target.kind === 'group') return `group:${target.group}`;
  if (target.kind === 'signature') return target.id;
  return selection.length === 0 ? 'default' : selection.join(',');
}

/** Characters a POSIX shell reads as part of a word, as rx writes its own commands. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** `word` as one shell word: as it is when every character is safe, else in single quotes. */
function shellWord(word: string): string {
  if (SHELL_SAFE.test(word)) return word;
  return `'${word.replaceAll("'", `'"'"'`)}'`;
}

/**
 * The `rx trace` command that lists the findings of a copy, with
 * `linesBefore` lines before each (`-B`, left out for none), for the
 * command log. Built here: the backend's `cli_command` of a findings
 * answer names the picker's selection, not the group or signature a
 * header narrows it to.
 */
export function findingsCopyCommand(path: string, signatures: string, linesBefore: number): string {
  const words = ['rx', 'trace', `--signatures=${shellWord(signatures)}`];
  if (linesBefore > 0) words.push('-B', String(linesBefore));
  words.push(shellWord(path));
  return words.join(' ');
}

/** The findings of a copy that came with their text, and the first answer's summary. */
interface FindingsRead {
  first: FindingsResponse;
  found: Finding[];
}

/** A finding's block in the copy. */
function blockOf(file: string, finding: Finding): CopyBlock {
  return {
    file,
    start: finding.start_line,
    end: finding.end_line,
    signature: finding.signature,
    before: finding.before ?? [],
    lines: finding.lines ?? [],
  };
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Read the findings of `query` with their text, page after page, each
 * page within what is left of the budget, until the list ends, the
 * backend cuts the text (`lines_truncated`) or the budget is spent.
 * At most one request per page of the list.
 */
async function readFindings(path: string, query: FindingsQuery): Promise<FindingsRead> {
  const name = fileName(path);
  const found: Finding[] = [];
  let first: FindingsResponse | null = null;
  let spent = 0;
  let offset = 0;
  for (;;) {
    const page = await api.getFindings(path, {
      ...query,
      offset,
      limit: FINDINGS_COPY_PAGE_SIZE,
      maxBytes: COPY_BUDGET_BYTES - spent,
    });
    first ??= page;
    const cutAt = page.findings.findIndex((f) => f.lines_truncated);
    const whole = cutAt < 0 ? page.findings : page.findings.slice(0, cutAt);
    for (const f of whole) {
      found.push(f);
      spent += copyBlockBytes(blockOf(name, f));
    }
    offset += page.findings.length;
    const isDone =
      cutAt >= 0 ||
      page.findings.length === 0 ||
      offset >= page.total ||
      spent >= COPY_BUDGET_BYTES;
    if (isDone) return { first, found };
  }
}

/** The ids of the signatures the target takes among those the answer checked. */
function targetIds(
  target: FindingsCopyTarget,
  checked: readonly string[],
  catalogue: Pick<SignaturesState, 'list'>,
): string[] {
  if (target.kind === 'signature') return checked.filter((id) => id === target.id);
  if (target.kind === 'all') return [...checked];
  const groupOf = new Map(catalogue.list.map((signature) => [signature.id, signature.group]));
  return checked.filter((id) => groupOf.get(id) === target.group);
}

/**
 * How many findings the target's signatures found and store, when one
 * of them stores fewer than it found; null when none is capped.
 */
function capOf(ids: readonly string[], summary: FindingsResponse): CopyCap | null {
  const counts = ids.map((id) => summary.counts[id]).filter((count) => count !== undefined);
  if (!counts.some((count) => count.stored < count.count)) return null;
  return {
    found: counts.reduce((sum, count) => sum + count.count, 0),
    stored: counts.reduce((sum, count) => sum + count.stored, 0),
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a notification says of a capped copy: how many its signatures found and store. */
function capText(cap: CopyCap | null): string {
  return cap ? `of ${formatNumber(cap.found)} found, ${formatNumber(cap.stored)} stored` : '';
}

/**
 * Copy the findings of `target` in the file `path` to the clipboard,
 * with the panel's filters and the lines before each that the menu
 * chose, and say what was copied, or why nothing was. Records the
 * equivalent `rx trace` command.
 */
export async function copyFindings(path: string, target: FindingsCopyTarget): Promise<void> {
  const filters = panelFilters();
  if (filters === null) {
    notifications.info('No signatures are picked in the Findings panel.', 2500);
    return;
  }
  const linesBefore = get(copyLinesBefore);
  const query: FindingsQuery = {
    ...filters,
    ...targetQuery(target),
    text: true,
    before: linesBefore,
  };
  let read: FindingsRead;
  try {
    read = await readFindings(path, query);
  } catch (error) {
    notifications.error(`Could not copy the findings: ${reasonOf(error)}`, 5000);
    return;
  }
  const { first, found } = read;
  if (first.total === 0) {
    notifications.info('No findings to copy', 2500);
    return;
  }
  const word = signaturesWord(target, filters.signatures ?? []);
  commandLog.record(findingsCopyCommand(path, word, linesBefore), 'findings');

  const cap = capOf(targetIds(target, first.checked, get(signatures)), first);
  const name = fileName(path);
  const blocks = found.map((f) => blockOf(name, f));
  const { text, copied, total } = formatCopyBlocks(blocks, COPY_BUDGET_BYTES, {
    unit: 'finding',
    total: first.total,
    cap,
  });
  if (!(await copyText(text))) {
    notifications.error('Could not copy the findings: the browser refused the clipboard', 5000);
    return;
  }
  const capped = capText(cap);
  if (copied === total) {
    const size = formatSize(new TextEncoder().encode(text).length);
    const message = `Copied ${formatCount(copied, 'finding')} (${size})`;
    notifications.success(capped ? `${message} ${capped}` : message, 3000);
  } else {
    const counted = `${formatNumber(copied)} of ${formatNumber(total)} findings`;
    const limit = `the copy stops at ${formatSize(COPY_BUDGET_BYTES)}`;
    notifications.warning(
      capped ? `Copied ${counted} (${capped}): ${limit}` : `Copied ${counted}: ${limit}`,
      5000,
    );
  }
}
