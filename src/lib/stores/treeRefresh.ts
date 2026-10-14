/**
 * The files list reads its open folders again by itself, every
 * `tree_refresh_seconds` of `/health` (`rx serve --tree-refresh`), while
 * the browser tab is visible, so a file created, deleted or grown under
 * the search root shows without a reload. This module is the one place
 * that times it: `startTreeRefresh` (the app's mount) starts it and gives
 * its stop; each round is `tree.refreshOpenFolders`.
 *
 * One round at a time: the next is timed once the last has ended. While
 * the tab is hidden no round starts and no timer is kept; when it is
 * shown again, a round that fell due meanwhile runs at once (by the
 * clock: a browser may run no timer of a hidden page), and one not yet
 * due waits out what is left of its wait. After a failed round the wait
 * doubles, up to `MAX_FAILED_WAIT_MS` (or the interval, when that is
 * longer); a round that succeeds brings it back to the interval. 0 turns
 * the refresh off.
 */
import { derived, type Readable } from 'svelte/store';
import { health, type HealthState } from './health';
import { tree } from './tree';

/** The longest wait after failed rounds, unless the interval itself is longer. */
export const MAX_FAILED_WAIT_MS = 60_000;

/** The longest interval `/health` may give, as rx-go bounds it: an hour. */
export const MAX_REFRESH_SECONDS = 3_600;

/** The wait before the next round after a failed one, given the wait before the failed one. */
export function waitAfterFailure(waitMs: number, intervalMs: number): number {
  return Math.min(waitMs * 2, Math.max(intervalMs, MAX_FAILED_WAIT_MS));
}

/**
 * The interval of the refresh in seconds, from a `/health` state:
 * `tree_refresh_seconds` when it is a whole number of 0 or more (at most
 * an hour), else 0, which turns the refresh off. A backend whose
 * contract is refused gets none: its requests wait at the gate. While
 * `/health` cannot be read, the `previous` interval holds: the backend
 * said nothing new.
 */
export function refreshSecondsOf(state: HealthState, previous: number): number {
  if (state.contract.kind === 'incompatible') return 0;
  if (state.data === null) return previous;
  const seconds: unknown = state.data.tree_refresh_seconds;
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0) return 0;
  return Math.min(seconds, MAX_REFRESH_SECONDS);
}

/** The page's visibility, as the timer reads it and hears it change. */
export interface PageVisibility {
  isHidden(): boolean;
  /** Call `listener` at each change; gives what stops it. */
  onChange(listener: () => void): () => void;
}

export interface RefreshTimerOptions {
  /** How often to refresh, in seconds; 0 refreshes never. */
  intervalSeconds: Readable<number>;
  /** One round; it rejects when it failed. */
  refresh: () => Promise<void>;
  page: PageVisibility;
}

/**
 * Run `refresh` every `intervalSeconds` while the page is visible, as the
 * module's description says. Gives the stop, which clears the timer and
 * every listener; a round on its way when it is called times no other.
 */
export function startRefreshTimer({
  intervalSeconds,
  refresh,
  page,
}: RefreshTimerOptions): () => void {
  let intervalMs = 0;
  let waitMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let isRoundRunning = false;
  // When the next round is due, by the clock (`Date.now()`); null while a
  // round runs, and while the refresh is off or stopped.
  let dueAt: number | null = null;
  let isStopped = false;

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /** Time the round due at `dueAt`: a timer while the page is visible, none while it is hidden. */
  function armTimer() {
    clearTimer();
    if (dueAt === null || page.isHidden()) return;
    timer = setTimeout(onTimer, Math.max(0, dueAt - Date.now()));
  }

  /** The next round is due `waitMs` from now; none while a round runs or the refresh is off. */
  function scheduleNext() {
    const isIdle = !isStopped && !isRoundRunning && intervalMs > 0;
    dueAt = isIdle ? Date.now() + waitMs : null;
    armTimer();
  }

  function onTimer() {
    timer = null;
    // A page hidden without a `visibilitychange` keeps the round due.
    if (!page.isHidden()) void runRound();
  }

  async function runRound() {
    clearTimer();
    dueAt = null;
    isRoundRunning = true;
    let hasFailed = false;
    try {
      await refresh();
    } catch (error) {
      hasFailed = true;
      console.warn('The files list could not be read again:', error);
    }
    isRoundRunning = false;
    waitMs = hasFailed ? waitAfterFailure(waitMs, intervalMs) : intervalMs;
    scheduleNext();
  }

  /** Hidden: drop the timer. Shown: run the round now when it is due, else wait what is left. */
  function onVisibilityChange() {
    if (page.isHidden()) clearTimer();
    else if (dueAt !== null && Date.now() >= dueAt) void runRound();
    else armTimer();
  }

  const stopListening = page.onChange(onVisibilityChange);
  const unsubscribe = intervalSeconds.subscribe((seconds) => {
    const nextMs = seconds * 1_000;
    if (nextMs === intervalMs) return;
    intervalMs = nextMs;
    waitMs = nextMs;
    scheduleNext();
  });

  return () => {
    isStopped = true;
    dueAt = null;
    clearTimer();
    unsubscribe();
    stopListening();
  };
}

/** The browser tab's visibility; a page without a document counts as visible. */
const documentVisibility: PageVisibility = {
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onChange: (listener) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

/** The interval `/health` gives, kept while `/health` cannot be read. */
function refreshInterval(): Readable<number> {
  let seconds = 0;
  return derived(health, ($health) => (seconds = refreshSecondsOf($health, seconds)));
}

/**
 * Start the files list's refresh, timed by `/health`'s
 * `tree_refresh_seconds`; gives its stop.
 */
export function startTreeRefresh(): () => void {
  return startRefreshTimer({
    intervalSeconds: refreshInterval(),
    refresh: () => tree.refreshOpenFolders(),
    page: documentVisibility,
  });
}
