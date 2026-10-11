<script lang="ts">
  /**
   * The yellow label of a file the findings cache answers for: its
   * findings count, filled when every default signature scanned the file
   * and an outline when only some did, with a tooltip that says so
   * (`utils/findingsLabel.ts`). Its own component, drawn only for a file
   * with a label, so only those rows hear the findings store and the
   * catalogue, which a running scan updates about once a second.
   */
  import { findingsByFile, findingsOf } from '$lib/stores/findings';
  import { defaultSetIds, signatures } from '$lib/stores/signatures';
  import { findingsLabelTitle, type FindingsLabel } from '$lib/utils/findingsLabel';
  import { formatNumber } from '$lib/utils/format';

  export let findings: FindingsLabel;
  /** The file's path, whose summary in the findings store the tooltip reads. */
  export let path: string | null = null;

  /** How each state of the label looks; both keep a border, so they are one height. */
  const CLASSES: Record<FindingsLabel['state'], string> = {
    full: 'badge-warning border border-transparent',
    partial:
      'border border-gh-attention-emphasis dark:border-gh-attention-dark-emphasis ' +
      'text-gh-attention-fg dark:text-gh-attention-dark-fg',
  };

  $: title = findingsLabelTitle(
    findings,
    path === null ? null : findingsOf($findingsByFile, path).fileSummary,
    defaultSetIds($signatures).length,
  );
</script>

<span
  data-findings-label={findings.state}
  class="badge text-[10px] py-0 tabular-nums {CLASSES[findings.state]}"
  {title}
>
  {formatNumber(findings.count)}
</span>
