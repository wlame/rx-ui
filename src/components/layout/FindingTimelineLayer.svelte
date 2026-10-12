<script context="module" lang="ts">
  /** How long the track keeps a new width before its ticks are asked again. */
  export const RESIZE_WAIT_MS = 150;
</script>

<script lang="ts">
  /**
   * The findings of a file on the timeline bar's track: this layer spans
   * the track, measures its width and height, asks for the ticks of what the
   * Findings panel lists, one column per pixel (`stores/findingTicks.ts`),
   * and draws them with FindingTimelineMarks. The bar draws it only while
   * it shows a file's axis, so a hidden timeline asks nothing. A new width
   * is asked once the track has kept it for `RESIZE_WAIT_MS`, so a drag of
   * the window's edge does not ask at every step. The answer of another
   * file is never drawn.
   */
  import { onDestroy } from 'svelte';
  import { measureHeight, measureWidth } from '$lib/actions/measureSize';
  import { api, type FindingsQuery } from '$lib/api';
  import { markInputs } from '$lib/stores/editorFindings';
  import { fileZones } from '$lib/stores/fileZones';
  import { openTickFinding, ticksRequestOf, type TicksRequest } from '$lib/stores/findingTicks';
  import { backendHas, health } from '$lib/stores/health';
  import { signatures } from '$lib/stores/signatures';
  import type { FindingsTicks, OpenFile } from '$lib/types';
  import { fileZoneOf } from '$lib/utils/fileZones';
  import { LatestRequest, SUPERSEDED, isAbortError } from '$lib/utils/latestRequest';
  import { memoizeLast } from '$lib/utils/memoizeLast';
  import { timeLabelFor, type TimeAxis } from '$lib/utils/timeline';
  import FindingTimelineMarks from './FindingTimelineMarks.svelte';

  /** The file the timeline shows; never a log chain's tab. */
  export let file: OpenFile;
  /** The axis the track draws. */
  export let axis: TimeAxis;

  /** The track's width in pixels, as last kept; 0 before it is laid out. */
  let width = 0;
  /** The track's height in pixels, which the ticks' lanes share; 0 before it is laid out. */
  let height = 0;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last answer, and the file it is of. */
  let shown: { path: string; ticks: FindingsTicks } | null = null;
  let askedKey: string | null = null;
  const latest = new LatestRequest();

  // A time label reads only the file's time range, which outlives most
  // updates of the file: one label function per range.
  const labelOf = memoizeLast(
    (timeRange: OpenFile['timeRange']) => (ms: number) =>
      timeLabelFor(ms, { timeRange, chain: undefined }),
  );

  $: zone = backendHas('file_tz', $health)
    ? (fileZoneOf($fileZones, file.path) ?? undefined)
    : undefined;
  $: request = ticksRequestOf(file.path, { width, axis, zone, marks: $markInputs });
  $: ask(file.path, request);
  $: ticks = shown?.path === file.path ? shown.ticks : null;
  $: timeLabel = labelOf(file.timeRange);

  /** Ask for the ticks once per request; a null request asks nothing and draws none. */
  function ask(path: string, next: TicksRequest | null) {
    const key = next?.key ?? null;
    if (key === askedKey) return;
    askedKey = key;
    if (next === null) {
      latest.abort();
      shown = null;
      return;
    }
    void load(path, next.query);
  }

  async function load(path: string, query: FindingsQuery) {
    try {
      const answer = await latest.run((signal) => api.getFindings(path, query, { signal }));
      if (answer !== SUPERSEDED) shown = { path, ticks: answer.ticks };
    } catch (error) {
      // The ticks drawn stay; another width, filter or scan asks again.
      if (!isAbortError(error)) console.warn('Failed to read the ticks of the findings:', error);
    }
  }

  /** The first width is taken at once; a later one once the track keeps it. */
  function noteWidth(px: number) {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = null;
    if (width === 0 || px === 0) {
      width = px;
      return;
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      width = px;
    }, RESIZE_WAIT_MS);
  }

  onDestroy(() => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    latest.abort();
  });
</script>

<div
  class="absolute inset-0 pointer-events-none"
  data-finding-ticks
  use:measureWidth={noteWidth}
  use:measureHeight={(px) => (height = px)}
>
  {#if ticks}
    <FindingTimelineMarks
      {ticks}
      groups={$signatures.groups}
      catalogue={$signatures.list}
      {axis}
      {timeLabel}
      trackHeight={height}
      onOpen={(line, ids) => openTickFinding(file.path, line, ids)}
    />
  {/if}
</div>
