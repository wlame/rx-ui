<!--
  The eye of a header of the findings group view: how much of its
  findings is shown, as the picker's box says it (all: the eye open;
  none: the eye shut; some: the eye open and faint), and a click that
  hides them all when all are shown and shows them all otherwise.

  Like Copy, it sits in the header's actions (`data-header-actions`): it
  is no Tab stop, so the list stays one; a press on it leaves the focus
  and the list's keys where they were; its click stays with it, so the
  header neither opens nor closes; and a focused eye keeps its own Enter
  and Space. Space on the focused header does what a click on the eye
  does.
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import type { CheckState } from '$lib/utils/findingsPicker';
  import Icon from '../common/Icon.svelte';

  /** How much of the header's findings is shown. */
  export let state: CheckState;
  /** Whose findings the header holds: "the group traceback", or a signature's name. */
  export let subject: string;
  /** Hide the header's findings when all are shown, else show them all. */
  export let toggle: () => void;

  /** The eye is pressed while the findings are shown, and mixed while some are. */
  const PRESSED: Readonly<Record<CheckState, 'true' | 'mixed' | 'false'>> = {
    all: 'true',
    some: 'mixed',
    none: 'false',
  };

  $: label = `${state === 'all' ? 'Hide' : 'Show'} the findings of ${subject}`;
</script>

<span class="flex-shrink-0 flex items-center" data-header-actions>
  <button
    type="button"
    tabindex="-1"
    class="p-0.5 rounded text-gh-fg-muted dark:text-gh-fg-dark-muted
           hover:bg-gh-canvas-inset dark:hover:bg-gh-canvas-dark-inset
           hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default"
    aria-label={label}
    aria-pressed={PRESSED[state]}
    use:tooltip={{ label, shortcut: 'findingsToggleShown' }}
    on:mousedown|preventDefault
    on:click|stopPropagation={toggle}
  >
    <Icon
      name={state === 'none' ? 'eye-off' : 'eye'}
      size={14}
      class={state === 'some' ? 'opacity-50' : ''}
    />
  </button>
</span>
