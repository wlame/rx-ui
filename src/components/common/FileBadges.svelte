<script lang="ts">
  /**
   * The labels of a file, in the files panel and the editor header: its
   * compression (`journal` for a systemd journal), its line index
   * (`idx`), an index build followed in the background (`indexing N%`),
   * and what the findings cache holds for it, a yellow label with its
   * findings count, filled when every default signature scanned the file
   * and an outline when only some did.
   */
  import { indexingLabel } from '$lib/samplesWait';
  import type { IndexBuild } from '$lib/types';
  import type { FindingsLabel } from '$lib/utils/findingsLabel';
  import FindingsBadge from './FindingsBadge.svelte';

  /** The tooltip of a format whose badge says more than "Compressed file". */
  const FORMAT_TITLES: Readonly<Record<string, string>> = { journal: 'systemd journal' };

  export let isCompressed: boolean | null = null;
  export let compressionFormat: string | null = null;
  export let isIndexed: boolean | null = null;
  /** The line index build followed in the background, shown as `indexing N%`. */
  export let indexBuild: IndexBuild | null = null;
  /** What the findings cache holds for the file: full or partial, and the findings count; null for none. */
  export let findings: FindingsLabel | null = null;
  /** The file's path, whose summary in the findings store the label's tooltip reads. */
  export let path: string | null = null;
</script>

<span class="flex items-center gap-1 flex-shrink-0">
  {#if isCompressed && compressionFormat}
    <span
      class="badge badge-info text-[10px] py-0"
      title={FORMAT_TITLES[compressionFormat] ?? `Compressed file: ${compressionFormat}`}
    >
      {compressionFormat}
    </span>
  {/if}
  {#if isIndexed}
    <span class="badge badge-success text-[10px] py-0" title="Indexed"> idx </span>
  {/if}
  {#if indexBuild}
    <span
      data-indexing
      class="badge badge-warning text-[10px] py-0 tabular-nums"
      title="The line index is being built; jumps by time wait for it"
    >
      {indexingLabel(indexBuild)}
    </span>
  {/if}
  {#if findings}
    <FindingsBadge {findings} {path} />
  {/if}
</span>
