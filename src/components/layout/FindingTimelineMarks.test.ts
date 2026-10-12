// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { TEST_GROUPS, TEST_SIGNATURES } from '$lib/testing/fakeFindings';
import type { FindingsTicks } from '$lib/types';
import { groupStyle } from '$lib/utils/groupStyle';
import FindingTimelineMarks from './FindingTimelineMarks.svelte';

/** 2026-10-10 12:00:00 UTC; the file spans 1,000 s, one second per column of 1,000. */
const NOON = Date.UTC(2026, 9, 10, 12, 0, 0);
const AXIS = { startMs: NOON, endMs: NOON + 999_999 };

/** A traceback ×2 and an SQL statement ×1 at 12:00:01, and an SQL statement at 12:08:20. */
const TICKS: NonNullable<FindingsTicks> = {
  start_ms: AXIS.startMs,
  end_ms: AXIS.endMs,
  width: 1000,
  columns: [
    {
      column: 1,
      signatures: {
        'python-traceback': { count: 2, first_line: 140 },
        'sql-statement': { count: 1, first_line: 120 },
      },
    },
    { column: 500, signatures: { 'sql-statement': { count: 1, first_line: 9000 } } },
  ],
};

let mounted: FindingTimelineMarks | null = null;

function mount(ticks: FindingsTicks = TICKS) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onOpen = vi.fn();
  mounted = new FindingTimelineMarks({
    target,
    props: {
      ticks,
      groups: TEST_GROUPS,
      onOpen,
      axis: AXIS,
      catalogue: TEST_SIGNATURES,
      timeLabel: (ms: number) => new Date(ms).toISOString().slice(11, 19),
    },
  });
  return { target, onOpen };
}

function ticksIn(target: HTMLElement): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>('[data-finding-tick]')];
}

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  document.body.replaceChildren();
});

describe('FindingTimelineMarks', () => {
  it("draws a column's groups as two ticks in their colours, and a lone one as one", () => {
    const { target } = mount();

    // Each tick sits at the middle of its column: 1.5 s and 500.5 s into 1,000 s.
    const percent = (t: HTMLElement) => Math.round(parseFloat(t.style.left) * 100) / 100;
    const drawn = ticksIn(target).map((t) => [t.dataset.group, percent(t)]);

    expect(drawn).toEqual([
      ['traceback', 0.15],
      ['sql', 0.15],
      ['sql', 50.05],
    ]);
    const colours = ticksIn(target).map((t) => t.className);
    expect(colours[0]).toContain(groupStyle('traceback', TEST_GROUPS).className);
    expect(colours[1]).toContain(groupStyle('sql', TEST_GROUPS).className);
  });

  it("says the column's findings and their time on hover", () => {
    const { target } = mount();
    expect(ticksIn(target)[1].title).toBe(
      '3 findings at 12:00:01: python-traceback ×2, sql-statement ×1',
    );
  });

  it("opens the column's first finding on a click, and leaves the track's own press alone", async () => {
    const { target, onOpen } = mount();
    const track = vi.fn();
    target.addEventListener('pointerdown', track);
    const [first] = ticksIn(target);

    first.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    first.click();
    await tick();

    expect(onOpen).toHaveBeenCalledWith(120);
    expect(track).not.toHaveBeenCalled();
  });

  it('is not a Tab stop', () => {
    const { target } = mount();
    expect(ticksIn(target).every((t) => t.tabIndex === -1)).toBe(true);
  });

  it('draws nothing for a file without a time range', () => {
    const { target } = mount({ start_ms: null, end_ms: null, width: 1000, columns: [] });
    expect(ticksIn(target)).toEqual([]);
  });
});
