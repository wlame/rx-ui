import { describe, expect, it } from 'vitest';
import { treeEntry } from '../testing/fakeLogDir';
import type { TreeEntry, TreeNode } from '../types';
import { RecentMarks, entryToNode, haveFilesChanged, mergeListing } from './treeListing';

const DIR = '/logs';

/** A file row of `DIR` as a listing gave it. */
function fileRow(name: string, fields: Partial<TreeEntry> = {}): TreeNode {
  return entryToNode(treeEntry(`${DIR}/${name}`, 'file', { size: 10, ...fields }), 1);
}

/** An open folder row of `DIR` holding `children`. */
function openFolderRow(name: string, children: TreeNode[]): TreeNode {
  return { ...entryToNode(treeEntry(`${DIR}/${name}`, 'directory'), 1), expanded: true, children };
}

/** The listing entry of a row, with `fields` changed. */
function listed(row: TreeNode, fields: Partial<TreeEntry> = {}): TreeEntry {
  return treeEntry(row.path, row.type === 'directory' ? 'directory' : 'file', {
    size: row.size,
    ...fields,
  });
}

describe('mergeListing', () => {
  it('gives back the same rows when the listing says nothing new', () => {
    const rows = [fileRow('a.log'), fileRow('b.log', { findings: { state: 'full', count: 2 } })];
    const entries = [listed(rows[0]), listed(rows[1], { findings: { state: 'full', count: 2 } })];

    expect(mergeListing(rows, entries, 1)).toBe(rows);
  });

  it('keeps each row the listing did not change as the same object', () => {
    const rows = [fileRow('a.log'), fileRow('b.log')];

    const merged = mergeListing(rows, [listed(rows[0]), listed(rows[1], { size: 99 })], 1);

    expect(merged).not.toBe(rows);
    expect(merged[0]).toBe(rows[0]);
    expect(merged[1]).toMatchObject({ path: rows[1].path, size: 99 });
  });

  it('adds a new entry as a closed row at the level, and drops a row the listing leaves out', () => {
    const rows = [fileRow('a.log'), fileRow('gone.log')];
    const added = treeEntry(`${DIR}/sub`, 'directory');

    const merged = mergeListing(rows, [listed(rows[0]), added], 1);

    expect(merged.map((row) => row.path)).toEqual([rows[0].path, added.path]);
    expect(merged[1]).toMatchObject({ expanded: false, loading: false, children: [], level: 1 });
  });

  it('keeps an open folder open with its rows, and takes its new fields', () => {
    const inside = [fileRow('sub/x.log')];
    const rows = [openFolderRow('sub', inside)];

    const [merged] = mergeListing(rows, [listed(rows[0], { children_count: 5 })], 1);

    expect(merged).toMatchObject({ expanded: true, children_count: 5 });
    expect(merged.children).toBe(inside);
  });

  it('drops an open folder the listing leaves out, with its rows', () => {
    const rows = [openFolderRow('sub', [fileRow('sub/x.log')]), fileRow('a.log')];

    expect(mergeListing(rows, [listed(rows[1])], 1)).toEqual([rows[1]]);
  });

  it('makes a new row of an entry whose kind changed', () => {
    const rows = [openFolderRow('sub', [fileRow('sub/x.log')])];

    const [merged] = mergeListing(rows, [treeEntry(rows[0].path, 'file')], 1);

    expect(merged).toMatchObject({ type: 'file', expanded: false, children: [] });
  });

  it('keeps the fields a newer mark set, over what the listing says', () => {
    const rows = [fileRow('a.log', { is_indexed: true, findings: { state: 'full', count: 3 } })];
    const stale = listed(rows[0], { is_indexed: false, findings: null, size: 50 });

    const [merged] = mergeListing(rows, [stale], 1, (path) =>
      path === rows[0].path
        ? { is_indexed: true, findings: { state: 'full', count: 3 } }
        : undefined,
    );

    expect(merged).toMatchObject({
      is_indexed: true,
      findings: { state: 'full', count: 3 },
      size: 50,
    });
  });
});

describe('haveFilesChanged', () => {
  const rows = [openFolderRow('sub', []), fileRow('a.log'), fileRow('b.log')];
  const labelled = { ...rows[1], findings: { state: 'full' as const, count: 1 } };

  it.each([
    ['the same rows', false, rows],
    ['a folder row that changed', false, [{ ...rows[0], children_count: 3 }, rows[1], rows[2]]],
    ['a file row that changed', true, [rows[0], { ...rows[1], size: 99 }, rows[2]]],
    ['a findings label alone, which no chain field reads,', false, [rows[0], labelled, rows[2]]],
    ['a file that came', true, [...rows, fileRow('c.log')]],
    ['a file that went', true, [rows[0], rows[1]]],
  ])('says whether %s changes the files: %s', (_name, expected, after) => {
    expect(haveFilesChanged(rows, after)).toBe(expected);
  });
});

describe('RecentMarks', () => {
  const PATH = `${DIR}/a.log`;

  it('keeps a mark made while a listing was on its way for that listing only', () => {
    const marks = new RecentMarks();
    const askedBefore = marks.listingAsked();
    marks.note(PATH, { is_indexed: true });
    const askedAfter = marks.listingAsked();

    expect(marks.newerThan(askedBefore)(PATH)).toEqual({ is_indexed: true });
    expect(marks.newerThan(askedAfter)(PATH)).toBeUndefined();
  });

  it('gathers the fields of every mark of a path', () => {
    const marks = new RecentMarks();
    const asked = marks.listingAsked();
    marks.note(PATH, { is_indexed: true });
    marks.note(PATH, { findings: null });

    expect(marks.newerThan(asked)(PATH)).toEqual({ is_indexed: true, findings: null });
  });

  it('keeps nothing once no listing is on its way, nor a mark made while none was', () => {
    const marks = new RecentMarks();
    marks.note(PATH, { is_indexed: true });
    const asked = marks.listingAsked();

    expect(marks.newerThan(asked - 1)(PATH)).toBeUndefined();
    marks.note(PATH, { is_indexed: false });
    marks.listingEnded();

    expect(marks.newerThan(asked)(PATH)).toBeUndefined();
    expect(marks.size).toBe(0);
  });
});
