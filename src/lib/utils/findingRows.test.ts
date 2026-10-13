import { describe, expect, it } from 'vitest';
import { finding, testCatalogue } from '../testing/fakeFindings';
import type { Finding, FindingsResponse } from '../types';
import {
  choiceAfterEye,
  findingId,
  groupKey,
  groupRows,
  holdsHiddenFindings,
  lineRowAt,
  shownSignatures,
  signatureKey,
  type FindingRow,
  type HeaderRow,
} from './findingRows';

/** The counts of every current signature, as the all-signatures read gives them. */
function countsOf(
  counts: Record<string, [count: number, stored: number]>,
): FindingsResponse['counts'] {
  return Object.fromEntries(
    Object.entries(counts).map(([id, [count, stored]]) => [id, { count, stored }]),
  );
}

/** Every id `counts` names, shown: the group view as it was before anything was hidden. */
function everyIdShown(counts: FindingsResponse['counts']): Set<string> {
  return new Set(Object.keys(counts));
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
      return `group ${row.group} ${row.count}${row.collapsed ? ' +' : ''}${row.hidden ? ' hidden' : ''}`;
    case 'signature':
      return `signature ${row.id} ${row.stored}/${row.count}${row.collapsed ? ' +' : ''}${row.hidden ? ' hidden' : ''}`;
    case 'finding':
      return `finding ${row.finding.signature}:${row.finding.start_line} #${row.index}${row.hidden ? ' hidden' : ''}`;
    case 'placeholder':
      return `placeholder ${row.signature} #${row.index}`;
  }
}

const NONE_COLLAPSED: ReadonlySet<string> = new Set();

/** The rows of `counts` with every id shown and nothing loaded. */
function rowsShowingAll(
  counts: FindingsResponse['counts'],
  collapsed: ReadonlySet<string> = NONE_COLLAPSED,
  pages: ReadonlyMap<string, readonly Finding[]> = new Map(),
): FindingRow[] {
  return groupRows(counts, everyIdShown(counts), pages, collapsed, testCatalogue());
}

describe('groupRows', () => {
  it('lists the groups in catalogue order, each with its signatures and their findings', () => {
    const counts = countsOf({
      'sql-statement': [1, 1],
      'python-traceback': [2, 2],
    });
    const pages = new Map([
      ['python-traceback', [finding('python-traceback', 10), finding('python-traceback', 40)]],
      ['sql-statement', [finding('sql-statement', 7)]],
    ]);

    const rows = rowsShowingAll(counts, NONE_COLLAPSED, pages);

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
    const counts = countsOf({ 'python-traceback': [3, 3], 'java-exception': [4, 4] });
    const collapsed = new Set([signatureKey('python-traceback'), signatureKey('java-exception')]);

    const rows = rowsShowingAll(counts, collapsed);

    expect(rows.map(shortForm)).toEqual([
      'group traceback 7',
      'signature python-traceback 3/3 +',
      'signature java-exception 4/4 +',
    ]);
  });

  it('shows no row under a collapsed group, and its header says it is collapsed', () => {
    const counts = countsOf({ 'python-traceback': [3, 3], 'sql-statement': [1, 1] });
    const collapsed = new Set([groupKey('traceback'), signatureKey('sql-statement')]);

    const rows = rowsShowingAll(counts, collapsed);

    expect(rows.map(shortForm)).toEqual([
      'group traceback 3 +',
      'group sql 1',
      'signature sql-statement 1/1 +',
    ]);
  });

  it('keeps the stored count beside the count of a capped signature', () => {
    const counts = countsOf({ 'aws-access-key': [48_210, 10_000] });
    const collapsed = new Set([signatureKey('aws-access-key')]);

    const [, header] = rowsShowingAll(counts, collapsed);

    expect(header).toEqual({
      kind: 'signature',
      id: 'aws-access-key',
      count: 48_210,
      stored: 10_000,
      collapsed: true,
      eye: 'all',
      hidden: false,
    });
  });

  it('holds a place for each finding of an expanded signature whose page is not loaded', () => {
    const counts = countsOf({ 'python-traceback': [5, 5] });
    const pages = new Map([['python-traceback', sparse('python-traceback', 5, [0, 1])]]);

    const rows = rowsShowingAll(counts, NONE_COLLAPSED, pages);

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
    const counts = countsOf({ 'python-traceback': [5, 5] });

    const rows = rowsShowingAll(counts);

    expect(rows.map(shortForm)).toEqual([
      'group traceback 5',
      'signature python-traceback 5/5',
      'placeholder python-traceback #0',
    ]);
  });

  it('leaves out the signatures without findings and the groups left empty', () => {
    const counts = countsOf({ 'python-traceback': [0, 0], 'sql-statement': [2, 2] });
    const collapsed = new Set([signatureKey('sql-statement')]);

    const rows = rowsShowingAll(counts, collapsed);

    expect(rows.map(shortForm)).toEqual(['group sql 2', 'signature sql-statement 2/2 +']);
  });

  it('puts a signature the catalogue does not name last, under a group with no name', () => {
    const counts = countsOf({ 'team-alert': [1, 1], 'sql-statement': [1, 1] });
    const collapsed = new Set([signatureKey('team-alert'), signatureKey('sql-statement')]);

    const rows = rowsShowingAll(counts, collapsed);

    expect(rows.map(shortForm)).toEqual([
      'group sql 1',
      'signature sql-statement 1/1 +',
      'group  1',
      'signature team-alert 1/1 +',
    ]);
  });

  // A signature may store up to RX_FINDINGS_MAX_PER_SIGNATURE findings,
  // which can be 1,000,000: too many to pass as arguments of one call.
  it('lists the places of an expanded signature that stores a million findings', () => {
    const counts = countsOf({ 'python-traceback': [1_000_000, 1_000_000] });
    const pages = new Map([['python-traceback', sparse('python-traceback', 1_000_000, [0])]]);

    const rows = rowsShowingAll(counts, NONE_COLLAPSED, pages);

    expect(rows).toHaveLength(1_000_002);
    expect(rows[2]).toMatchObject({ kind: 'finding', index: 0 });
    expect(rows.at(-1)).toEqual({
      kind: 'placeholder',
      signature: 'python-traceback',
      index: 999_999,
    });
  });

  it('lists nothing for a file that holds no current signature', () => {
    expect(groupRows({}, new Set(), new Map(), NONE_COLLAPSED, testCatalogue())).toEqual([]);
  });
});

