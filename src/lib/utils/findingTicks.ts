/**
 * The ticks of a file's findings on the timeline: where each sits, its
 * colour, its lane and what a hover on it says, from the `ticks` member
 * of a `GET /v1/findings?ticks=W` answer.
 *
 * rx-go places a finding with time t in column
 * floor((t - start) * W / (end - start + 1)) of W columns over the file's
 * time range; each column that holds findings lists, per signature, how
 * many and the first line of the first. A column holds one tick per
 * group, in the group's colour, which stands for that group's findings
 * in the column: its hover counts them, and a click opens the first of
 * them. Each group present has a lane of its own (catalogue order), the
 * same in every column; `tickBox` stacks the lanes inside the track,
 * overlapping when they do not fit, and keeps every tick tall enough to
 * see. A tick sits at the middle of its column's instants, placed on the
 * axis as the timeline places a time, so it sits where the axis prints
 * its findings' times. Pure.
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
  /** What a hover says: the group's findings in the column, their time and each signature's count. */
  title: string;
  /** The first line of the group's first finding in the column, which a click opens. */
  firstLine: number;
  /** The group's signatures with findings in the column, by id. */
  signatures: string[];
}

/** The height of a tick, in px, when the track has room for it. */
export const TICK_PX = 5;
/** The shortest a tick is, in px, however many lanes share the track. */
export const MIN_TICK_PX = 3;
/** The space between two lanes that fit, in px. */
const TICK_GAP_PX = 1;
/** The space kept free at the top and at the bottom of the track, in px. */
const TRACK_MARGIN_PX = 1;
/** The track's height in the timeline bar, for a track not laid out yet. */
const FALLBACK_TRACK_PX = 32;

/**
 * Where the tick of lane `lane` of `lanes` sits in a track
 * `trackHeightPx` tall: its top and its height, in px. Lanes stack from
 * the top, a gap between them while they fit and overlapping when they
 * do not, so the last one still ends inside the track; a tick is
 * `TICK_PX` tall, or the track's height when shorter, and never under
 * `MIN_TICK_PX`.
 */
export function tickBox(
  trackHeightPx: number,
  lanes: number,
  lane: number,
): { topPx: number; heightPx: number } {
  const track = trackHeightPx > 0 ? trackHeightPx : FALLBACK_TRACK_PX;
  const usable = Math.max(0, track - 2 * TRACK_MARGIN_PX);
  const heightPx = Math.max(MIN_TICK_PX, Math.min(TICK_PX, usable));
  const room = Math.max(0, usable - heightPx);
  const step = lanes <= 1 ? 0 : Math.min(heightPx + TICK_GAP_PX, room / (lanes - 1));
  return { topPx: TRACK_MARGIN_PX + lane * step, heightPx };
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

type TickCounts = TickColumn['signatures'];

/**
 * What a hover on a tick says of the findings `counts` holds (one group's
 * in one column): "3 findings at 12:00:01: python-traceback ×2, …", at
 * `middleMs`, where the tick sits and where the track's own label prints
 * the time under the pointer.
 */
function tickTitle(
  counts: TickCounts,
  middleMs: number,
  timeLabel: (ms: number) => string,
): string {
  const ordered = Object.entries(counts).sort(
    ([idA, a], [idB, b]) => b.count - a.count || (idA < idB ? -1 : idA > idB ? 1 : 0),
  );
  const total = ordered.reduce((sum, [, count]) => sum + count.count, 0);
  const each = ordered.map(([id, count]) => `${id} ×${formatNumber(count.count)}`).join(', ');
  return `${formatCount(total, 'finding')} at ${timeLabel(middleMs)}: ${each}`;
}

/** The counts of a column by group: each group with its signatures' counts. */
function countsByGroup(
  column: TickColumn,
  groupOf: ReadonlyMap<string, string>,
): Map<string, TickCounts> {
  const byGroup = new Map<string, TickCounts>();
  for (const [id, count] of Object.entries(column.signatures)) {
    const group = groupOf.get(id) ?? '';
    byGroup.set(group, { ...byGroup.get(group), [id]: count });
  }
  return byGroup;
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
    const middleMs = (span.firstMs + span.lastMs) / 2;
    const fraction = fractionOf(middleMs, axis);
    const byGroup = countsByGroup(column, groupOf);
    for (const [lane, group] of lanes.entries()) {
      const counts = byGroup.get(group);
      if (!counts) continue;
      const signatures = Object.keys(counts).sort();
      marks.push({
        key: `${column.column}\u0000${group}`,
        column: column.column,
        group,
        className: groupStyle(group, look.groups).className,
        fraction,
        lane,
        lanes: lanes.length,
        title: tickTitle(counts, middleMs, look.timeLabel),
        firstLine: Math.min(...signatures.map((id) => counts[id].first_line)),
        signatures,
      });
    }
  }
  return marks;
}
