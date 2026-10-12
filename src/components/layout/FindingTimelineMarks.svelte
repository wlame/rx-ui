<script lang="ts">
  /**
   * The ticks of the active file's findings on the timeline bar's track:
   * one thin, short tick per group per column that holds findings, in
   * the group's colour, each group in a lane of its own above the band.
   * A hover says the column's findings, their time and each signature's
   * count; a click opens the column's first finding. A press on a tick is
   * its own, so it never starts a scrub of the track. The ticks sit under
   * the thumb and the time cursor, and are not Tab stops: the keys of
   * the track and F8 in the editor reach the same places.
   */
  import type { FindingsTicks, GroupInfo, SignatureInfo } from '$lib/types';
  import { tickMarks } from '$lib/utils/findingTicks';
  import { memoizeLast } from '$lib/utils/memoizeLast';
  import type { TimeAxis } from '$lib/utils/timeline';

  /** The `ticks` of a findings answer. */
  export let ticks: FindingsTicks;
  /** The catalogue's groups, whose order gives each its colour and lane. */
  export let groups: readonly GroupInfo[];
  /** Open the first finding that starts on `line`. */
  export let onOpen: (line: number) => void;
  /** The axis the track draws. */
  export let axis: TimeAxis;
  /** The catalogue's signatures, which name each one's group. */
  export let catalogue: readonly SignatureInfo[];
  /** A time written as the timeline writes it. */
  export let timeLabel: (ms: number) => string;

  /** The tallest a lane is; with many groups each lane shares the space above the band. */
  const LANE = (lanes: number) => `min(5px, (50% - 5px) / ${lanes})`;

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
    style="left: {mark.fraction * 100}%; top: calc(1px + {mark.lane} * {LANE(
      mark.lanes,
    )}); height: calc({LANE(mark.lanes)} - 1px)"
    on:pointerdown={keepPress}
    on:click={() => onOpen(mark.firstLine)}
  >
    <span class="block mx-auto w-0.5 h-full rounded-sm" style="background: var(--rx-group-color)" />
  </button>
{/each}
