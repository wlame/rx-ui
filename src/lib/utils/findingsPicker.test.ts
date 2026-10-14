import { describe, expect, it } from 'vitest';
import { TEST_DEFAULT_IDS, testCatalogue } from '../testing/fakeFindings';
import {
  PICKER_PRESETS,
  hidesSignature,
  activeIds,
  filterSignatures,
  groupCheckState,
  pickedIds,
  pickerChoice,
  pickerGroups,
  pickerSummary,
  scanSelection,
  selectionOf,
  toggleGroup,
  toggleSignature,
} from './findingsPicker';

const CATALOGUE = testCatalogue();
const EVERY_ACTIVE = [
  'python-traceback',
  'java-exception',
  'aws-access-key',
  'sql-statement',
  'email-address',
  'phone-number',
];

describe('activeIds', () => {
  it('lists every signature no user file disabled, opt-in ones included, in catalogue order', () => {
    expect(activeIds(CATALOGUE)).toEqual(EVERY_ACTIVE);
  });
});

describe('pickedIds', () => {
  it('reads no choice as the default set', () => {
    expect(pickedIds(null, CATALOGUE)).toEqual(TEST_DEFAULT_IDS);
  });

  // A signature file removed or a built-in disabled since the choice was
  // made: the backend refuses a selection that names it.
  it('drops ids the catalogue lacks or disabled, and keeps catalogue order', () => {
    const stored = ['email-address', 'gone-signature', 'legacy-trace', 'python-traceback'];

    expect(pickedIds(stored, CATALOGUE)).toEqual(['python-traceback', 'email-address']);
  });

  it('keeps an id named twice once', () => {
    expect(pickedIds(['sql-statement', 'sql-statement'], CATALOGUE)).toEqual(['sql-statement']);
  });
});

describe('pickerChoice', () => {
  it('stores the default set as no choice, so it follows the catalogue', () => {
    expect(pickerChoice([...TEST_DEFAULT_IDS].reverse(), CATALOGUE)).toBeNull();
  });

  it('stores any other choice as its ids in catalogue order', () => {
    expect(pickerChoice(['email-address', 'sql-statement'], CATALOGUE)).toEqual([
      'sql-statement',
      'email-address',
    ]);
    expect(pickerChoice([], CATALOGUE)).toEqual([]);
  });
});

// A scan names the default set by name, so the backend resolves it and
// its command reads `--signatures=default` rather than every id.
describe('scanSelection', () => {
  it('names the default set when the ids are exactly it, in any order', () => {
    expect(scanSelection(TEST_DEFAULT_IDS, testCatalogue())).toEqual(['default']);
    expect(scanSelection([...TEST_DEFAULT_IDS].reverse(), testCatalogue())).toEqual(['default']);
  });

  it('keeps other ids as they are', () => {
    expect(scanSelection(['sql-statement'], testCatalogue())).toEqual(['sql-statement']);
    const withOptIn = [...TEST_DEFAULT_IDS, 'email-address'];
    expect(scanSelection(withOptIn, testCatalogue())).toEqual(withOptIn);
    expect(scanSelection(['default'], testCatalogue())).toEqual(['default']);
  });

  it('keeps the ids while the catalogue is not loaded', () => {
    const empty = { ...testCatalogue(), list: [] };
    expect(scanSelection([], empty)).toEqual([]);
  });
});

describe('selectionOf', () => {
  it('sends no selection for the default set, all for every signature, else the ids', () => {
    expect(selectionOf(null, CATALOGUE)).toEqual([]);
    expect(selectionOf(EVERY_ACTIVE, CATALOGUE)).toEqual(['all']);
    expect(selectionOf(['sql-statement'], CATALOGUE)).toEqual(['sql-statement']);
  });

  // An empty selection is the default set to the backend.
  it('is null when nothing is picked', () => {
    expect(selectionOf([], CATALOGUE)).toBeNull();
    expect(selectionOf(['gone-signature'], CATALOGUE)).toBeNull();
  });
});

describe('hidesSignature', () => {
  it('hides an active signature the choice does not pick, and nothing else', () => {
    const catalogue = testCatalogue();

    expect(hidesSignature(null, 'email-address', catalogue)).toBe(true);
    expect(hidesSignature(null, 'sql-statement', catalogue)).toBe(false);
    expect(hidesSignature([], 'sql-statement', catalogue)).toBe(true);
    expect(hidesSignature(null, 'legacy-trace', catalogue)).toBe(false);
    expect(hidesSignature(null, 'team-alert', catalogue)).toBe(false);
  });
});

