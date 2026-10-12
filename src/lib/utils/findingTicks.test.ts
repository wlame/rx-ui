import { describe, expect, it } from 'vitest';
import { TEST_GROUPS, TEST_SIGNATURES } from '../testing/fakeFindings';
import type { FindingsTicks } from '../types';
import { MIN_TICK_PX, columnSpanMs, tickBox, tickMarks, type TickLook } from './findingTicks';
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

  it("says its group's findings in the column, their time and each signature's count on hover", () => {
    const ticks = ticksOf({
      1: { 'sql-statement': [1, 120], 'python-traceback': [2, 140], 'java-exception': [3, 150] },
    });

    const titles = tickMarks(ticks, AXIS, LOOK).map((m) => m.title);

    expect(titles).toEqual([
      '5 findings at 12:00:01: java-exception ×3, python-traceback ×2',
      '1 finding at 12:00:01: sql-statement ×1',
    ]);
  });

  it('names the middle of a wide column, where its tick sits', () => {
    const ticks = ticksOf({ 0: { 'sql-statement': [1, 3] } }, 10);
    expect(tickMarks(ticks, AXIS, LOOK)[0].title).toBe('1 finding at 12:00:49: sql-statement ×1');
  });

  it("opens its group's first finding in the column: the smallest first line of the group's signatures", () => {
    const ticks = ticksOf({
      1: { 'python-traceback': [2, 140], 'java-exception': [1, 130], 'sql-statement': [1, 120] },
    });

    const marks = tickMarks(ticks, AXIS, LOOK);

    expect(marks.map((m) => [m.group, m.firstLine, m.signatures])).toEqual([
      ['traceback', 130, ['java-exception', 'python-traceback']],
      ['sql', 120, ['sql-statement']],
    ]);
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

describe('tickBox', () => {
  /** The track of the timeline bar as the browser lays it out. */
  const TRACK_PX = 32;

  it.each([
    [1, [1]],
    [3, [1, 7, 13]],
    [11, [1, 3.5, 6, 8.5, 11, 13.5, 16, 18.5, 21, 23.5, 26]],
  ])(
    'stacks %i lanes of 5 px ticks inside the track, overlapping when they do not fit',
    (lanes, tops) => {
      const boxes = Array.from({ length: lanes }, (_, lane) => tickBox(TRACK_PX, lanes, lane));

      expect(boxes.map((box) => box.topPx)).toEqual(tops);
      expect(boxes.every((box) => box.heightPx === 5)).toBe(true);
      expect(boxes.every((box) => box.topPx >= 0 && box.topPx + box.heightPx <= TRACK_PX)).toBe(
        true,
      );
    },
  );

  it('keeps a tick at least 3 px tall on a short track', () => {
    for (const lane of [0, 5, 10]) {
      const box = tickBox(6, 11, lane);
      expect(box.heightPx).toBeGreaterThanOrEqual(MIN_TICK_PX);
      expect(box.topPx).toBeGreaterThanOrEqual(0);
    }
    expect(MIN_TICK_PX).toBe(3);
  });

  it('lays a track that has no height yet out as the bar does', () => {
    expect(tickBox(0, 3, 2)).toEqual(tickBox(TRACK_PX, 3, 2));
  });
});
