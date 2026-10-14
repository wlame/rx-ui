import { derived, writable } from 'svelte/store';

/**
 * The `rx` commands that give the answers the user asked for, newest
 * first: the equivalent command line of what they did in the viewer.
 *
 * Every command comes from the backend's `cli_command`, and an answer
 * without one adds nothing, with one exception: a copy of findings
 * records the `rx trace` command `findingsCopy.ts` writes, since the
 * backend's command of a findings answer names the picker's selection,
 * not the group or signature a header narrows it to. Only answers to a
 * user's action are recorded (a search, a file opened, a jump, a copy of
 * selected lines or of findings, an index, a findings scan, a task over
 * a folder, each from the answer that starts it), not the pages loaded
 * while scrolling.
 */

/** What the user did that the command answers. */
export type CommandAction = 'search' | 'file' | 'index' | 'findings';

export interface CommandEntry {
  command: string;
  action: CommandAction;
  /**
   * Commands that give the same answer piece by piece: for the lines of a
   * log chain, the `rx samples PART --lines=A-B` of each part they come
   * from. Absent for an answer of one command.
   */
  details?: readonly string[];
  /** When the answer arrived, in milliseconds since the epoch. */
  at: number;
}

/** How many commands the recent list keeps. */
export const RECENT_COMMANDS_LIMIT = 20;

function createCommandLog() {
  const { subscribe, set, update } = writable<CommandEntry[]>([]);

  /**
   * Add the command of an answer, with the commands of its pieces; a
   * repeated command moves to the top.
   */
  function record(
    command: string | null | undefined,
    action: CommandAction,
    details: readonly string[] = [],
  ) {
    if (!command || command.trim() === '') return;
    update((entries) =>
      [
        { command, action, ...(details.length > 0 ? { details } : {}), at: Date.now() },
        ...entries.filter((entry) => entry.command !== command),
      ].slice(0, RECENT_COMMANDS_LIMIT),
    );
  }

  function clear() {
    set([]);
  }

  return { subscribe, record, clear };
}

export const commandLog = createCommandLog();

/** The command of the last answer, or null before the first one. */
export const lastCommand = derived(commandLog, (entries) => entries[0] ?? null);