describe('groupCheckState', () => {
  const TRACEBACK = ['python-traceback', 'java-exception'];

  it('is all, some or none of the ids of a group', () => {
    expect(groupCheckState(TRACEBACK, new Set(TRACEBACK))).toBe('all');
    expect(groupCheckState(TRACEBACK, new Set(['java-exception', 'sql-statement']))).toBe('some');
    expect(groupCheckState(TRACEBACK, new Set(['sql-statement']))).toBe('none');
  });

  it('is none for a group that shows no signature', () => {
    expect(groupCheckState([], new Set(TRACEBACK))).toBe('none');
  });
});

describe('toggleGroup', () => {
  const TRACEBACK = ['python-traceback', 'java-exception'];

  it('picks every id of a group that is partly or not picked', () => {
    expect(toggleGroup(TRACEBACK, ['java-exception', 'sql-statement']).sort()).toEqual(
      ['java-exception', 'python-traceback', 'sql-statement'].sort(),
    );
    expect(toggleGroup(TRACEBACK, []).sort()).toEqual([...TRACEBACK].sort());
  });

  it('drops every id of a group that is wholly picked', () => {
    expect(toggleGroup(TRACEBACK, [...TRACEBACK, 'sql-statement'])).toEqual(['sql-statement']);
  });
});

describe('toggleSignature', () => {
  it('adds an id that is not picked and drops one that is', () => {
    expect(toggleSignature('sql-statement', ['python-traceback'])).toEqual([
      'python-traceback',
      'sql-statement',
    ]);
    expect(toggleSignature('python-traceback', ['python-traceback'])).toEqual([]);
  });
});

describe('PICKER_PRESETS', () => {
  it('are Default, All and None, which pick the default set, every signature and none', () => {
    expect(PICKER_PRESETS.map((preset) => preset.label)).toEqual(['Default', 'All', 'None']);
    expect(PICKER_PRESETS.map((preset) => preset.choose(CATALOGUE))).toEqual([
      null,
      EVERY_ACTIVE,
      [],
    ]);
  });
});

describe('pickerSummary', () => {
  it('names the preset a choice equals, with its count, or counts the signatures', () => {
    expect(pickerSummary(null, CATALOGUE)).toBe('Default (4)');
    expect(pickerSummary(EVERY_ACTIVE, CATALOGUE)).toBe('All (6)');
    expect(pickerSummary([], CATALOGUE)).toBe('None');
    expect(pickerSummary(['sql-statement'], CATALOGUE)).toBe('1 signature');
    expect(pickerSummary(['sql-statement', 'email-address'], CATALOGUE)).toBe('2 signatures');
  });
});

describe('filterSignatures', () => {
  it('keeps the signatures whose id, name, group or a tag holds the text, without case', () => {
    const list = activeIdsOf(filterSignatures(CATALOGUE.list, 'TRACE'));
    expect(list).toEqual(['python-traceback', 'java-exception', 'legacy-trace']);
    expect(activeIdsOf(filterSignatures(CATALOGUE.list, 'pii'))).toEqual([
      'email-address',
      'phone-number',
    ]);
    expect(activeIdsOf(filterSignatures(CATALOGUE.list, 'AWS access'))).toEqual(['aws-access-key']);
  });

  it('keeps every signature for an empty or blank text', () => {
    expect(filterSignatures(CATALOGUE.list, '  ')).toHaveLength(CATALOGUE.list.length);
  });
});

describe('pickerGroups', () => {
  it('lists the active signatures group by group in group order, and no empty group', () => {
    const groups = pickerGroups(filterSignatures(CATALOGUE.list, 'e'), CATALOGUE.groups);

    expect(groups.map((g) => [g.name, g.signatures.map((s) => s.id)])).toEqual([
      ['traceback', ['python-traceback', 'java-exception']],
      ['secret', ['aws-access-key']],
      ['sql', ['sql-statement']],
      ['pii', ['email-address', 'phone-number']],
    ]);
  });

  it('leaves out a disabled built-in', () => {
    const groups = pickerGroups(CATALOGUE.list, CATALOGUE.groups);

    expect(groups.flatMap((g) => g.signatures.map((s) => s.id))).not.toContain('legacy-trace');
  });
});

function activeIdsOf(list: readonly { id: string }[]): string[] {
  return list.map((signature) => signature.id);
}
