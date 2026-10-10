<!--
  The findings panel's scan controls for the open file. With no scan
  running: "Scan N missing", which scans only the picked signatures the
  cache does not answer, or "Up to date". While a scan runs: a progress
  bar from the bytes the scan has read, and Cancel. The ⋯ button opens a
  small menu: Rescan (every picked signature again), Copy all, and how
  many lines before each finding a copy holds. It is a popover: Esc or a
  click outside closes it.
-->
<script lang="ts">
  import {
    MAX_COPY_LINES_BEFORE,
    cancelScan,
    copyLinesBefore,
    startScan,
    type FindingsTabState,
  } from '$lib/stores/findings';
  import { scanLabel } from '$lib/utils/findingsSummary';
  import { isShortcut } from '$lib/utils/shortcuts';

  /** The open file. */
  export let path: string;
  export let tab: FindingsTabState;
  /** The picker's selection as a request sends it (`selectionOf`); null when nothing is picked. */
  export let selection: string[] | null;
  /** Copy every listed finding; null until copying is offered, which leaves Copy all disabled. */
  export let onCopyAll: (() => void) | null = null;

  /** Every choice of lines before each finding, from none to the most. */
  const LINES_BEFORE = Array.from({ length: MAX_COPY_LINES_BEFORE + 1 }, (_, n) => n);

  const MENU_ITEM_CLASS =
    'w-full text-left px-3 py-1 hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle ' +
    'disabled:opacity-50 disabled:hover:bg-transparent';

  let isMenuOpen = false;
  let menuWrapper: HTMLElement;
  let menuButton: HTMLButtonElement;

  $: scan = tab.scan;
  $: missing = tab.summary?.missing ?? [];
  $: canScan = tab.summary !== null && selection !== null && missing.length > 0;
  $: percent = scan !== null && scan.total > 0 ? Math.floor((scan.read * 100) / scan.total) : 0;

  /** Scan the picked signatures the cache does not answer. */
  function scanMissing() {
    void startScan(path, missing, false);
  }

  /** Scan every picked signature again: the default set by name, so the backend resolves it. */
  function rescan() {
    isMenuOpen = false;
    if (selection === null) return;
    void startScan(path, selection.length === 0 ? ['default'] : selection, true);
  }

  function copyAll() {
    isMenuOpen = false;
    onCopyAll?.();
  }

  /** Esc closes the menu and gives the focus back to its button. */
  function handleKeydown(event: KeyboardEvent) {
    if (!isMenuOpen || event.defaultPrevented || !isShortcut('closeFindingsPopover', event)) return;
    event.preventDefault();
    isMenuOpen = false;
    menuButton.focus();
  }

  function handleWindowClick(event: MouseEvent) {
    const isInside = event.target instanceof Node && menuWrapper.contains(event.target);
    if (isMenuOpen && !isInside) isMenuOpen = false;
  }
</script>

<svelte:window on:click={handleWindowClick} />

{#if scan}
  <div class="flex-1 flex items-center gap-1.5 min-w-0">
    <div
      role="progressbar"
      aria-label={scan.joined ? 'Scan already running, joined' : 'Scan'}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={percent}
      class="flex-1 h-1.5 rounded bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset overflow-hidden"
    >
      <div
        class="h-full bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis"
        style="width: {percent}%"
      />
    </div>
    <span class="text-xs tabular-nums text-gh-fg-muted dark:text-gh-fg-dark-muted">{percent}%</span>
    <button
      type="button"
      class="px-2 py-0.5 rounded text-xs border border-gh-border-default dark:border-gh-border-dark-default
             hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle disabled:opacity-50"
      disabled={scan.taskId === ''}
      on:click={() => cancelScan(path)}
    >
      Cancel
    </button>
  </div>
{:else}
  <button
    type="button"
    data-scan
    class="px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap
           bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white
           disabled:bg-gh-canvas-inset dark:disabled:bg-gh-canvas-dark-inset
           disabled:text-gh-fg-muted dark:disabled:text-gh-fg-dark-muted"
    disabled={!canScan}
    on:click={scanMissing}
  >
    {scanLabel(missing.length)}
  </button>
{/if}

<!-- The keys reach this wrapper from its controls, which hear them first. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div bind:this={menuWrapper} class="relative flex-shrink-0" on:keydown={handleKeydown}>
  <button
    bind:this={menuButton}
    type="button"
    class="px-1.5 py-0.5 rounded text-xs hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
    aria-label="More scan actions"
    aria-expanded={isMenuOpen}
    aria-controls="findings-menu"
    on:click={() => (isMenuOpen = !isMenuOpen)}
  >
    ⋯
  </button>
  {#if isMenuOpen}
    <div
      id="findings-menu"
      role="group"
      aria-label="More scan actions"
      class="absolute right-0 top-full mt-1 z-20 w-56 py-1 rounded shadow-lg text-xs
             bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default"
    >
      <button
        type="button"
        class={MENU_ITEM_CLASS}
        disabled={selection === null || scan !== null}
        title="Scan every picked signature again, those the cache answers too"
        on:click={rescan}
      >
        Rescan
      </button>
      <button
        type="button"
        class={MENU_ITEM_CLASS}
        disabled={onCopyAll === null}
        on:click={copyAll}
      >
        Copy all
      </button>
      <label class="flex items-center justify-between gap-2 px-3 py-1">
        <span>Lines before each finding</span>
        <select
          class="input py-0 px-1 text-xs"
          aria-label="Lines before each finding"
          bind:value={$copyLinesBefore}
        >
          {#each LINES_BEFORE as count (count)}
            <option value={count}>{count}</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}
</div>
