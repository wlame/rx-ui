/**
 * What a key does in the findings list, worked out from its rows, as in
 * the file tree: ↓ and ↑ move one row, Home and End to the ends, Enter
 * opens a finding or opens and closes a header, and in the group view →
 * opens a header or goes into it and ← closes it or goes to the header
 * above. Pure: the list applies the action.
 */
import { groupKey, signatureKey, type FindingRow } from './findingRows';

/** How the panel lists the findings: in line order or under their group and signature. */
export type FindingsView = 'line' | 'group';

export type FindingsNavAction =
  | { type: 'focus'; index: number }
  | { type: 'open'; index: number }
  | { type: 'collapse'; key: string }
  | { type: 'expand'; key: string }
  | { type: 'none' };

/** The rows of a list: how many, and the row at a place. */
export interface FindingRows {
  count: number;
  rowAt(index: number): FindingRow;
}

const NONE: FindingsNavAction = { type: 'none' };

/** The depth of a row: a group's header 1, a signature's 2, a finding 3. */
export function rowLevel(row: FindingRow): number {
  if (row.kind === 'group') return 1;
  if (row.kind === 'signature') return 2;
  return 3;
}

/** A header row: a group's or a signature's. */
type HeaderRow = Extract<FindingRow, { kind: 'group' | 'signature' }>;

function isHeader(row: FindingRow): row is HeaderRow {
  return row.kind === 'group' || row.kind === 'signature';
}

/** The key of a header in the set of collapsed headers. */
function headerKey(row: HeaderRow): string {
  return row.kind === 'group' ? groupKey(row.group) : signatureKey(row.id);
}

/** Where a move lands from the row at `current` in a list of `count` rows, or null for nowhere. */
type Move = (count: number, current: number | null) => number | null;

/**
 * The keys that move the current row. A Map, so a key that names a
 * property every object has (`constructor`) is no move.
 */
const MOVES: ReadonlyMap<string, Move> = new Map<string, Move>([
  [
    'ArrowDown',
    (count, current) => {
      if (current === null) return count > 0 ? 0 : null;
      return current + 1 < count ? current + 1 : null;
    },
  ],
  [
    'ArrowUp',
    (count, current) => {
      if (current === null) return count > 0 ? 0 : null;
      return current > 0 ? current - 1 : null;
    },
  ],
  ['Home', (count) => (count > 0 ? 0 : null)],
  ['End', (count) => (count > 0 ? count - 1 : null)],
]);

/** The nearest row above `index` that is a level higher: the header that holds it. */
function headerAbove(rows: FindingRows, index: number): number | null {
  const level = rowLevel(rows.rowAt(index));
  for (let above = index - 1; above >= 0; above--) {
    if (rowLevel(rows.rowAt(above)) < level) return above;
  }
  return null;
}

/** →: open a closed header, or go into an open one; nothing on a finding. */
function expandOrEnter(rows: FindingRows, index: number): FindingsNavAction {
  const row = rows.rowAt(index);
  if (!isHeader(row)) return NONE;
  if (row.collapsed) return { type: 'expand', key: headerKey(row) };
  const next = index + 1;
  return next < rows.count && rowLevel(rows.rowAt(next)) > rowLevel(row)
    ? { type: 'focus', index: next }
    : NONE;
}

/** ←: close an open header, or go to the header above a closed one or a finding. */
function collapseOrLeave(rows: FindingRows, index: number): FindingsNavAction {
  const row = rows.rowAt(index);
  if (isHeader(row) && !row.collapsed) return { type: 'collapse', key: headerKey(row) };
  const above = headerAbove(rows, index);
  return above === null ? NONE : { type: 'focus', index: above };
}

/** Enter: open a finding, or open or close a header; nothing on a row not loaded. */
function activate(rows: FindingRows, index: number): FindingsNavAction {
  const row = rows.rowAt(index);
  if (row.kind === 'finding') return { type: 'open', index };
  if (!isHeader(row)) return NONE;
  return { type: row.collapsed ? 'expand' : 'collapse', key: headerKey(row) };
}

/**
 * What `key` does on the row at `current` (null: no row is current yet)
 * of `rows`, in `view`. ← and → act only in the group view.
 */
export function findingsKeyAction(
  rows: FindingRows,
  current: number | null,
  key: string,
  view: FindingsView,
): FindingsNavAction {
  const move = MOVES.get(key);
  if (move) {
    const target = move(rows.count, current);
    return target === null ? NONE : { type: 'focus', index: target };
  }
  if (current === null || current >= rows.count) return NONE;
  if (key === 'Enter') return activate(rows, current);
  if (view !== 'group') return NONE;
  if (key === 'ArrowRight') return expandOrEnter(rows, current);
  if (key === 'ArrowLeft') return collapseOrLeave(rows, current);
  return NONE;
}
