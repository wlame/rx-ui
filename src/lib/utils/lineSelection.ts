/**
 * The lines a user selected in a tab, as data.
 *
 * A selection is a list of line ranges in the file's own line numbers,
 * 1-based and inclusive, sorted, with ranges that touch or overlap
 * merged (`normalize`). It is held apart from the window of lines the
 * editor has loaded, so it survives paging, tab switches and a reload
 * (through the URL's `sel`).
 *
 * The URL writes a selection in the form `rx samples --lines=` reads:
 * `120-134,200,305-310`. In a log chain's tab each range names the part
 * it is in, `syslog.3.gz:120-134`, with the part's own line numbers; a
 * name is read up to the last `:`, so a name may hold one.
 *
 * Everything here is pure.
 */

/** A range of file lines, 1-based and inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

/** A range as the URL names it: in a chain's part (by its file name), or in the file (null). */
export interface SelEntry extends LineRange {
  part: string | null;
}

/** The most ranges a selection holds; a link's further ranges are dropped. */
export const MAX_SEL_RANGES = 100;

/** The ranges sorted by first line, with ranges that overlap or touch merged into one. */
export function normalize(ranges: readonly LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/** The selection with `range` added. */
export function addRange(sel: readonly LineRange[], range: LineRange): LineRange[] {
  return normalize([...sel, range]);
}

/** The selection without `line`; a range that holds it in its middle splits in two. */
export function removeLine(sel: readonly LineRange[], line: number): LineRange[] {
  return sel.flatMap((range) => {
    if (line < range.start || line > range.end) return [range];
    const pieces: LineRange[] = [];
    if (range.start < line) pieces.push({ start: range.start, end: line - 1 });
    if (line < range.end) pieces.push({ start: line + 1, end: range.end });
    return pieces;
  });
}

/**
 * The selection with its last range running from that range's first
 * line to `line`, either way, as a Shift+click does in a list. With
 * nothing selected, the line alone.
 */
export function extendLast(sel: readonly LineRange[], line: number): LineRange[] {
  const last = sel.at(-1);
  if (!last) return [{ start: line, end: line }];
  const extended = { start: Math.min(last.start, line), end: Math.max(last.start, line) };
  return normalize([...sel.slice(0, -1), extended]);
}

/** A Monaco selection's corners; a Monaco `Selection` satisfies it. */
export interface MonacoSelectionLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * The file lines Monaco's selections touch. Monaco's line 1 is the
 * window's first file line, `windowStartLine`. A selection that ends at
 * column 1 of a line does not take that line; an empty selection, a
 * cursor, takes none.
 */
export function fromMonacoSelections(
  selections: readonly MonacoSelectionLike[],
  windowStartLine: number,
): LineRange[] {
  const touched = selections.flatMap((selection) => {
    const [first, last] = orderedCorners(selection);
    const isEmpty = first.line === last.line && first.column === last.column;
    if (isEmpty) return [];
    const lastLine = last.column === 1 && last.line > first.line ? last.line - 1 : last.line;
    return [{ start: windowStartLine + first.line - 1, end: windowStartLine + lastLine - 1 }];
  });
  return normalize(touched);
}

/** A selection's two corners, the earlier one first. */
function orderedCorners(selection: MonacoSelectionLike) {
  const start = { line: selection.startLineNumber, column: selection.startColumn };
  const end = { line: selection.endLineNumber, column: selection.endColumn };
  const isStartFirst =
    start.line < end.line || (start.line === end.line && start.column <= end.column);
  return isStartFirst ? [start, end] : [end, start];
}

/** A line number as the URL writes it: plain digits, from 1 up to the safe-integer limit. */
function lineNumber(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return number >= 1 && Number.isSafeInteger(number) ? number : null;
}

/** `N` or `A-B` with 1 <= A <= B, or null. */
function readRange(text: string): LineRange | null {
  const dash = text.indexOf('-');
  const start = lineNumber(dash < 0 ? text : text.slice(0, dash));
  const end = dash < 0 ? start : lineNumber(text.slice(dash + 1));
  if (start === null || end === null || start > end) return null;
  return { start, end };
}

/** Whether `name` is a bare file name: not empty, without `/`, and neither `.` nor `..`. */
function isBareName(name: string): boolean {
  return name !== '' && !name.includes('/') && name !== '.' && name !== '..';
}

/** One comma-separated part of `sel`: a range, with the part's name before the last `:` when there is one. */
function readEntry(text: string): SelEntry | null {
  const colon = text.lastIndexOf(':');
  const part = colon < 0 ? null : text.slice(0, colon);
  if (part !== null && !isBareName(part)) return null;
  const range = readRange(text.slice(colon + 1));
  return range && { ...range, part };
}

/**
 * The selection a URL's `sel` names, read as untrusted input: a part
 * that is no valid range is dropped, and the first `MAX_SEL_RANGES`
 * valid ones are kept, in the link's order.
 */
export function parseSel(value: string | null): SelEntry[] {
  if (value === null) return [];
  const entries: SelEntry[] = [];
  for (const text of value.split(',')) {
    const entry = readEntry(text);
    if (entry) entries.push(entry);
    if (entries.length === MAX_SEL_RANGES) break;
  }
  return entries;
}

/** One range as `rx samples --lines=` writes it: `N` for one line, `A-B` otherwise. */
export function rangeText(range: LineRange): string {
  return range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
}

/** The value of `sel` for `entries`, or null to leave the key out. */
export function serializeSel(entries: readonly SelEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries
    .map((entry) => (entry.part === null ? '' : `${entry.part}:`) + rangeText(entry))
    .join(',');
}

/** A part of a log chain, by its file name, with its line count (`Infinity` when not known). */
export interface PartLines {
  name: string;
  lines: number;
}

/**
 * The entries with each range that runs past the end of its part
 * carried on into the parts after it, in the chain's order `parts`: a
 * part's lines and the next part's first lines are neighbours. What runs
 * past the last part is dropped when that part's count is known. A file
 * range (no part) and a range of a part `parts` does not list stay as
 * they are.
 */
export function splitAtParts(
  entries: readonly SelEntry[],
  parts: readonly PartLines[],
): SelEntry[] {
  return entries.flatMap((entry) => {
    const index = entry.part === null ? -1 : parts.findIndex((p) => p.name === entry.part);
    if (index < 0) return [entry];
    const out: SelEntry[] = [];
    let { start, end } = entry;
    for (const part of parts.slice(index)) {
      if (start <= part.lines) out.push({ start, end: Math.min(end, part.lines), part: part.name });
      if (end <= part.lines) break;
      start = Math.max(1, start - part.lines);
      end -= part.lines;
    }
    return out;
  });
}

/** The selection cut at `lastLine`: a range past it is dropped. The same array when none reaches past it. */
export function clampSelection(sel: LineRange[], lastLine: number): LineRange[] {
  if ((sel.at(-1)?.end ?? 0) <= lastLine) return sel;
  return sel
    .filter((range) => range.start <= lastLine)
    .map((range) => ({ start: range.start, end: Math.min(range.end, lastLine) }));
}

/** How many lines the selection holds. */
export function selectionLineCount(sel: readonly LineRange[]): number {
  return sel.reduce((count, range) => count + range.end - range.start + 1, 0);
}
