<!--
  The findings panel's signature picker: a button that names the choice
  ("Signatures: Default (64)") and opens a checklist of the active
  signatures, group by group, with a three-state box per group, a filter
  box, the presets Default, All and None, a mark on opt-in signatures and
  on those already current for the open file. The choice is the viewer's
  own (`AppSettings.findingsPicker`): kept in the browser, never in the
  URL. It is a popover, not a dialog: Esc or a click outside closes it.
-->
<script lang="ts">
  import { settings } from '$lib/stores';
  import { currentSignatures } from '$lib/stores/findings';
  import { signatures } from '$lib/stores/signatures';
  import {
    PICKER_PRESETS,
    filterSignatures,
    groupCheckState,
    pickedIds,
    pickerChoice,
    pickerGroups,
    pickerSummary,
    toggleGroup,
    toggleSignature,
    type PickerGroup,
    type PickerPreset,
  } from '$lib/utils/findingsPicker';
  import { isShortcut } from '$lib/utils/shortcuts';

  /** The open file, whose current signatures the checklist marks. */
  export let path: string;

  let isOpen = false;
  let wrapper: HTMLElement;
  let trigger: HTMLButtonElement;
  let filterText = '';
  /** The signatures with a current cache entry for `path`, picked or not. */
  let current: ReadonlySet<string> = new Set();

  $: picked = pickedIds($settings.findingsPicker, $signatures);
  $: pickedSet = new Set(picked);
  $: summary = pickerSummary($settings.findingsPicker, $signatures);
  $: groups = pickerGroups(filterSignatures($signatures.list, filterText), $signatures.groups);
  $: if (isOpen) void readCurrent(path);

  /**
   * Ask which signatures are current for the file. The marks of the file
   * shown before go at once; an answer for another file is dropped.
   */
  async function readCurrent(forPath: string) {
    current = new Set();
    const ids = await currentSignatures(forPath);
    if (forPath === path) current = new Set(ids);
  }

  /** Keep a choice of `ids`; the default set is kept as no choice, so it follows the catalogue. */
  function choose(ids: readonly string[]) {
    const findingsPicker = pickerChoice(ids, $signatures);
    settings.update((s) => ({ ...s, findingsPicker }));
  }

  function applyPreset(preset: PickerPreset) {
    const findingsPicker = preset.choose($signatures);
    settings.update((s) => ({ ...s, findingsPicker }));
  }

  function idsOf(group: PickerGroup): string[] {
    return group.signatures.map((signature) => signature.id);
  }

  function toggle() {
    isOpen = !isOpen;
    filterText = '';
  }

  /** Esc closes the picker and gives the focus back to its button. */
  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen || event.defaultPrevented || !isShortcut('closeFindingsPopover', event)) return;
    event.preventDefault();
    isOpen = false;
    trigger.focus();
  }

  /** A click outside the picker and its button closes it. */
  function handleWindowClick(event: MouseEvent) {
    if (isOpen && !(event.target instanceof Node && wrapper.contains(event.target))) isOpen = false;
  }

  /** A box that shows a group partly picked: the browser draws it mixed, and reads it so. */
  function mixed(node: HTMLInputElement, isMixed: boolean) {
    node.indeterminate = isMixed;
    return {
      update(next: boolean) {
        node.indeterminate = next;
      },
    };
  }
</script>

<svelte:window on:click={handleWindowClick} />

<!-- The keys reach this wrapper from its controls, which hear them first. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div bind:this={wrapper} class="min-w-0" on:keydown={handleKeydown}>
  <button
    bind:this={trigger}
    type="button"
    class="max-w-full truncate px-2 py-0.5 rounded text-xs border
           border-gh-border-default dark:border-gh-border-dark-default
           hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
    aria-expanded={isOpen}
    aria-controls="findings-picker"
    title="Choose the signatures to list and scan"
    on:click={toggle}
  >
    Signatures: {summary} ▾
  </button>
  {#if isOpen}
    <div
      id="findings-picker"
      role="group"
      aria-label="Signatures to list and scan"
      class="absolute left-3 right-3 top-full mt-1 z-20 flex flex-col max-h-96 rounded shadow-lg text-xs
             bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default"
    >
      <div
        class="flex items-center gap-1 p-2 border-b border-gh-border-default dark:border-gh-border-dark-default"
      >
        {#each PICKER_PRESETS as preset (preset.label)}
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-gh-border-default dark:border-gh-border-dark-default
                   hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
            on:click={() => applyPreset(preset)}
          >
            {preset.label}
          </button>
        {/each}
        <input
          type="search"
          class="input py-0.5 px-2 text-xs flex-1 min-w-0"
          placeholder="Filter signatures…"
          aria-label="Filter signatures"
          bind:value={filterText}
        />
      </div>
      <div class="overflow-auto py-1">
        {#each groups as group (group.name)}
          {@const ids = idsOf(group)}
          {@const state = groupCheckState(ids, pickedSet)}
          <label class="flex items-center gap-1.5 px-2 py-0.5 font-semibold">
            <input
              type="checkbox"
              data-group={group.name}
              checked={state === 'all'}
              use:mixed={state === 'some'}
              on:change={() => choose(toggleGroup(ids, picked))}
            />
            <span class="truncate">{group.name}</span>
            <span class="text-gh-fg-muted dark:text-gh-fg-dark-muted font-normal">{ids.length}</span
            >
          </label>
          {#each group.signatures as signature (signature.id)}
            <label class="flex items-center gap-1.5 pl-6 pr-2 py-0.5" title={signature.description}>
              <input
                type="checkbox"
                data-signature={signature.id}
                checked={pickedSet.has(signature.id)}
                on:change={() => choose(toggleSignature(signature.id, picked))}
              />
              <span class="truncate">{signature.name}</span>
              {#if !signature.default}
                <span data-opt-in class="badge badge-info">opt-in</span>
              {/if}
              {#if current.has(signature.id)}
                <span
                  data-current
                  class="text-gh-success-fg dark:text-gh-success-dark-fg"
                  title="Current for this file: scanned and not changed since"
                >
                  ✓<span class="sr-only"> current for this file</span>
                </span>
              {/if}
            </label>
          {/each}
        {:else}
          <p class="px-2 py-1 text-gh-fg-muted dark:text-gh-fg-dark-muted">No signature matches.</p>
        {/each}
      </div>
    </div>
  {/if}
</div>
