/**
 * A folder's rows from its listing, for the tree store. A listing read
 * again is merged into the rows the folder shows: a row the listing did
 * not change stays the same object, and a listing that says nothing new
 * gives back the same rows, so the store changes nothing and the panel
 * draws nothing again.
 *
 * Everything here is pure, so it is tested without a backend.
 */
import type { TreeEntry, TreeNode } from '../types';

/** A listed entry as a closed row at `level`, with no rows of its own. */
export function entryToNode(entry: TreeEntry, level: number): TreeNode {
  return {
    ...entry,
    expanded: false,
    loading: false,
    children: [],
    level,
  };
}

/**
 * The fields a row keeps over what a listing says, by the row's path:
 * those that a mark made after the listing was asked set (`RecentMarks`).
 */
export type KeptFields = (path: string) => Partial<TreeEntry> | undefined;

const NO_KEPT_FIELDS: KeptFields = () => undefined;

/** Whether two field values are equal; an object (such as `findings`) by its own fields. */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aFields = a as Record<string, unknown>;
  const bFields = b as Record<string, unknown>;
  const keys = Object.keys(aFields);
  return (
    keys.length === Object.keys(bFields).length &&
    keys.every((key) => aFields[key] === bFields[key])
  );
}

/** Whether `row` already holds every field of `fields`. */
function holdsFields(row: TreeNode, fields: Partial<TreeEntry>): boolean {
  const held = row as unknown as Record<string, unknown>;
  return Object.entries(fields).every(([key, value]) => isSameValue(held[key], value));
}

/**
 * `entries`, a folder's listing, as its rows at `level`. An entry the
 * folder already shows keeps its row (open or closed, its own rows and
 * its chains) and takes the listing's fields, except those `keptFields`
 * names; it stays the same object when they change nothing. A new entry,
 * or one whose kind changed, is a closed row, and a row the listing
 * leaves out goes, with its own rows. When nothing changed, `rows`
 * itself comes back.
 */
export function mergeListing(
  rows: TreeNode[],
  entries: readonly TreeEntry[],
  level: number,
  keptFields: KeptFields = NO_KEPT_FIELDS,
): TreeNode[] {
  const shown = new Map(rows.map((row) => [row.path, row]));
  const merged = entries.map((entry) => {
    const row = shown.get(entry.path);
    if (!row || row.type !== entry.type) return entryToNode(entry, level);
    const fields = { ...entry, ...keptFields(entry.path) };
    return holdsFields(row, fields) ? row : { ...row, ...fields };
  });
  const isUnchanged = merged.length === rows.length && merged.every((row, i) => row === rows[i]);
  return isUnchanged ? rows : merged;
}

/**
 * Whether the file rows of `after` differ from those of `before`: a file
 * came, went, or changed a field. `mergeListing` keeps an unchanged row
 * as the same object, so the rows compare by identity. A folder's chains
 * are made of its files, so only these can change them.
 */
export function haveFilesChanged(before: readonly TreeNode[], after: readonly TreeNode[]): boolean {
  const filesBefore = before.filter((row) => row.type !== 'directory');
  const filesAfter = after.filter((row) => row.type !== 'directory');
  return (
    filesBefore.length !== filesAfter.length || filesAfter.some((row, i) => row !== filesBefore[i])
  );
}

/**
 * The fields the tree set on rows by itself (a built index, a scan's
 * findings) while listings were on their way: a listing asked before
 * such a mark may hold the fields from before it, and must not undo it.
 * Marks are kept only while a listing is on its way; once none is, they
 * are dropped, so they hold at most the rows marked meanwhile.
 */
export class RecentMarks {
  private count = 0;
  private listings = 0;
  private readonly marks = new Map<string, { at: number; fields: Partial<TreeEntry> }>();

  /** How many rows hold a kept mark. */
  get size(): number {
    return this.marks.size;
  }

  /** A listing is asked now; the number it gives reads the marks made after it. */
  listingAsked(): number {
    this.listings++;
    return this.count;
  }

  /** A listing asked with `listingAsked` has ended, shown or not. */
  listingEnded(): void {
    this.listings = Math.max(0, this.listings - 1);
    if (this.listings === 0) this.marks.clear();
  }

  /** The tree set `fields` on the row at `path`. */
  note(path: string, fields: Partial<TreeEntry>): void {
    this.count++;
    if (this.listings === 0) return;
    const fieldsBefore = this.marks.get(path)?.fields;
    this.marks.set(path, { at: this.count, fields: { ...fieldsBefore, ...fields } });
  }

  /** The fields a listing asked at `askedAt` keeps: those marked after it. */
  newerThan(askedAt: number): KeptFields {
    return (path) => {
      const mark = this.marks.get(path);
      return mark && mark.at > askedAt ? mark.fields : undefined;
    };
  }
}
