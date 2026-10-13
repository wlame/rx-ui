<!--
  The right-hand end of a header of the findings group view: Copy, then the
  eye. Each has a slot of one fixed width, drawn even when the header has
  none of it, so the Copy buttons of all headers stand in one column, the
  eyes in the column after it, and a long name truncates before them.

  The default slot holds Copy; the eye is drawn here. Everything inside is
  `data-header-actions`: no Tab stop, a key that a control in it focuses is
  its own, and a click in it never reaches the row.
-->
<script lang="ts">
  import type { SignatureInfo } from '$lib/types';
  import type { HeaderRow } from '$lib/utils/findingRows';
  import FindingsEye from './FindingsEye.svelte';

  export let header: HeaderRow;
  /** The catalogue's signatures, by id. */
  export let signatureOf: ReadonlyMap<string, SignatureInfo>;
  /** Hide or show the findings of a header, as a click on its eye does. */
  export let toggleShown: (header: HeaderRow) => void;

  /** Wide enough for an icon button; the same for both slots. */
  const SLOT_CLASS = 'w-5 flex-shrink-0 flex items-center justify-center';

  /** Whose findings the header holds, as its eye names them. */
  function subjectOf(row: HeaderRow): string {
    if (row.kind === 'group') return `the group ${row.group}`;
    return signatureOf.get(row.id)?.name ?? row.id;
  }
</script>

<span class="ml-auto flex-shrink-0 flex items-center" data-header-actions>
  <span class={SLOT_CLASS} data-header-slot="copy"><slot /></span>
  <span class={SLOT_CLASS} data-header-slot="eye">
    {#if header.eye !== null}
      <FindingsEye
        state={header.eye}
        subject={subjectOf(header)}
        toggle={() => toggleShown(header)}
      />
    {/if}
  </span>
</span>
