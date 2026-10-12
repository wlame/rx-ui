<script lang="ts">
  /**
   * The status bar's equivalent command: the `rx` command line that gives
   * the last answer, with a copy button (the copy icon), and a toggle for
   * the panel of recent commands. Every command is the backend's `cli_command`. An
   * answer given piece by piece (a log chain's lines from several parts)
   * has the commands of its pieces under it, in the panel; a button says
   * how many and opens it.
   */
  import { tooltip } from '$lib/actions/tooltip';
  import { notifications } from '$lib/stores';
  import { commandLog, lastCommand } from '$lib/stores/commands';
  import { copyText } from '$lib/utils/clipboard';
  import Icon from '../common/Icon.svelte';
  import CommandHistory from './CommandHistory.svelte';

  const COPY_LABEL = 'Copy the equivalent command';

  let isHistoryShown = false;

  async function copy(command: string) {
    if (await copyText(command)) {
      notifications.success('Command copied', 1500);
    } else {
      notifications.error('Could not copy. Select the command and copy it by hand.', 4000);
    }
  }
</script>

{#if $lastCommand}
  {@const command = $lastCommand.command}
  <div class="flex items-center gap-2 min-w-0 flex-1 justify-center">
    <span class="shrink-0" title="The rx command that gives the last answer">Equivalent:</span>
    <code
      class="truncate font-mono select-all text-gh-fg-default dark:text-gh-fg-dark-default"
      title={command}>{command}</code
    >
    <button
      type="button"
      class="shrink-0 hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg"
      aria-label={COPY_LABEL}
      use:tooltip={{ label: COPY_LABEL }}
      on:click={() => copy(command)}
    >
      <Icon name="copy" size={12} />
    </button>
    {#if $lastCommand.details && $lastCommand.details.length > 0}
      <button
        type="button"
        class="shrink-0 hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg"
        title={$lastCommand.details.join('\n')}
        aria-expanded={isHistoryShown}
        aria-controls="command-history"
        on:click={() => (isHistoryShown = true)}
      >
        Per part ({$lastCommand.details.length})
      </button>
    {/if}
    <button
      type="button"
      class="shrink-0 hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg"
      aria-expanded={isHistoryShown}
      aria-controls="command-history"
      on:click={() => (isHistoryShown = !isHistoryShown)}
    >
      Recent ({$commandLog.length})
    </button>
  </div>
{/if}

{#if isHistoryShown}
  <CommandHistory
    entries={$commandLog}
    on:copy={(e) => copy(e.detail)}
    on:close={() => (isHistoryShown = false)}
  />
{/if}
