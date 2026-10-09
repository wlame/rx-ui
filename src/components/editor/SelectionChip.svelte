<script lang="ts">
  /**
   * The editor header's chip for the tab's selected lines: how many
   * ranges and lines are selected, Copy and × (clear). Nothing shows
   * while no line is selected.
   *
   * The header gives what the two buttons do: `copy`, which resolves when
   * the copy ended (null where the tab's selection cannot be copied), and
   * `clear`. Copy is disabled while a copy runs.
   */
  import { tooltip } from '$lib/actions/tooltip';
  import { formatCount } from '$lib/utils/format';
  import { selectionLineCount, type LineRange } from '$lib/utils/lineSelection';

  export let ranges: readonly LineRange[];
  export let copy: (() => Promise<void>) | null;
  export let clear: () => void;

  let isCopying = false;

  $: summary = `${formatCount(ranges.length, 'range')} · ${formatCount(selectionLineCount(ranges), 'line')}`;
  $: copyLabel = copy
    ? 'Copy the selected lines'
    : 'Copying works once the log chain is ready, which numbers its lines';

  async function runCopy() {
    if (!copy || isCopying) return;
    isCopying = true;
    try {
      await copy();
    } finally {
      isCopying = false;
    }
  }

  const BUTTON_CLASS =
    'px-1 rounded hover:bg-gh-accent-muted dark:hover:bg-gh-accent-dark-muted disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent';
</script>

{#if ranges.length > 0}
  <div
    role="group"
    aria-label="Selected lines"
    class="flex items-center gap-1 flex-shrink-0 text-xs font-medium rounded border px-1.5 py-0.5
           border-gh-accent-fg dark:border-gh-accent-dark-fg
           text-gh-accent-fg dark:text-gh-accent-dark-fg"
  >
    <span class="tabular-nums whitespace-nowrap">{summary}</span>
    <button
      type="button"
      class={BUTTON_CLASS}
      aria-label="Copy the selected lines"
      disabled={!copy || isCopying}
      use:tooltip={{ label: copyLabel }}
      on:click={runCopy}
    >
      Copy
    </button>
    <button
      type="button"
      class={BUTTON_CLASS}
      aria-label="Clear the selected lines"
      use:tooltip={{ label: 'Clear the selected lines', shortcut: 'clearSelection' }}
      on:click={clear}
    >
      ×
    </button>
  </div>
{/if}
