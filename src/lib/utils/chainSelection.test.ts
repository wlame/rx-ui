import { describe, expect, it } from 'vitest';
import { chainDescription, chainPart, chainTabOf } from '../testing/chainDescription';
import type { ChainTab, OpenFile } from '../types';
import { chainSelEntries, chainSelRanges, keepChainSelection, partOffsets } from './chainSelection';
import { LOCAL_NUMBERING_BASE } from './chainWindow';

/** A chain of three parts: 100 lines, 50 lines, and the active file of 30. */
const description = chainDescription({
  path: '/l/syslog',
  name: 'syslog',
  parts: [
    chainPart('syslog.2.gz', { key: '2', line_count: 100, global_start: 1 }),
    chainPart('syslog.1', { key: '1', line_count: 50, global_start: 101 }),
    chainPart('syslog', { is_active: true, line_count: 30, global_start: 151 }),
  ],
});

const ready: ChainTab = chainTabOf(description);

/** The same chain before it is ready: the tab read `syslog.1`, whose base is `LOCAL_NUMBERING_BASE`. */
const pending: ChainTab = chainTabOf(
  { ...description, state: 'pending' },
  { numbering: 'local', bases: new Map([['syslog.1', LOCAL_NUMBERING_BASE]]) },
);

describe('partOffsets', () => {
  it('places each part of a ready chain at its global start', () => {
    expect(partOffsets(ready)).toEqual(
      new Map([
        ['syslog.2.gz', 0],
        ['syslog.1', 100],
        ['syslog', 150],
      ]),
    );
  });

  it('places the parts of a pending chain from the base it read, by the line counts it knows', () => {
    const base = LOCAL_NUMBERING_BASE;
    expect(partOffsets(pending)).toEqual(
      new Map([
        ['syslog.2.gz', base - 100],
        ['syslog.1', base],
        ['syslog', base + 50],
      ]),
    );
  });

  it('places no part past one whose line count is not known', () => {
    const unknown = chainTabOf(
      {
        ...description,
        state: 'pending',
        parts: [
          chainPart('syslog.2.gz', { line_count: null }),
          chainPart('syslog.1', { line_count: 50 }),
          chainPart('syslog', { is_active: true, line_count: null }),
        ],
      },
      { numbering: 'local', bases: new Map([['syslog.1', LOCAL_NUMBERING_BASE]]) },
    );
    expect([...partOffsets(unknown).keys()]).toEqual(['syslog.1', 'syslog']);
  });
});

describe('chainSelEntries', () => {
  it('names the part of each range of a ready chain, with its own line numbers', () => {
    expect(chainSelEntries([{ start: 120, end: 134 }], ready)).toEqual([
      { start: 20, end: 34, part: 'syslog.1' },
    ]);
  });

  it('splits a range that crosses into the next part', () => {
    expect(chainSelEntries([{ start: 99, end: 152 }], ready)).toEqual([
      { start: 99, end: 100, part: 'syslog.2.gz' },
      { start: 1, end: 50, part: 'syslog.1' },
      { start: 1, end: 2, part: 'syslog' },
    ]);
  });

  it('names the parts of a pending chain from its positions', () => {
    const base = LOCAL_NUMBERING_BASE;
    expect(chainSelEntries([{ start: base + 49, end: base + 51 }], pending)).toEqual([
      { start: 49, end: 50, part: 'syslog.1' },
      { start: 1, end: 1, part: 'syslog' },
    ]);
  });
});

describe('chainSelRanges', () => {
  it("gives the tab's lines of each part's range", () => {
    const entries = [
      { start: 20, end: 34, part: 'syslog.1' },
      { start: 1, end: 2, part: 'syslog' },
    ];
    expect(chainSelRanges(entries, ready)).toEqual([
      { start: 120, end: 134 },
      { start: 151, end: 152 },
    ]);
  });

  it('drops a range of a part the chain does not have, and a range with no part', () => {
    const entries = [
      { start: 1, end: 2, part: 'syslog.9.gz' },
      { start: 1, end: 2, part: null },
      { start: 5, end: 5, part: 'syslog.2.gz' },
    ];
    expect(chainSelRanges(entries, ready)).toEqual([{ start: 5, end: 5 }]);
  });
});

describe('keepChainSelection', () => {
  function tab(chain: ChainTab, selectedLines: OpenFile['selectedLines']): OpenFile {
    return { path: 'chain:/l/syslog', chain, selectedLines } as OpenFile;
  }

  it("moves a pending tab's selection to global lines when the chain becomes ready", () => {
    const base = LOCAL_NUMBERING_BASE;
    const before = tab(pending, [{ start: base + 20, end: base + 34 }]);

    const after = keepChainSelection(before, tab(ready, before.selectedLines));

    expect(after.selectedLines).toEqual([{ start: 120, end: 134 }]);
  });

  it('keeps the selection of a part when a pending tab reads another part from a new base', () => {
    const base = LOCAL_NUMBERING_BASE;
    const before = tab(pending, [{ start: base + 20, end: base + 34 }]);
    const elsewhere = { ...pending, bases: new Map([['syslog', base]]) };

    const after = keepChainSelection(before, tab(elsewhere, before.selectedLines));

    expect(after.selectedLines).toEqual([{ start: base - 30, end: base - 16 }]);
  });

  it("clears the selection when the chain's files changed", () => {
    const before = tab(ready, [{ start: 120, end: 134 }]);
    const rotated = chainTabOf({ ...description, fingerprint: '00000000000000b2' });

    expect(keepChainSelection(before, tab(rotated, before.selectedLines)).selectedLines).toEqual(
      [],
    );
  });

  it('keeps the tab as it is when the numbering did not change', () => {
    const before = tab(ready, [{ start: 120, end: 134 }]);
    const after = tab({ ...ready, anchor: null }, before.selectedLines);
    expect(keepChainSelection(before, after)).toBe(after);
  });

  it('keeps a selection the change itself set', () => {
    const before = tab(pending, [{ start: 1, end: 1 }]);
    const after = tab(ready, [{ start: 7, end: 9 }]);
    expect(keepChainSelection(before, after)).toBe(after);
  });
});
