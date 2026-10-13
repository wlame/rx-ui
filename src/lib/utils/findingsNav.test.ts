import { describe, expect, it } from 'vitest';
import { finding } from '../testing/fakeFindings';
import { groupKey, lineRowAt, signatureKey, type FindingRow } from './findingRows';
import { findingsKeyAction, rowLevel, type FindingsView } from './findingsNav';

/**
 * The group view of the traceback group, open, with python-traceback
 * open (two findings, the second not loaded) and java-exception closed;
 * then the sql group, closed.
 */
const GROUP_ROWS: FindingRow[] = [
  {
    kind: 'group',
    group: 'traceback',
    count: 5,
    collapsed: false,
    eye: 'all',
    hidden: false,
    ids: ['python-traceback', 'java-exception'],
  },
  {
    kind: 'signature',
    id: 'python-traceback',
    count: 2,
    stored: 2,
    collapsed: false,
    eye: 'all',
    hidden: false,
  },
  { kind: 'finding', finding: finding('python-traceback', 10), index: 0, hidden: false },
  { kind: 'placeholder', signature: 'python-traceback', index: 1 },
  {
    kind: 'signature',
    id: 'java-exception',
    count: 3,
    stored: 3,
    collapsed: true,
    eye: 'all',
    hidden: false,
  },
  {
    kind: 'group',
    group: 'sql',
    count: 1,
    collapsed: true,
    eye: 'all',
    hidden: false,
    ids: ['sql-statement'],
  },
];

/**
 * The group view of a hidden signature, open, over its one finding, and
 * of a signature the catalogue does not name, which has no eye.
 */
const HIDDEN_ROWS: FindingRow[] = [
  {
    kind: 'group',
    group: 'pii',
    count: 1,
    collapsed: false,
    eye: 'none',
    hidden: true,
    ids: ['email-address'],
  },
  {
    kind: 'signature',
    id: 'email-address',
    count: 1,
    stored: 1,
    collapsed: false,
    eye: 'none',
    hidden: true,
  },
  { kind: 'finding', finding: finding('email-address', 7), index: 0, hidden: true },
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
];

/** The action of `key` on the row at `current` of `HIDDEN_ROWS`, in the group view. */
function actOnHidden(current: number, key: string) {
  const rows = { count: HIDDEN_ROWS.length, rowAt: (i: number) => HIDDEN_ROWS[i] };
  return findingsKeyAction(rows, current, key, 'group');
}

const LINE_LIST = [
  finding('sql-statement', 1),
  finding('aws-access-key', 4),
  finding('sql-statement', 9),
];

/** The action of `key` on the row at `current`, in the group view or the line view. */
function act(view: FindingsView, current: number | null, key: string) {
  if (view === 'group') {
    return findingsKeyAction(
      { count: GROUP_ROWS.length, rowAt: (i) => GROUP_ROWS[i] },
      current,
      key,
      view,
    );
  }
  const rows = { count: LINE_LIST.length, rowAt: (i: number) => lineRowAt(LINE_LIST, i) };
  return findingsKeyAction(rows, current, key, view);
}

describe('findingsKeyAction, in either view', () => {
  it.each(['line', 'group'] as const)('moves down and up one row in the %s view', (view) => {
    expect(act(view, 1, 'ArrowDown')).toEqual({ type: 'focus', index: 2 });
    expect(act(view, 1, 'ArrowUp')).toEqual({ type: 'focus', index: 0 });
  });

  it.each(['line', 'group'] as const)('stops at either end in the %s view', (view) => {
    expect(act(view, 0, 'ArrowUp')).toEqual({ type: 'none' });
    const last = view === 'line' ? LINE_LIST.length - 1 : GROUP_ROWS.length - 1;
    expect(act(view, last, 'ArrowDown')).toEqual({ type: 'none' });
  });

  it.each(['line', 'group'] as const)(
    'goes to the first or the last row in the %s view',
    (view) => {
      const last = view === 'line' ? LINE_LIST.length - 1 : GROUP_ROWS.length - 1;
      expect(act(view, 1, 'Home')).toEqual({ type: 'focus', index: 0 });
      expect(act(view, 1, 'End')).toEqual({ type: 'focus', index: last });
    },
  );

  it('starts at the first row when no row is current', () => {
    expect(act('line', null, 'ArrowDown')).toEqual({ type: 'focus', index: 0 });
    expect(act('line', null, 'ArrowUp')).toEqual({ type: 'focus', index: 0 });
  });

  it('opens a finding on Enter', () => {
    expect(act('line', 2, 'Enter')).toEqual({ type: 'open', index: 2 });
    expect(act('group', 2, 'Enter')).toEqual({ type: 'open', index: 2 });
  });

  it('does nothing for a list without rows', () => {
    const empty = {
      count: 0,
      rowAt: (): FindingRow => ({ kind: 'placeholder', signature: null, index: 0 }),
    };
    expect(findingsKeyAction(empty, null, 'ArrowDown', 'line')).toEqual({ type: 'none' });
    expect(findingsKeyAction(empty, null, 'End', 'line')).toEqual({ type: 'none' });
  });

  it('leaves a key it does not know alone', () => {
    expect(act('line', 1, 'x')).toEqual({ type: 'none' });
  });
});

