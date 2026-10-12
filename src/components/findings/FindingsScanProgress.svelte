<!--
  The findings panel's row for a running scan, under the picker's row: a
  progress bar from the bytes the scan has read, the share read, and
  Cancel. It is a row of its own so that Cancel never shares the width
  with the picker: the bar narrows, Cancel and the share never do.
-->
<script lang="ts">
  import { cancelScan, type ScanState } from '$lib/stores/findings';

  /** The open file. */
  export let path: string;
  export let scan: ScanState;

  $: percent = scan.total > 0 ? Math.floor((scan.read * 100) / scan.total) : 0;
</script>

<div class="flex items-center gap-1.5 px-3 pt-1.5" data-scan-progress>
  <div
    role="progressbar"
    aria-label={scan.joined ? 'Scan already running, joined' : 'Scan'}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={percent}
    class="flex-1 min-w-0 h-1.5 rounded bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset overflow-hidden"
  >
    <div
      class="h-full bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis"
      style="width: {percent}%"
    />
  </div>
  <span class="flex-shrink-0 text-xs tabular-nums text-gh-fg-muted dark:text-gh-fg-dark-muted">
    {percent}%
  </span>
  <button
    type="button"
    class="flex-shrink-0 whitespace-nowrap px-2 py-0.5 rounded text-xs border
           border-gh-border-default dark:border-gh-border-dark-default
           hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle disabled:opacity-50"
    disabled={scan.taskId === ''}
    on:click={() => cancelScan(path)}
  >
    Cancel
  </button>
</div>
