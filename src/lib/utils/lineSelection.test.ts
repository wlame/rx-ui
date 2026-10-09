import { describe, expect, it } from 'vitest';
import {
  MAX_SEL_RANGES,
  addRange,
  clampSelection,
  extendLast,
  fromMonacoSelections,
  normalize,
  parseSel,
  removeLine,
  selectionLineCount,
  serializeSel,
  splitAtParts,
  type LineRange,
  type MonacoSelectionLike,
  type SelEntry,
} from './lineSelection';

/** `A-B` or `N` as a range, for short test tables. */
function r(text: string): LineRange {
  const [start, end = start] = text.split('-').map(Number);
  return { start, end };
}

function ranges(...texts: string[]): LineRange[] {
  return texts.map(r);
}

function fileEntries(...texts: string[]): SelEntry[] {
  return texts.map((text) => ({ ...r(text), part: null }));
}

function selection(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
): MonacoSelectionLike {
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

describe('normalize', () => {
  it('merges overlapping and touching ranges and sorts them', () => {
    expect(normalize(ranges('5-7', '1-2', '3-4'))).toEqual(ranges('1-7'));
  });

  it('keeps ranges with a line between them apart', () => {
    expect(normalize(ranges('1-2', '4-5'))).toEqual(ranges('1-2', '4-5'));
  });

  it('merges a range inside another into it', () => {
    expect(normalize(ranges('10-20', '12-13', '20-25'))).toEqual(ranges('10-25'));
  });

  it('gives nothing for nothing', () => {
    expect(normalize([])).toEqual([]);
  });
});

describe('addRange, removeLine and extendLast on three ranges', () => {
  const three = ranges('10-12', '20-25', '40-41');

  it('adds a range apart from the others', () => {
    expect(addRange(three, r('30-31'))).toEqual(ranges('10-12', '20-25', '30-31', '40-41'));
  });

  it('adds a range that bridges two ranges into one', () => {
    expect(addRange(three, r('13-19'))).toEqual(ranges('10-25', '40-41'));
  });

  it('removes a line from the middle of a range, splitting it', () => {
    expect(removeLine(three, 22)).toEqual(ranges('10-12', '20-21', '23-25', '40-41'));
  });

  it('removes a range of one line whole, and an end line from a range', () => {
    expect(removeLine(removeLine(three, 40), 41)).toEqual(ranges('10-12', '20-25'));
    expect(removeLine(three, 10)).toEqual(ranges('11-12', '20-25', '40-41'));
  });

  it('leaves the selection alone for a line it does not hold', () => {
    expect(removeLine(three, 30)).toEqual(three);
  });

  it('extends the last range from its first line to a later line', () => {
    expect(extendLast(three, 50)).toEqual(ranges('10-12', '20-25', '40-50'));
  });

  it('extends the last range from its first line back to an earlier line, merging', () => {
    expect(extendLast(three, 22)).toEqual(ranges('10-12', '20-40'));
  });

  it('shortens the last range to a line inside it', () => {
    expect(extendLast(ranges('10-12', '40-49'), 44)).toEqual(ranges('10-12', '40-44'));
  });

  it('selects the line itself when nothing is selected', () => {
    expect(extendLast([], 7)).toEqual(ranges('7'));
  });
});

describe('fromMonacoSelections', () => {
  it('selects the whole line of a selection inside one line', () => {
    expect(fromMonacoSelections([selection(10, 3, 10, 9)], 1)).toEqual(ranges('10'));
  });

  it('leaves out the line a selection ends on at column 1', () => {
    expect(fromMonacoSelections([selection(10, 3, 12, 1)], 1)).toEqual(ranges('10-11'));
  });

  it('gives nothing for an empty selection, a cursor', () => {
    expect(fromMonacoSelections([selection(10, 3, 10, 3)], 1)).toEqual([]);
  });

  it("maps Monaco's line 1 to the window's first file line", () => {
    expect(fromMonacoSelections([selection(1, 1, 3, 4)], 5_001)).toEqual(ranges('5001-5003'));
  });

  it('merges the lines of several selections', () => {
    const selections = [selection(1, 2, 1, 4), selection(2, 1, 4, 1), selection(8, 1, 8, 2)];
    expect(fromMonacoSelections(selections, 100)).toEqual(ranges('100-102', '107'));
  });

  it('reads a selection made upwards like one made downwards', () => {
    expect(fromMonacoSelections([selection(12, 1, 10, 3)], 1)).toEqual(ranges('10-11'));
  });
});

describe('parseSel and serializeSel', () => {
  it('reads and writes a list of lines and ranges unchanged', () => {
    const entries = parseSel('120-134,200,305-310');
    expect(entries).toEqual(fileEntries('120-134', '200', '305-310'));
    expect(serializeSel(entries)).toBe('120-134,200,305-310');
  });

  it('drops a part that is no line or range of whole numbers 1 <= A <= B', () => {
    expect(parseSel('a-3,5-2,0,7')).toEqual(fileEntries('7'));
    expect(serializeSel(parseSel('a-3,5-2,0,7'))).toBe('7');
  });

  it.each([
    '',
    '-',
    '1-',
    '-5',
    ' 3',
    '3 ',
    '1.5',
    '+3',
    '0-4',
    '3-x',
    '1-2-3',
    '9007199254740993',
  ])('drops %j', (value) => {
    expect(parseSel(value)).toEqual([]);
  });

  it(`keeps the first ${MAX_SEL_RANGES} of 150 ranges`, () => {
    const value = Array.from({ length: 150 }, (_, i) => String(i * 10 + 1)).join(',');
    const entries = parseSel(value);
    expect(entries).toHaveLength(MAX_SEL_RANGES);
    expect(entries.at(-1)).toEqual({ start: 991, end: 991, part: null });
  });

  it('counts only valid parts toward the cap', () => {
    const value = ['x', ...Array.from({ length: 100 }, (_, i) => String(i * 10 + 1))].join(',');
    expect(parseSel(value)).toHaveLength(100);
  });

  it('reads no selection from a missing key and writes none for an empty one', () => {
    expect(parseSel(null)).toEqual([]);
    expect(serializeSel([])).toBeNull();
  });

  it("reads a chain part's name before the range", () => {
    expect(parseSel('syslog.3.gz:120-134')).toEqual([
      { start: 120, end: 134, part: 'syslog.3.gz' },
    ]);
  });

  it('reads a name up to the last colon', () => {
    expect(parseSel('app:2026-10-01.log:7')).toEqual([
      { start: 7, end: 7, part: 'app:2026-10-01.log' },
    ]);
    expect(serializeSel([{ start: 7, end: 7, part: 'app:2026-10-01.log' }])).toBe(
      'app:2026-10-01.log:7',
    );
  });

  it('drops a part with an empty name or a name that is no bare file name', () => {
    expect(parseSel(':5,../x:5,a/b:5,.:5,..:5')).toEqual([]);
  });

  it('writes the part before each range of a chain', () => {
    const entries: SelEntry[] = [
      { start: 120, end: 134, part: 'syslog.3.gz' },
      { start: 1, end: 2, part: 'syslog.2.gz' },
    ];
    expect(serializeSel(entries)).toBe('syslog.3.gz:120-134,syslog.2.gz:1-2');
    expect(parseSel(serializeSel(entries))).toEqual(entries);
  });
});

describe('splitAtParts', () => {
  const parts = [
    { name: 'syslog.2.gz', lines: 100 },
    { name: 'syslog.1', lines: 50 },
    { name: 'syslog', lines: Number.POSITIVE_INFINITY },
  ];

  it('leaves a range inside its part alone', () => {
    const entries: SelEntry[] = [{ start: 10, end: 20, part: 'syslog.2.gz' }];
    expect(splitAtParts(entries, parts)).toEqual(entries);
  });

  it('splits a range that crosses into the next part, and the part after', () => {
    expect(splitAtParts([{ start: 90, end: 170, part: 'syslog.2.gz' }], parts)).toEqual([
      { start: 90, end: 100, part: 'syslog.2.gz' },
      { start: 1, end: 50, part: 'syslog.1' },
      { start: 1, end: 20, part: 'syslog' },
    ]);
  });

  it('drops what runs past the last part when its line count is known', () => {
    const counted = [parts[0], { name: 'syslog.1', lines: 50 }];
    expect(splitAtParts([{ start: 40, end: 400, part: 'syslog.1' }], counted)).toEqual([
      { start: 40, end: 50, part: 'syslog.1' },
    ]);
  });

  it('moves a range that starts past its part into the parts after it', () => {
    expect(splitAtParts([{ start: 120, end: 130, part: 'syslog.2.gz' }], parts)).toEqual([
      { start: 20, end: 30, part: 'syslog.1' },
    ]);
  });

  it('keeps a file range and a range of an unknown part as they are', () => {
    const entries: SelEntry[] = [
      { start: 1, end: 900, part: null },
      { start: 1, end: 900, part: 'other.log' },
    ];
    expect(splitAtParts(entries, parts)).toEqual(entries);
  });
});

describe('clampSelection', () => {
  it('cuts a range at the last line and drops a range past it', () => {
    expect(clampSelection(ranges('5-9', '90-120', '130-140'), 100)).toEqual(
      ranges('5-9', '90-100'),
    );
  });

  it('gives the same array when nothing is past the last line', () => {
    const held = ranges('5-9');
    expect(clampSelection(held, 9)).toBe(held);
  });
});

describe('selectionLineCount', () => {
  it('counts the lines of every range', () => {
    expect(selectionLineCount(ranges('120-134', '200', '305-310'))).toBe(22);
  });
});
