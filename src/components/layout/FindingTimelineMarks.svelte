<script lang="ts">
  /**
   * The ticks of the active file's findings on the timeline bar's track:
   * one thin, short tick per group per column that holds findings, in
   * the group's colour, each group in a lane of its own (`tickBox`: 5 px
   * tall, the lanes overlapping when they do not fit the track). A tick
   * stands for its group's findings in the column: a hover says them,
   * their time and each signature's count; a click opens the first of
   * them. A press on a tick is
   * its own, so it never starts a scrub of the track. The ticks sit under
   * the thumb and the time cursor, and are not Tab stops: the keys of
   * the track and F8 in the editor reach the same places.
   */
  import type { FindingsTicks, GroupInfo, SignatureInfo } from '$lib/types';
  import { tickBox, tickMarks, type TickMark } from '$lib/utils/findingTicks';
  import { memoizeLast } from '$lib/utils/memoizeLast';
  import type { TimeAxis } from '$lib/utils/timeline';

  /** The `ticks` of a findings answer. */
  export let ticks: FindingsTicks;
  /** The catalogue's groups, whose order gives each its colour and lane. */
  export let groups: readonly GroupInfo[];
  /** Open the first finding of the signatures `signatures` that starts on `line`. */
  export let onOpen: (line: number, signatures: readonly string[]) => void;
  /** The axis the track draws. */
  export let axis: TimeAxis;
  /** The catalogue's signatures, which name each one's group. */
  export let catalogue: readonly SignatureInfo[];
  /** A time written as the timeline writes it. */
  export let timeLabel: (ms: number) => string;
  /** The track's height in px, as laid out; 0 before it is. */
  export let trackHeight: number;

  // The axis comes anew at each update of the active file: the marks are
  // worked out again only for another answer, range, catalogue or layout.
  const marksOf = memoizeLast(
    (
      answer: FindingsTicks,
      startMs: number,
      endMs: number,
      signatures: readonly SignatureInfo[],
      groupList: readonly GroupInfo[],
      label: (ms: number) => string,
    ) =>
      tickMarks(
        answer,
        { startMs, endMs },
        { catalogue: signatures, groups: groupList, timeLabel: label },
      ),
  );

  $: marks = marksOf(ticks, axis.startMs, axis.endMs, catalogue, groups, timeLabel);

  /** Where a tick sits along and across the track, as CSS. */
  function placeOf(mark: TickMark, height: number): string {
    const { topPx, heightPx } = tickBox(height, mark.lanes, mark.lane);
    return `left: ${mark.fraction * 100}%; top: ${topPx}px; height: ${heightPx}px`;
  }

  /** A press on a tick is the tick's: the track would start a scrub and jump on release. */
  function keepPress(event: PointerEvent) {
    event.stopPropagation();
  }
</script>

{#each marks as mark (mark.key)}
  <button
    type="button"
    tabindex="-1"
    data-finding-tick
    data-group={mark.group}
    title={mark.title}
    aria-label={mark.title}
    class="absolute w-1.5 -translate-x-1/2 p-0 cursor-pointer pointer-events-auto {mark.className}"
    style={placeOf(mark, trackHeight)}
    on:pointerdown={keepPress}
    on:click={() => onOpen(mark.firstLine, mark.signatures)}
  >
    <span class="block mx-auto w-0.5 h-full rounded-sm" style="background: var(--rx-group-color)" />
  </button>
{/each}
