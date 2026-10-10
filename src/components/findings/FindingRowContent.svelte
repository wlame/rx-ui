<!--
  What one row of the findings list shows. A finding: its group's colour
  bar, its line or lines, its signature's name and its excerpt (masked by
  the backend where a value is secret). A header: its group or
  signature, its count, and for a capped signature how many it shows. A
  row whose finding has not arrived: an ellipsis.
-->
<script lang="ts">
  import type { SignaturesState } from '$lib/stores/signatures';
  import type { Finding, SignatureInfo } from '$lib/types';
  import type { FindingRow } from '$lib/utils/findingRows';
  import { groupStyle } from '$lib/utils/groupStyle';

  export let row: FindingRow;
  /** The catalogue's signatures, by id. */
  export let signatureOf: ReadonlyMap<string, SignatureInfo>;
  export let catalogue: Pick<SignaturesState, 'groups'>;

  const MUTED = 'text-gh-fg-muted dark:text-gh-fg-dark-muted';

  function lineText(finding: Finding): string {
    const { start_line: start, end_line: end } = finding;
    return start === end ? String(start) : `${start}–${end}`;
  }
</script>

{#if row.kind === 'finding'}
  {@const signature = signatureOf.get(row.finding.signature)}
  <span
    class="w-1 h-4 rounded-sm flex-shrink-0 {groupStyle(signature?.group ?? '', catalogue.groups)
      .className}"
    style="background: var(--rx-group-color)"
    aria-hidden="true"
  />
  <span class="w-20 flex-shrink-0 tabular-nums {MUTED}">
    {lineText(row.finding)}
  </span>
  <span class="flex-shrink-0 max-w-[40%] truncate font-medium">
    {signature?.name ?? row.finding.signature}
  </span>
  <span class="min-w-0 truncate font-mono {MUTED}">
    {row.finding.excerpt}
  </span>
{:else if row.kind === 'placeholder'}
  <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle">…</span>
{:else}
  <span class="w-3 flex-shrink-0 {MUTED}" aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span>
  {#if row.kind === 'group'}
    <span class="font-semibold truncate">{row.group || 'Other signatures'}</span>
    <span class={MUTED}>{row.count.toLocaleString()}</span>
  {:else}
    <span class="font-medium truncate">{signatureOf.get(row.id)?.name ?? row.id}</span>
    <span class={MUTED}>{row.count.toLocaleString()}</span>
    {#if row.stored < row.count}
      <span class="text-gh-attention-fg dark:text-gh-attention-dark-fg">
        showing {row.stored.toLocaleString()} of {row.count.toLocaleString()}
      </span>
    {/if}
  {/if}
{/if}
