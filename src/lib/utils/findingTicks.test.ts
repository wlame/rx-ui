import { describe, expect, it } from 'vitest';
import { TEST_GROUPS, TEST_SIGNATURES } from '../testing/fakeFindings';
import type { FindingsTicks } from '../types';
import { columnSpanMs, tickMarks, type TickLook } from './findingTicks';
import { groupStyle } from './groupStyle';
import { fractionOf } from './timeline';

/** 2026-10-10 12:00:00 UTC. */
const NOON = Date.UTC(2026, 9, 10, 12, 0, 0);
/** A file of 1,000,000 ms: on 1,000 columns each column is one second. */
const AXIS = { startMs: NOON, endMs: NOON + 999_999 };

/** The time as the timeline of a file that writes `HH:MM:SS` prints it, in UTC. */
const LOOK: TickLook = {
  catalogue: TEST_SIGNATURES,
  groups: TEST_GROUPS,
  timeLabel: (ms) => new Date(ms).toISOString().slice(11, 19),
};

function ticksOf(
  columns: Record<number, Record<string, [count: number, firstLine: number]>>,
  width = 1000,
): NonNullable<FindingsTicks> {
  return {
    start_ms: AXIS.startMs,
    end_ms: AXIS.endMs,
    width,
    columns: Object.entries(columns).map(([column, signatures]) => ({
      column: Number(column),
      signatures: Object.fromEntries(
        Object.entries(signatures).map(([id, [count, first]]) => [
          id,
          { count, first_line: first },
        ]),
      ),
    })),
  };
}

describe('columnSpanMs', () => {
  it('gives the first and the last instant a column holds, as rx-go places a time', () => {
    const ticks = ticksOf({}, 1000);
    expect(columnSpanMs(ticks, 0)).toEqual({ firstMs: NOON, lastMs: NOON + 999 });
    expect(columnSpanMs(ticks, 999)).toEqual({ firstMs: NOON + 999_000, lastMs: NOON + 999_999 });
  });

  it('holds every instant floor((t - start) * width / (end - start + 1)) puts in it', () => {
    const ticks = { start_ms: 0, end_ms: 99, width: 7, columns: [] };
    for (let column = 0; column < 7; column++) {
      const { firstMs, lastMs } = columnSpanMs(ticks, column);
      const placed = (t: number) => Math.floor((t * 7) / 100);
      expect(placed(firstMs)).toBe(column);
      expect(placed(lastMs)).toBe(column);
      if (firstMs > 0) expect(placed(firstMs - 1)).toBe(column - 1);
      if (lastMs < 99) expect(placed(lastMs + 1)).toBe(column + 1);
    }
  });
});

describe('tickMarks', () => {
  it("draws one tick per group per column, in the group's colour", () => {
    const ticks = ticksOf({ 1: { 'python-traceback': [2, 140], 'sql-statement': [1, 120] } });

    const marks = tickMarks(ticks, AXIS, LOOK);

    expect(marks.map((m) => [m.column, m.group, m.className])).toEqual([
      [1, 'traceback', groupStyle('traceback', TEST_GROUPS).className],
      [1, 'sql', groupStyle('sql', TEST_GROUPS).className],
    ]);
  });

  it('draws one tick for two signatures of one group in a column', () => {
    const ticks = ticksOf({ 5: { 'python-traceback': [1, 9], 'java-exception': [3, 7] } });
    expect(tickMarks(ticks, AXIS, LOOK)).toHaveLength(1);
  });

  it('gives each group of the answer its lane, in catalogue order, the same in every column', () => {
    const ticks = ticksOf({
      1: { 'sql-statement': [1, 5] },
      2: { 'aws-access-key': [1, 9], 'sql-statement': [1, 8] },
    });

    const marks = tickMarks(ticks, AXIS, LOOK);

    expect(marks.map((m) => [m.column, m.group, m.lane, m.lanes])).toEqual([
      [1, 'sql', 1, 2],
      [2, 'secret', 0, 2],
      [2, 'sql', 1, 2],
    ]);
  });

  it("says the column's findings, their time and each signature's count on hover", () => {
    const ticks = ticksOf({ 1: { 'sql-statement': [1, 120], 'python-traceback': [2, 140] } });

    const titles = tickMarks(ticks, AXIS, LOOK).map((m) => m.title);

    expect(titles).toEqual([
      '3 findings at 12:00:01: python-traceback ×2, sql-statement ×1',
      '3 findings at 12:00:01: python-traceback ×2, sql-statement ×1',
    ]);
  });

  it('names the first and the last time a column covers when the timeline prints them apart', () => {
    const ticks = ticksOf({ 0: { 'sql-statement': [1, 3] } }, 10);
    expect(tickMarks(ticks, AXIS, LOOK)[0].title).toBe(
      '1 finding between 12:00:00 and 12:01:39: sql-statement ×1',
    );
  });

  it("opens the column's first finding: the smallest first line of its signatures", () => {
    const ticks = ticksOf({ 1: { 'python-traceback': [2, 140], 'sql-statement': [1, 120] } });
    expect(tickMarks(ticks, AXIS, LOOK).map((m) => m.firstLine)).toEqual([120, 120]);
  });

  it("sits where the axis places the findings' times", () => {
    const time = NOON + 437_250;
    const column = Math.floor(((time - NOON) * 1000) / 1_000_000);
    const ticks = ticksOf({ [column]: { 'sql-statement': [1, 9] } });

    const [mark] = tickMarks(ticks, AXIS, LOOK);

    expect(Math.abs(mark.fraction - fractionOf(time, AXIS))).toBeLessThanOrEqual(1 / 1000);
  });

  it('draws nothing without ticks or without a time range', () => {
    expect(tickMarks(null, AXIS, LOOK)).toEqual([]);
    const timeless = { start_ms: null, end_ms: null, width: 1000, columns: [] };
    expect(tickMarks(timeless, AXIS, LOOK)).toEqual([]);
  });

  it('puts a signature the catalogue does not name in a lane of its own, last', () => {
    const ticks = ticksOf({ 3: { 'custom-check': [1, 4], 'sql-statement': [1, 2] } });

    const marks = tickMarks(ticks, AXIS, LOOK);

    expect(marks.map((m) => [m.group, m.lane])).toEqual([
      ['sql', 0],
      ['', 1],
    ]);
  });
});
