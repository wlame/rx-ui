import { describe, expect, it } from 'vitest';
import { findingsAnswer } from '../testing/fakeFindings';
import {
  fileSummaryOf,
  findingsCount,
  isCovered,
  isJoinedScan,
  scanLabel,
  stateLine,
  stillMissing,
} from './findingsSummary';

const COUNTS = {
  'python-traceback': { count: 40, stored: 40 },
  'sql-statement': { count: 2, stored: 2 },
};

describe('fileSummaryOf', () => {
  const DEFAULTS = ['python-traceback', 'java-exception', 'aws-access-key', 'sql-statement'];

  it("counts the default signatures checked and every current entry's findings", () => {
    const all = findingsAnswer({
      state: 'partial',
      checked: ['python-traceback', 'sql-statement', 'email-address'],
      counts: {
        'python-traceback': { count: 40, stored: 40 },
        'sql-statement': { count: 2, stored: 2 },
        'email-address': { count: 3, stored: 3 },
      },
    });

    expect(fileSummaryOf(all, DEFAULTS)).toEqual({ state: 'partial', k: 2, m: 4, n: 45 });
  });

  it('counts no default signature for a file scanned only with opt-in ones', () => {
    const all = findingsAnswer({
      state: 'partial',
      checked: ['email-address'],
      counts: { 'email-address': { count: 3, stored: 3 } },
    });

    expect(fileSummaryOf(all, DEFAULTS)).toEqual({ state: 'partial', k: 0, m: 4, n: 3 });
  });
});

describe('stateLine', () => {
  it('says not scanned when the cache holds nothing current for the file', () => {
    expect(stateLine({ state: 'none', k: 0, m: 4, n: 0 })).toBe('not scanned');
  });

  it('counts every finding of a fully scanned file', () => {
    expect(stateLine({ state: 'full', k: 4, m: 4, n: 42 })).toBe('full · 42 findings');
  });

  it('says one finding, and writes large counts with separators', () => {
    expect(stateLine({ state: 'full', k: 4, m: 4, n: 1 })).toBe('full · 1 finding');
    expect(stateLine({ state: 'full', k: 4, m: 4, n: 48_210 })).toBe(
      `full · ${(48_210).toLocaleString()} findings`,
    );
  });

  it('counts the default signatures checked of a partly scanned file, and its findings', () => {
    expect(stateLine({ state: 'partial', k: 3, m: 58, n: 45 })).toBe(
      'partial · 3 of 58 default signatures · 45 findings',
    );
  });
});

describe('isJoinedScan', () => {
  it('is true for the task of a scan already running or waiting for the file', () => {
    expect(isJoinedScan({ status: 'running', message: 'Joined the signature scan…' })).toBe(true);
    expect(isJoinedScan({ status: 'queued', message: 'Joined the signature scan…' })).toBe(true);
  });

  it('is false for a task the request started', () => {
    expect(
      isJoinedScan({ status: 'queued', message: 'Scanning /logs/app.log for 4 signatures' }),
    ).toBe(false);
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
