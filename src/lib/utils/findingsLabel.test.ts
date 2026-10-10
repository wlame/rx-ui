import { describe, expect, it } from 'vitest';
import { findingsLabelOf, findingsLabelTitle } from './findingsLabel';

describe('findingsLabelTitle', () => {
  it('says a full file was scanned with all M default signatures', () => {
    expect(findingsLabelTitle({ state: 'full', count: 42 }, null, 58)).toBe(
      'Scanned with all 58 default signatures: 42 findings.',
    );
  });

  // K comes from the summary the session holds, while it says what the label says.
  it('says K of M when the summary for the file says the same state and count', () => {
    const file = { state: 'partial', k: 3, m: 58, n: 45 } as const;

    expect(findingsLabelTitle({ state: 'partial', count: 45 }, file, 58)).toBe(
      'Scanned with 3 of 58 default signatures: 45 findings. Open Findings to scan the rest.',
    );
  });

  it.each([
    ['no summary', null],
    ['a summary of another count', { state: 'partial', k: 3, m: 58, n: 44 } as const],
    ['a summary of another state', { state: 'full', k: 58, m: 58, n: 45 } as const],
  ])('says "some of the M" with %s, as after a reload of the tree', (_name, file) => {
    expect(findingsLabelTitle({ state: 'partial', count: 45 }, file, 58)).toBe(
      'Scanned with some of the 58 default signatures: 45 findings. Open Findings to scan the rest.',
    );
  });

  it('says a file scanned only with opt-in signatures was scanned with those', () => {
    const file = { state: 'partial', k: 0, m: 58, n: 1 } as const;

    expect(findingsLabelTitle({ state: 'partial', count: 1 }, file, 58)).toBe(
      'Scanned with opt-in signatures only: 1 finding. Open Findings to scan the defaults.',
    );
  });

  it('leaves M out before the catalogue is loaded', () => {
    expect(findingsLabelTitle({ state: 'full', count: 1_234 }, null, 0)).toBe(
      'Scanned with all default signatures: 1,234 findings.',
    );
    expect(findingsLabelTitle({ state: 'partial', count: 0 }, null, 0)).toBe(
      'Scanned with some of the default signatures: 0 findings. Open Findings to scan the rest.',
    );
  });
});

describe('findingsLabelOf', () => {
  const partial = { state: 'partial', k: 1, m: 4, n: 7 } as const;

  it("takes the tree's label when the tree lists the file", () => {
    expect(findingsLabelOf({ state: 'full', count: 3 }, partial)).toEqual({
      state: 'full',
      count: 3,
    });
    expect(findingsLabelOf(null, partial)).toBeNull();
  });

  // A file opened from a link, in a folder the tree has not listed.
  it('takes the summary the session read when the tree does not list the file', () => {
    expect(findingsLabelOf(undefined, partial)).toEqual({ state: 'partial', count: 7 });
    expect(findingsLabelOf(undefined, { state: 'none', k: 0, m: 4, n: 0 })).toBeNull();
    expect(findingsLabelOf(undefined, null)).toBeNull();
  });
});