describe('groupRows, with signatures hidden', () => {
  /** python-traceback and the opt-in email-address hold findings; only sql-statement is shown. */
  const COUNTS = countsOf({
    'python-traceback': [2, 2],
    'sql-statement': [1, 1],
    'email-address': [3, 3],
    'phone-number': [0, 0],
  });

  it('lists a hidden signature that holds findings in its place, hidden, with its count', () => {
    const collapsed = new Set(Object.keys(COUNTS).map(signatureKey));

    const rows = groupRows(
      COUNTS,
      new Set(['sql-statement']),
      new Map(),
      collapsed,
      testCatalogue(),
    );

    expect(rows.map(shortForm)).toEqual([
      'group traceback 2 hidden',
      'signature python-traceback 2/2 + hidden',
      'group sql 1',
      'signature sql-statement 1/1 +',
      'group pii 3 hidden',
      'signature email-address 3/3 + hidden',
    ]);
  });

  it('marks the findings of a hidden signature hidden, and lists its places as any other', () => {
    const pages = new Map([['python-traceback', sparse('python-traceback', 2, [0])]]);

    const rows = groupRows(
      countsOf({ 'python-traceback': [2, 2] }),
      new Set(),
      pages,
      NONE_COLLAPSED,
      testCatalogue(),
    );

    expect(rows.map(shortForm)).toEqual([
      'group traceback 2 hidden',
      'signature python-traceback 2/2 hidden',
      'finding python-traceback:100 #0 hidden',
      'placeholder python-traceback #1',
    ]);
  });

  it("gives a group's eye the state of the signatures it lists, whatever its unlisted members", () => {
    // java-exception and the opt-in phone-number hold no finding and are
    // not listed, but they are picked: the eyes of their groups still say
    // that every signature listed under them is hidden.
    const shown = new Set(['java-exception', 'sql-statement', 'phone-number']);
    const collapsed = new Set(Object.keys(COUNTS).map(signatureKey));

    const rows = groupRows(COUNTS, shown, new Map(), collapsed, testCatalogue());

    const eyes = rows.map((row) =>
      row.kind === 'group'
        ? `${row.group} ${row.eye}`
        : `${'id' in row ? row.id : ''} ${'eye' in row ? row.eye : ''}`,
    );
    expect(eyes).toEqual([
      'traceback none',
      'python-traceback none',
      'sql all',
      'sql-statement all',
      'pii none',
      'email-address none',
    ]);
  });

  it('greys a group only when every signature it lists is hidden, and its eye sets those', () => {
    const counts = countsOf({ 'python-traceback': [2, 2], 'java-exception': [1, 1] });
    const collapsed = new Set([signatureKey('python-traceback'), signatureKey('java-exception')]);

    const rows = groupRows(
      counts,
      new Set(['java-exception']),
      new Map(),
      collapsed,
      testCatalogue(),
    );

    expect(rows.map(shortForm)).toEqual([
      'group traceback 3',
      'signature python-traceback 2/2 + hidden',
      'signature java-exception 1/1 +',
    ]);
    expect(rows[0]).toMatchObject({ eye: 'some', ids: ['python-traceback', 'java-exception'] });
  });

  // No choice can pick a signature the catalogue does not name.
  it('gives no eye to a signature the catalogue does not name, and lists it only while it is shown', () => {
    const counts = countsOf({ 'team-alert': [1, 1] });
    const collapsed = new Set([signatureKey('team-alert')]);

    const shownRows = groupRows(
      counts,
      new Set(['team-alert']),
      new Map(),
      collapsed,
      testCatalogue(),
    );
    const hiddenRows = groupRows(counts, new Set(), new Map(), collapsed, testCatalogue());

    expect(shownRows).toEqual([
      { kind: 'group', group: '', count: 1, collapsed: false, eye: null, hidden: false, ids: [] },
      {
        kind: 'signature',
        id: 'team-alert',
        count: 1,
        stored: 1,
        collapsed: true,
        eye: null,
        hidden: false,
      },
    ]);
    expect(hiddenRows).toEqual([]);
  });
});

