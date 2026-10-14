<script lang="ts">
  /**
   * The question before a task over every file of a folder, "Scan every
   * file under logs/?", with what the task will do and the folder's
   * path. Drawn by the app over every panel: a folder's menu item names
   * the task in the store (`askFolderTask`), so no panel switch, Back or
   * Forward hides a dialog that counts as open. The focus starts on the
   * button that starts the task (Index or Scan); Cancel, Esc and a click
   * beside the dialog close it and start nothing.
   */
  import { modal } from '$lib/actions/modal';
  import { takeFocus } from '$lib/actions/takeFocus';
  import {
    closeFolderTaskRequest,
    folderTaskRequest,
    startFolderTask,
  } from '$lib/stores/folderTasks';
  import {
    folderTaskDescription,
    folderTaskQuestion,
    folderTaskVerb,
  } from '$lib/utils/folderTaskText';
  import { isShortcut } from '$lib/utils/shortcuts';

  function confirm() {
    const request = $folderTaskRequest;
    if (!request) return;
    closeFolderTaskRequest();
    void startFolderTask(request.path, request.kind);
  }

  /** Esc closes the dialog, unless a dialog over it (the shortcut list) already acted on it. */
  function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || !isShortcut('closeDialog', event)) return;
    event.preventDefault();
    closeFolderTaskRequest();
  }
</script>

{#if $folderTaskRequest}
  {@const request = $folderTaskRequest}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="-1"
    aria-label="Close dialog"
    on:click={closeFolderTaskRequest}
    on:keydown={handleKeydown}
  >
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default
             rounded-lg shadow-lg p-6 max-w-md w-full space-y-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-task-title"
      aria-describedby="folder-task-help"
      use:modal
      on:click|stopPropagation
      on:keydown={handleKeydown}
    >
      <h2 id="folder-task-title" class="text-lg font-semibold">
        {folderTaskQuestion(request.kind, request.path)}
      </h2>
      <p id="folder-task-help" class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
        {folderTaskDescription(request.kind, request.signatureCount)} The folder's row shows how far it
        is, and its menu has Stop.
      </p>
      <p class="text-xs font-mono break-all">{request.path}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary" on:click={closeFolderTaskRequest}
          >Cancel</button
        >
        <button type="button" class="btn btn-primary" use:takeFocus on:click={confirm}>
          {folderTaskVerb(request.kind)}
        </button>
      </div>
    </div>
  </div>
{/if}
