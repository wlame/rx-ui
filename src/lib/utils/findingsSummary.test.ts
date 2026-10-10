import { describe, expect, it } from 'vitest';
import { findingsAnswer } from '../testing/fakeFindings';
import { findingsCount, isCovered, scanLabel, stateLine, stillMissing } from './findingsSummary';

const COUNTS = {
  'python-traceback': { count: 40, stored: 40 },
  'sql-statement': { count: 2, stored: 2 },
};

describe('stateLine', () => {
  it('says not scanned when the cache holds nothing current for the file', () => {
    expect(stateLine(findingsAnswer({ state: 'none', missing: ['sql-statement'] }))).toBe(
      'not scanned',
    );
  });

  it('counts the findings of the checked signatures when the file is fully scanned', () => {
    const summary = findingsAnswer({ state: 'full', checked: Object.keys(COUNTS), counts: COUNTS });

    expect(stateLine(summary)).toBe('full · 42 findings');
  });

  it('says one finding, and writes large counts with separators', () => {
    const one = { 'sql-statement': { count: 1, stored: 1 } };
    const many = { 'sql-statement': { count: 48_210, stored: 10_000 } };

    expect(
      stateLine(findingsAnswer({ state: 'full', checked: ['sql-statement'], counts: one })),
    ).toBe('full · 1 finding');
    expect(
      stateLine(findingsAnswer({ state: 'full', checked: ['sql-statement'], counts: many })),
    ).toBe(`full · ${(48_210).toLocaleString()} findings`);
  });

  it('counts the checked signatures of the selection when the file is partly scanned', () => {
    const summary = findingsAnswer({
      state: 'partial',
      checked: ['python-traceback', 'sql-statement', 'aws-access-key'],
      missing: ['java-exception', 'email-address'],
    });

    expect(stateLine(summary)).toBe('partial · 3 of 5 signatures');
  });
});

describe('findingsCount', () => {
  it('adds the counts of every checked signature, past the stored ones too', () => {
    const counts = { ...COUNTS, 'aws-access-key': { count: 12_000, stored: 10_000 } };
    const summary = findingsAnswer({ checked: Object.keys(counts), counts });

    expect(findingsCount(summary)).toBe(12_042);
  });

  it('counts nothing for a signature the answer has no count of', () => {
    expect(findingsCount(findingsAnswer({ checked: ['sql-statement'] }))).toBe(0);
  });
});

describe('scanLabel', () => {
  it('names how many selected signatures are missing, or says the file is up to date', () => {
    expect(scanLabel(3)).toBe('Scan 3 missing');
    expect(scanLabel(1)).toBe('Scan 1 missing');
    expect(scanLabel(0)).toBe('Up to date');
  });
});

describe('isCovered', () => {
  it('is true when a scan result checked every requested signature', () => {
    const result = findingsAnswer({ checked: ['python-traceback', 'sql-statement'] });

    expect(isCovered(['sql-statement'], result)).toBe(true);
  });

  // A scan joined from another request scans what it was started for.
  it('is false when the result of a joined scan left a requested signature out', () => {
    const result = findingsAnswer({ checked: ['python-traceback'] });

    expect(isCovered(['python-traceback', 'email-address'], result)).toBe(false);
  });
});

describe('stillMissing', () => {
  it('keeps the requested signatures the answer still lists as missing', () => {
    const summary = findingsAnswer({ missing: ['email-address', 'phone-number'] });

    expect(stillMissing(['python-traceback', 'email-address'], summary)).toEqual(['email-address']);
  });
});
