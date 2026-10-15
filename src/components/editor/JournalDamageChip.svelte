<script lang="ts">
  /**
   * The editor header's warning for a systemd journal whose text leaves
   * entries out: how many damaged entries were left out and how many were
   * not reached, with the reason and the first damaged entry in its
   * tooltip. Nothing shows for a journal without damage, a file that is
   * not a journal, or a backend that knows no journals.
   */
  import type { JournalInfo } from '$lib/types';
  import { journalDamageChip } from '$lib/utils/journalDamage';

  /** The `journal` section of the open file's index. */
  export let journal: JournalInfo | undefined;

  $: chip = journalDamageChip(journal);
</script>

{#if chip}
  <span
    data-journal-damage
    class="badge badge-warning text-[10px] py-0 tabular-nums flex-shrink-0"
    title={chip.title}
  >
    {chip.text}
  </span>
{/if}
