<!--
  What one row of the findings list shows. A finding: its group's colour
  bar, its line or lines, its signature's name and its excerpt (masked by
  the backend where a value is secret). A header: its group's colour
  mark, its group or signature, its count, the eye that hides or shows
  its findings, and for a capped signature how many it shows; the marks
  make the group view the legend of the timeline's ticks. A row whose
  finding has not arrived: an ellipsis. A hidden row is greyed, all but
  its eye.
-->
<script lang="ts">
  import type { SignaturesState } from '$lib/stores/signatures';
  import type { Finding, SignatureInfo } from '$lib/types';
  import type { FindingRow, HeaderRow } from '$lib/utils/findingRows';
  import { groupStyle } from '$lib/utils/groupStyle';
  import FindingsEye from './FindingsEye.svelte';

  export let row: FindingRow;
  /** The catalogue's signatures, by id. */
  export let signatureOf: ReadonlyMap<string, SignatureInfo>;
  export let catalogue: Pick<SignaturesState, 'groups'>;
  /** Hide or show the findings of a header, as a click on its eye does. */
  export let toggleShown: (header: HeaderRow) => void;

  const MUTED = 'text-gh-fg-muted dark:text-gh-fg-dark-muted';

  $: dim = row.kind !== 'placeholder' && row.hidden ? 'opacity-50' : '';

  /** The palette class of the group a header row belongs to. */
  function headerGroupClass(header: HeaderRow): string {
    const group =
      header.kind === 'group' ? header.group : (signatureOf.get(header.id)?.group ?? '');
    return groupStyle(group, catalogue.groups).className;
  }

  /** Whose findings a header holds, as its eye names them. */
  function subjectOf(header: HeaderRow): string {
    if (header.kind === 'group') return `the group ${header.group}`;
    return signatureOf.get(header.id)?.name ?? header.id;
  }

  function lineText(finding: Finding): string {
    const { start_line: start, end_line: end } = finding;
    return start === end ? String(start) : `${start}–${end}`;
  }
</script>

{#if row.kind === 'finding'}
  {@const signature = signatureOf.get(row.finding.signature)}
  <span
    class="w-1 h-4 rounded-sm flex-shrink-0 {groupStyle(signature?.group ?? '', catalogue.groups)
      .className} {dim}"
    style="background: var(--rx-group-color)"
    aria-hidden="true"
  />
  <span class="w-20 flex-shrink-0 tabular-nums {MUTED} {dim}">
    {lineText(row.finding)}
  </span>
  <span class="flex-shrink-0 max-w-[40%] truncate font-medium {dim}">
    {signature?.name ?? row.finding.signature}
  </span>
  <span class="min-w-0 truncate font-mono {MUTED} {dim}">
    {row.finding.excerpt}
  </span>
{:else if row.kind === 'placeholder'}
  <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle">…</span>
{:else}
  {@const header = row}
  <span class="w-3 flex-shrink-0 {MUTED} {dim}" aria-hidden="true">
    {row.collapsed ? '▸' : '▾'}
  </span>
  <span
    data-group-mark
    class="w-1 h-4 rounded-sm flex-shrink-0 {headerGroupClass(row)} {dim}"
    style="background: var(--rx-group-color)"
    aria-hidden="true"
  />
  {#if row.kind === 'group'}
    <span class="font-semibold truncate {dim}">{row.group || 'Other signatures'}</span>
  {:else}
    <span class="font-medium truncate {dim}">{signatureOf.get(row.id)?.name ?? row.id}</span>
  {/if}
  <span class="{MUTED} {dim}">{row.count.toLocaleString()}</span>
  {#if row.eye !== null}
    <FindingsEye state={row.eye} subject={subjectOf(header)} toggle={() => toggleShown(header)} />
  {/if}
  {#if row.kind === 'signature' && row.stored < row.count}
    <span class="text-gh-attention-fg dark:text-gh-attention-dark-fg {dim}">
      showing {row.stored.toLocaleString()} of {row.count.toLocaleString()}
    </span>
  {/if}
{/if}
