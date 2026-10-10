<!--
  The findings panel's toolbar: the By line / By group switch, which the
  URL holds as `findings_by`, and the filter box, whose text is sent as
  `q` once typing pauses and stays out of the URL.
-->
<script context="module" lang="ts">
  /** How long the filter box waits after the last key before the list asks again. */
  export const FILTER_WAIT_MS = 300;
</script>

<script lang="ts">
  import { findingsFilter } from '$lib/stores/findings';
  import { findingsBy, modalOpen } from '$lib/stores/layout';
  import { FINDINGS_VIEWS, type FindingsView } from '$lib/utils/findingsNav';
  import { isShortcut } from '$lib/utils/shortcuts';

  /** The name of each order on its button of the switch. */
  const VIEW_NAMES: Readonly<Record<FindingsView, string>> = { line: 'By line', group: 'By group' };
  /** How far each arrow key moves the choice through the orders, around the ends. */
  const MOVES: readonly { key: string; step: number }[] = [
    { key: 'ArrowLeft', step: -1 },
    { key: 'ArrowRight', step: 1 },
  ];

  const ON_CLASS = 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white';
  const OFF_CLASS =
    'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted ' +
    'hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle';
  const FOCUS_CLASS =
    'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ' +
    'focus-visible:outline-gh-accent-emphasis dark:focus-visible:outline-gh-accent-dark-emphasis';
  const VIEW_CLASS = `px-1.5 py-0.5 text-xs leading-4 first:rounded-l last:rounded-r ${FOCUS_CLASS}`;

  let viewSwitch: HTMLElement;
  let text = $findingsFilter;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** The filter is sent once typing pauses, so each key does not ask the backend again. */
  function handleInput() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      findingsFilter.set(text);
    }, FILTER_WAIT_MS);
  }

  /** The order `step` places after `from` in the switch, around the ends. */
  function viewAfter(from: FindingsView, step: number): FindingsView {
    const count = FINDINGS_VIEWS.length;
    return FINDINGS_VIEWS[(FINDINGS_VIEWS.indexOf(from) + step + count) % count];
  }

  /** ← and → choose the other order and focus its button; while a dialog is open, they are its own. */
  function handleViewKeydown(event: KeyboardEvent) {
    if ($modalOpen) return;
    const move = MOVES.find((m) => m.key === event.key && isShortcut('findingsViewMove', event));
    if (!move) return;
    event.preventDefault();
    const next = viewAfter($findingsBy, move.step);
    findingsBy.set(next);
    viewSwitch.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
  }
</script>

<div class="flex items-center gap-1.5 px-3 py-1.5">
  <div
    bind:this={viewSwitch}
    role="radiogroup"
    aria-label="Findings order"
    class="flex flex-shrink-0 rounded border border-gh-border-default dark:border-gh-border-dark-default"
  >
    {#each FINDINGS_VIEWS as view (view)}
      {@const isChecked = view === $findingsBy}
      <button
        type="button"
        role="radio"
        aria-checked={isChecked}
        tabindex={isChecked ? 0 : -1}
        data-view={view}
        class="{VIEW_CLASS} {isChecked ? ON_CLASS : OFF_CLASS}"
        on:click={() => findingsBy.set(view)}
        on:keydown={handleViewKeydown}
      >
        {VIEW_NAMES[view]}
      </button>
    {/each}
  </div>
  <input
    type="search"
    class="input py-0.5 px-2 text-xs flex-1 min-w-0"
    placeholder="Filter…"
    aria-label="Filter findings"
    title="Show the findings whose excerpt or signature name holds this text"
    bind:value={text}
    on:input={handleInput}
  />
</div>