describe('shownSignatures', () => {
  it('is the picked signatures, and those the summary lists that the catalogue does not name', () => {
    const shown = shownSignatures(
      ['sql-statement'],
      ['sql-statement', 'python-traceback', 'team-alert'],
      testCatalogue(),
    );

    expect([...shown].sort()).toEqual(['sql-statement', 'team-alert']);
  });

  // With nothing picked the summary is the default set's, which the panel does not list.
  it('is empty while nothing is picked', () => {
    expect([...shownSignatures([], ['sql-statement', 'team-alert'], testCatalogue())]).toEqual([]);
  });
});

describe('holdsHiddenFindings', () => {
  it('says whether a signature the choice can pick, and does not, holds findings', () => {
    const counts = countsOf({ 'sql-statement': [1, 1], 'email-address': [0, 0] });

    expect(holdsHiddenFindings(counts, new Set(['sql-statement']), testCatalogue())).toBe(false);
    expect(holdsHiddenFindings(counts, new Set(), testCatalogue())).toBe(true);
    expect(
      holdsHiddenFindings(countsOf({ 'team-alert': [4, 4] }), new Set(), testCatalogue()),
    ).toBe(false);
  });
});

describe('choiceAfterEye', () => {
  const DEFAULT_SET = ['python-traceback', 'java-exception', 'aws-access-key', 'sql-statement'];

  function signatureRow(id: string): HeaderRow {
    return {
      kind: 'signature',
      id,
      count: 1,
      stored: 1,
      collapsed: true,
      eye: 'all',
      hidden: false,
    };
  }

  function groupRow(group: string, ids: string[]): HeaderRow {
    return { kind: 'group', group, count: 1, collapsed: false, eye: 'all', hidden: false, ids };
  }

  it('hides a shown signature and shows a hidden one, as its box in the picker does', () => {
    const hidden = choiceAfterEye(signatureRow('python-traceback'), null, testCatalogue());
    expect(hidden).toEqual(['java-exception', 'aws-access-key', 'sql-statement']);

    const shownAgain = choiceAfterEye(signatureRow('email-address'), hidden, testCatalogue());
    expect(shownAgain).toEqual([
      'java-exception',
      'aws-access-key',
      'sql-statement',
      'email-address',
    ]);
  });

  it('stores an explicit list once the choice leaves the default set, and none once it is whole again', () => {
    const catalogue = testCatalogue();
    const hidden = choiceAfterEye(signatureRow('sql-statement'), null, catalogue);

    expect(hidden).toEqual(DEFAULT_SET.filter((id) => id !== 'sql-statement'));
    expect(choiceAfterEye(signatureRow('sql-statement'), hidden, catalogue)).toBeNull();
  });

  it('sets the signatures a group lists: hides them when all are shown, else shows only them', () => {
    const catalogue = testCatalogue();
    const both = groupRow('traceback', ['python-traceback', 'java-exception']);
    expect(choiceAfterEye(both, null, catalogue)).toEqual(['aws-access-key', 'sql-statement']);
    const partly = ['java-exception', 'aws-access-key', 'sql-statement'];
    expect(choiceAfterEye(both, partly, catalogue)).toBeNull();

    // java-exception is not listed under the group: it stays as it was.
    const listedOnly = groupRow('traceback', ['python-traceback']);
    expect(choiceAfterEye(listedOnly, null, catalogue)).toEqual([
      'java-exception',
      'aws-access-key',
      'sql-statement',
    ]);
    expect(choiceAfterEye(listedOnly, ['aws-access-key', 'sql-statement'], catalogue)).toEqual([
      'python-traceback',
      'aws-access-key',
      'sql-statement',
    ]);
    expect(choiceAfterEye(groupRow('pii', ['email-address']), [], catalogue)).toEqual([
      'email-address',
    ]);
  });
});

describe('lineRowAt', () => {
  it('is the finding at a loaded place and a placeholder elsewhere', () => {
    const list = sparse('sql-statement', 4, [1]);

    expect(lineRowAt(list, 1)).toEqual({
      kind: 'finding',
      finding: list[1],
      index: 1,
      hidden: false,
    });
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
