<!--
  A modal dialog for the tests of the keys that leave the keyboard to an
  open dialog: drawn while open, counted by `use:modal`, and closed by its
  Close button or by an Esc nothing else acted on, as a dialog of the
  viewer is.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { modal } from '$lib/actions/modal';

  const dispatch = createEventDispatcher<{ close: void }>();

  let isOpen = true;

  function close() {
    isOpen = false;
    dispatch('close');
  }

  /** An Esc another dialog over this one already acted on is that one's. */
  function handleKeydown(event: KeyboardEvent) {
    if (isOpen && !event.defaultPrevented && event.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div role="dialog" aria-modal="true" aria-label="A dialog" use:modal>
    <button type="button" aria-label="Close" on:click={close}>Close</button>
  </div>
{/if}
