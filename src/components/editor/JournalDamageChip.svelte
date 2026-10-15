<script lang="ts">
  /**
   * The editor header's warning for a systemd journal whose text leaves
   * entries out: how many damaged entries were left out and how many were
   * not reached. Its tooltip repeats that text, then gives the reason and
   * the first damaged entry. Nothing shows for a journal without damage, a
   * file that is not a journal, or a backend that knows no journals.
   *
   * The chip is the one part of the header that shrinks. On a narrow pane
   * its text is cut with an ellipsis, so the header's line readout stays
   * in view; the tooltip holds the whole text.
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
    class="badge badge-warning text-[10px] py-0 tabular-nums min-w-0"
    title={chip.title}
  >
    <!-- The badge is a flex box, which draws no ellipsis on its own text. -->
    <span class="truncate">{chip.text}</span>
  </span>
{/if}
