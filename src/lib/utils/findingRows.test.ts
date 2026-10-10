import { describe, expect, it } from 'vitest';
import { finding, findingsAnswer, testCatalogue } from '../testing/fakeFindings';
import type { Finding } from '../types';
import {
  findingId,
  groupKey,
  groupRows,
  lineRowAt,
  signatureKey,
  type FindingRow,
} from './findingRows';

/** A summary with findings counts for each signature `counts` names. */
function summaryOf(counts: Record<string, [count: number, stored: number]>) {
  const ids = Object.keys(counts);
  return findingsAnswer({
    state: 'full',
    checked: ids,
    counts: Object.fromEntries(
      ids.map((id) => [id, { count: counts[id][0], stored: counts[id][1] }]),
    ),
  });
}

/** A loaded list of `length` findings of `signature`, with only `loaded` of them in place. */
function sparse(signature: string, length: number, loaded: number[]): Finding[] {
  const list = new Array<Finding>(length);
  for (const index of loaded) list[index] = finding(signature, 100 + index);
  return list;
}

/** A row in a short form, to compare whole lists. */
function shortForm(row: FindingRow): string {
  switch (row.kind) {
    case 'group':
      return `group ${row.group} ${row.count}${row.collapsed ? ' +' : ''}`;
    case 'signature':
      return `signature ${row.id} ${row.stored}/${row.count}${row.collapsed ? ' +' : ''}`;
    case 'finding':
      return `finding ${row.finding.signature}:${row.finding.start_line} #${row.index}`;
    case 'placeholder':
      return `placeholder ${row.signature} #${row.index}`;
  }
}

const NONE_COLLAPSED: ReadonlySet<string> = new Set();

describe('groupRows', () => {
  it('lists the groups in catalogue order, each with its signatures and their findings', () => {
    const summary = summaryOf({
      'sql-statement': [1, 1],
      'python-traceback': [2, 2],
    });
    const pages = new Map([
      ['python-traceback', [finding('python-traceback', 10), finding('python-traceback', 40)]],
      ['sql-statement', [finding('sql-statement', 7)]],
    ]);

    const rows = groupRows(summary, pages, NONE_COLLAPSED, testCatalogue());

    expect(rows.map(shortForm)).toEqual([
      'group traceback 2',
      'signature python-traceback 2/2',
      'finding python-traceback:10 #0',
      'finding python-traceback:40 #1',
      'group sql 1',
      'signature sql-statement 1/1',
      'finding sql-statement:7 #0',
    ]);
  });

  it('adds the counts of the signatures of a group in its header', () => {
    const summary = summaryOf({ 'python-traceback': [3, 3], 'java-exception': [4, 4] });
    const collapsed = new Set([signatureKey('python-traceback'), signatureKey('java-exception')]);

    const rows = groupRows(summary, new Map(), collapsed, testCatalogue());

    expect(rows.map(shortForm)).toEqual([
      'group traceback 7',
      'signature python-traceback 3/3 +',
      'signature java-exception 4/4 +',
    ]);
  });

  it('shows no row under a collapsed group, and its header says it is collapsed', () => {
    const summary = summaryOf({ 'python-traceback': [3, 3], 'sql-statement': [1, 1] });
    const collapsed = new Set([groupKey('traceback'), signatureKey('sql-statement')]);

    const rows = groupRows(summary, new Map(), collapsed, testCatalogue());

    expect(rows.map(shortForm)).toEqual([
      'group traceback 3 +',
      'group sql 1',
      'signature sql-statement 1/1 +',
    ]);
  });

  it('keeps the stored count beside the count of a capped signature', () => {
    const summary = summaryOf({ 'aws-access-key': [48_210, 10_000] });
    const collapsed = new Set([signatureKey('aws-access-key')]);

    const [, header] = groupRows(summary, new Map(), collapsed, testCatalogue());

    expect(header).toEqual({
      kind: 'signature',
      id: 'aws-access-key',
      count: 48_210,
      stored: 10_000,
      collapsed: true,
    });
  });

  it('holds a place for each finding of an expanded signature whose page is not loaded', () => {
    const summary = summaryOf({ 'python-traceback': [5, 5] });
    const pages = new Map([['python-traceback', sparse('python-traceback', 5, [0, 1])]]);

    const rows = groupRows(summary, pages, NONE_COLLAPSED, testCatalogue());

    expect(rows.map(shortForm)).toEqual([
      'group traceback 5',
      'signature python-traceback 5/5',
      'finding python-traceback:100 #0',
      'finding python-traceback:101 #1',
      'placeholder python-traceback #2',
      'placeholder python-traceback #3',
      'placeholder python-traceback #4',
    ]);
  });

  // The length of a filtered list is known only once its first page arrives.
  it('holds one place for an expanded signature none of whose pages arrived', () => {
    const summary = summaryOf({ 'python-traceback': [5, 5] });

    const rows = groupRows(summary, new Map(), NONE_COLLAPSED, testCatalogue());

    expect(rows.map(shortForm)).toEqual([
      'group traceback 5',
      'signature python-traceback 5/5',
      'placeholder python-traceback #0',
    ]);
  });

  it('leaves out the signatures without findings and the groups left empty', () => {
    const summary = summaryOf({ 'python-traceback': [0, 0], 'sql-statement': [2, 2] });
    const collapsed = new Set([signatureKey('sql-statement')]);

    const rows = groupRows(summary, new Map(), collapsed, testCatalogue());

    expect(rows.map(shortForm)).toEqual(['group sql 2', 'signature sql-statement 2/2 +']);
  });

  it('puts a signature the catalogue does not name last, under a group with no name', () => {
    const summary = summaryOf({ 'team-alert': [1, 1], 'sql-statement': [1, 1] });
    const collapsed = new Set([signatureKey('team-alert'), signatureKey('sql-statement')]);

    const rows = groupRows(summary, new Map(), collapsed, testCatalogue());

    expect(rows.map(shortForm)).toEqual([
      'group sql 1',
      'signature sql-statement 1/1 +',
      'group  1',
      'signature team-alert 1/1 +',
    ]);
  });

  it('lists nothing for a summary that checked nothing', () => {
    expect(groupRows(findingsAnswer(), new Map(), NONE_COLLAPSED, testCatalogue())).toEqual([]);
  });
});

describe('lineRowAt', () => {
  it('is the finding at a loaded place and a placeholder elsewhere', () => {
    const list = sparse('sql-statement', 4, [1]);

    expect(lineRowAt(list, 1)).toEqual({ kind: 'finding', finding: list[1], index: 1 });
    expect(lineRowAt(list, 2)).toEqual({ kind: 'placeholder', signature: null, index: 2 });
    expect(lineRowAt(undefined, 0)).toEqual({ kind: 'placeholder', signature: null, index: 0 });
  });
});

describe('findingId', () => {
  it('names a finding by its signature and where it starts', () => {
    expect(findingId(finding('sql-statement', 7))).toBe('sql-statement:700');
  });

  it('tells apart two findings of one line by their signatures', () => {
    expect(findingId(finding('sql-statement', 7))).not.toBe(
      findingId(finding('aws-access-key', 7)),
    );
  });
});
