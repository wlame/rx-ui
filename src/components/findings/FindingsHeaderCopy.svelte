<!--
  Copy on a header of the findings group view: the copy icon, named by
  what it copies, with a tooltip that says so. It is no Tab stop, so the
  list stays one; a press on it leaves the focus and the list's keys
  where they were; its click stays with it, so the header neither opens
  nor closes.

  On a header whose findings are all hidden it is off, and its tooltip
  says how to copy them. A disabled button hears no pointer in some
  browsers, so the off Copy lets the pointer through to a frame around
  it (`data-copy-off`), which carries the tooltip.
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import Icon from '../common/Icon.svelte';

  /** What it copies: "Copy the findings of the group traceback". */
  export let label: string;
  /** Why it is off, as its tooltip says it; null while it copies. */
  export let offReason: string | null;
  export let copy: () => void;

  const BUTTON_CLASS =
    'p-0.5 rounded text-gh-fg-muted dark:text-gh-fg-dark-muted ' +
    'hover:bg-gh-canvas-inset dark:hover:bg-gh-canvas-dark-inset ' +
    'hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default';
</script>

{#if offReason === null}
  <button
    type="button"
    tabindex="-1"
    class={BUTTON_CLASS}
    aria-label={label}
    use:tooltip={{ label }}
    on:mousedown|preventDefault
    on:click|stopPropagation={copy}
  >
    <Icon name="copy" size={14} />
  </button>
{:else}
  <!-- The frame only shows the tooltip and keeps a press from moving the
       focus; a click in it reaches no row, as the list ignores a click
       in a header's actions. -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <span
    class="inline-flex"
    data-copy-off
    use:tooltip={{ label: offReason }}
    on:mousedown|preventDefault
  >
    <button
      type="button"
      tabindex="-1"
      class="{BUTTON_CLASS} opacity-50 pointer-events-none"
      aria-label={label}
      disabled
    >
      <Icon name="copy" size={14} />
    </button>
  </span>
{/if}