describe('findingsKeyAction, in the line view', () => {
  it('leaves ← and → alone', () => {
    expect(act('line', 1, 'ArrowLeft')).toEqual({ type: 'none' });
    expect(act('line', 1, 'ArrowRight')).toEqual({ type: 'none' });
  });

  it('does nothing on Enter over a row whose page has not arrived', () => {
    const rows = { count: 3, rowAt: (i: number) => lineRowAt(undefined, i) };
    expect(findingsKeyAction(rows, 1, 'Enter', 'line')).toEqual({ type: 'none' });
  });

  it('leaves Space alone', () => {
    expect(act('line', 1, ' ')).toEqual({ type: 'none' });
  });
});

describe('findingsKeyAction, in the group view', () => {
  it('collapses an open header on ←', () => {
    expect(act('group', 0, 'ArrowLeft')).toEqual({ type: 'collapse', key: groupKey('traceback') });
    expect(act('group', 1, 'ArrowLeft')).toEqual({
      type: 'collapse',
      key: signatureKey('python-traceback'),
    });
  });

  it('goes from a finding, and from a closed signature, to the header above it on ←', () => {
    expect(act('group', 3, 'ArrowLeft')).toEqual({ type: 'focus', index: 1 });
    expect(act('group', 4, 'ArrowLeft')).toEqual({ type: 'focus', index: 0 });
  });

  it('does nothing on ← over a closed group', () => {
    expect(act('group', 5, 'ArrowLeft')).toEqual({ type: 'none' });
  });

  it('expands a closed header on →, and goes into an open one', () => {
    expect(act('group', 4, 'ArrowRight')).toEqual({
      type: 'expand',
      key: signatureKey('java-exception'),
    });
    expect(act('group', 5, 'ArrowRight')).toEqual({ type: 'expand', key: groupKey('sql') });
    expect(act('group', 0, 'ArrowRight')).toEqual({ type: 'focus', index: 1 });
    expect(act('group', 1, 'ArrowRight')).toEqual({ type: 'focus', index: 2 });
  });

  it('does nothing on → over a finding', () => {
    expect(act('group', 2, 'ArrowRight')).toEqual({ type: 'none' });
  });

  it('opens or closes a header on Enter', () => {
    expect(act('group', 1, 'Enter')).toEqual({
      type: 'collapse',
      key: signatureKey('python-traceback'),
    });
    expect(act('group', 4, 'Enter')).toEqual({
      type: 'expand',
      key: signatureKey('java-exception'),
    });
  });
});

describe('findingsKeyAction, on the eyes of the group view', () => {
  it('hides or shows a group or a signature on Space', () => {
    expect(act('group', 0, ' ')).toEqual({ type: 'toggleShown', index: 0 });
    expect(act('group', 1, ' ')).toEqual({ type: 'toggleShown', index: 1 });
    expect(actOnHidden(1, ' ')).toEqual({ type: 'toggleShown', index: 1 });
  });

  it('leaves Space alone on a finding and on a header without an eye', () => {
    expect(act('group', 2, ' ')).toEqual({ type: 'none' });
    expect(actOnHidden(2, ' ')).toEqual({ type: 'none' });
    expect(actOnHidden(3, ' ')).toEqual({ type: 'none' });
    expect(actOnHidden(4, ' ')).toEqual({ type: 'none' });
  });

  it('opens nothing on Enter over a hidden finding, and still opens and closes its header', () => {
    expect(actOnHidden(2, 'Enter')).toEqual({ type: 'none' });
    expect(actOnHidden(1, 'Enter')).toEqual({
      type: 'collapse',
      key: signatureKey('email-address'),
    });
  });
});

describe('rowLevel', () => {
  it('puts groups first, signatures under them and findings under those', () => {
    expect(GROUP_ROWS.map(rowLevel)).toEqual([1, 2, 3, 3, 2, 1]);
  });
});
