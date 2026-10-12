/**
 * The ticks of a file's findings on the timeline: where each sits, its
 * colour, its lane and what a hover on it says, from the `ticks` member
 * of a `GET /v1/findings?ticks=W` answer.
 *
 * rx-go places a finding with time t in column
 * floor((t - start) * W / (end - start + 1)) of W columns over the file's
 * time range; each column that holds findings lists, per signature, how
 * many and the first line of the first. A column holds one tick per
 * group, in the group's colour; each group present has a lane of its own
 * (catalogue order), the same in every column. A tick sits at the middle
 * of its column's instants, placed on the axis as the timeline places a
 * time, so it sits where the axis prints its findings' times. Pure.
 */
import type { FindingsTicks, GroupInfo, SignatureInfo } from '../types';
import { formatCount, formatNumber } from './format';
import { groupStyle } from './groupStyle';
import { fractionOf, type TimeAxis } from './timeline';

/** One tick: the findings of one group in one column. */
export interface TickMark {
  /** Unique among the marks of an answer. */
  key: string;
  column: number;
  group: string;
  /** The group's palette class (`group-palette-<n>`), which sets `--rx-group-color`. */
  className: string;
  /** Where the tick sits on the axis, from 0 (start) to 1 (end). */
  fraction: number;
  /** The tick's lane from the top, and how many lanes the answer's groups take. */
  lane: number;
  lanes: number;
  /** What a hover says: the column's findings, their time and each signature's count. */
  title: string;
  /** The first line of the column's first finding, which a click opens. */
  firstLine: number;
}

/** What drawing the ticks reads besides the answer: the catalogue and how the timeline prints a time. */
export interface TickLook {
  catalogue: readonly SignatureInfo[];
  groups: readonly GroupInfo[];
  /** A time written as the timeline writes it. */
  timeLabel: (ms: number) => string;
}

type TickColumn = NonNullable<FindingsTicks>['columns'][number];

/** `a / b` rounded up, for `a >= 0` and `b > 0`. */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * The first and the last instant (ms) column `column` holds: every t with
 * floor((t - start) * width / (end - start + 1)) = column. Counted in
 * BigInt, as the products pass 2^53 on a span of decades.
 */
export function columnSpanMs(
  ticks: { start_ms: number | null; end_ms: number | null; width: number },
  column: number,
): { firstMs: number; lastMs: number } {
  const startMs = ticks.start_ms ?? 0;
  const endMs = ticks.end_ms ?? startMs;
  const span = BigInt(endMs - startMs + 1);
  const width = BigInt(Math.max(1, ticks.width));
  const at = BigInt(column);
  return {
    firstMs: startMs + Number(ceilDiv(at * span, width)),
    lastMs: Math.min(endMs, startMs + Number(ceilDiv((at + 1n) * span, width)) - 1),
  };
}

/** What a hover on a column's ticks says: "3 findings at 12:00:01: python-traceback ×2, …". */
function columnTitle(
  column: TickColumn,
  span: { firstMs: number; lastMs: number },
  timeLabel: (ms: number) => string,
): string {
  const counts = Object.entries(column.signatures).sort(
    ([idA, a], [idB, b]) => b.count - a.count || (idA < idB ? -1 : idA > idB ? 1 : 0),
  );
  const total = counts.reduce((sum, [, count]) => sum + count.count, 0);
  const first = timeLabel(span.firstMs);
  const last = timeLabel(span.lastMs);
  const when = first === last ? `at ${first}` : `between ${first} and ${last}`;
  const each = counts.map(([id, count]) => `${id} ×${formatNumber(count.count)}`).join(', ');
  return `${formatCount(total, 'finding')} ${when}: ${each}`;
}

/** The groups of `columns` by lane: in catalogue order, a group the catalogue lacks after them, '' last. */
function lanesOf(
  columns: readonly TickColumn[],
  groupOf: ReadonlyMap<string, string>,
  groups: readonly GroupInfo[],
): string[] {
  const present = new Set(
    columns.flatMap((column) => Object.keys(column.signatures).map((id) => groupOf.get(id) ?? '')),
  );
  const order = new Map(groups.map((group) => [group.name, group.order]));
  const rank = (group: string) =>
    group === '' ? Infinity : (order.get(group) ?? Number.MAX_SAFE_INTEGER);
  return [...present].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The ticks of an answer on `axis`, column by column and lane by lane;
 * none without an answer or a time range.
 */
export function tickMarks(ticks: FindingsTicks, axis: TimeAxis, look: TickLook): TickMark[] {
  if (!ticks || ticks.start_ms === null || ticks.end_ms === null) return [];
  const groupOf = new Map(look.catalogue.map((signature) => [signature.id, signature.group]));
  const lanes = lanesOf(ticks.columns, groupOf, look.groups);
  const marks: TickMark[] = [];
  for (const column of ticks.columns) {
    const span = columnSpanMs(ticks, column.column);
    const title = columnTitle(column, span, look.timeLabel);
    const fraction = fractionOf((span.firstMs + span.lastMs) / 2, axis);
    const firstLine = Math.min(...Object.values(column.signatures).map((c) => c.first_line));
    const groupsHere = new Set(Object.keys(column.signatures).map((id) => groupOf.get(id) ?? ''));
    for (const [lane, group] of lanes.entries()) {
      if (!groupsHere.has(group)) continue;
      marks.push({
        key: `${column.column}\u0000${group}`,
        column: column.column,
        group,
        className: groupStyle(group, look.groups).className,
        fraction,
        lane,
        lanes: lanes.length,
        title,
        firstLine,
      });
    }
  }
  return marks;
}
