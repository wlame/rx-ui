<script lang="ts">
  /**
   * The label of a folder whose task over every file runs: `scanning
   * 12/214`, `indexing 3/40`, `indexing…` while the backend lists the
   * folder, `stopping…` after Stop. Nothing while no task runs. Its own
   * component, drawn on folder rows only, so only those hear the store a
   * running task updates about once a second.
   */
  import { folderTasks } from '$lib/stores/folderTasks';
  import { folderTaskLabel } from '$lib/utils/folderTaskText';

  /** The folder's path. */
  export let path: string;

  $: task = $folderTasks.get(path) ?? null;
</script>

{#if task}
  <span
    data-folder-task
    class="badge badge-warning text-[10px] py-0 tabular-nums flex-shrink-0"
    title="A task over every file of this folder runs; its menu has Stop"
  >
    {folderTaskLabel(task)}
  </span>
{/if}
