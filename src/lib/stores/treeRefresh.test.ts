import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { TreeDirBackend, serveTreeDir } from '../testing/fakeTreeDir';
import type { HealthResponse } from '../types';
import { health, type HealthState } from './health';
import { tree } from './tree';
import {
  MAX_FAILED_WAIT_MS,
  refreshSecondsOf,
  startRefreshTimer,
  startTreeRefresh,
  waitAfterFailure,
  type PageVisibility,
} from './treeRefresh';

/** A page whose visibility the test sets; the timer hears each change. */
class FakePage implements PageVisibility {
  private hidden = false;
  private readonly listeners = new Set<() => void>();

  isHidden(): boolean {
    return this.hidden;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

const stops: (() => void)[] = [];

/**
 * The timer over a refresh the test counts, every `seconds`; the test may
 * change the interval, and make the rounds fail with `rounds.isFailing`.
 */
function start(seconds: number) {
  const interval = writable(seconds);
  const page = new FakePage();
  const startedAt = Date.now();
  const rounds = { isFailing: false };
  /** When each round started, in ms from the start. */
  const roundsAt: number[] = [];
  const refresh = vi.fn(async () => {
    roundsAt.push(Date.now() - startedAt);
    if (rounds.isFailing) throw new Error('the backend is down');
  });
  const stop = startRefreshTimer({ intervalSeconds: interval, refresh, page });
  stops.push(stop);
  return { interval, page, refresh, rounds, roundsAt, stop };
}

/** The waits between rounds that started at `roundsAt`. */
function waitsBetween(roundsAt: number[]): number[] {
  return roundsAt.slice(1).map((at, i) => at - roundsAt[i]);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the files list refresh timer', () => {
  it('refreshes every N seconds while the tab is visible', async () => {
    const { refresh } = start(5);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('makes no request with N = 0', async () => {
    const { refresh } = start(0);

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('makes no request while the tab is hidden, and one when it is shown again after a period', async () => {
    const { page, refresh, roundsAt } = start(5);
    page.setHidden(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();

    page.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(roundsAt).toEqual([60_000]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(roundsAt).toEqual([60_000, 65_000]);
  });

  it('waits out the period when the tab is shown again before it passed', async () => {
    const { page, roundsAt } = start(5);
    await vi.advanceTimersByTimeAsync(2_000);
    page.setHidden(true);
    await vi.advanceTimersByTimeAsync(1_000);

    page.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(roundsAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(roundsAt).toEqual([5_000]);
  });

  it('waits twice as long after each failed round, at most 60 s, and N again after a success', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rounds, roundsAt } = start(5);
    rounds.isFailing = true;

    // Five failed rounds; the sixth, due at 195 s, succeeds.
    await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 40_000 + 60_000 + 60_000 - 1);
    rounds.isFailing = false;
    await vi.advanceTimersByTimeAsync(1 + 5_000);

    expect(waitsBetween(roundsAt)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 5_000]);
  });

  it('starts no round while one runs, and times the next from its end', async () => {
    const { refresh } = start(5);
    let endRound = () => {};
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => (endRound = resolve)));

    await vi.advanceTimersByTimeAsync(5_000 + 30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    endRound();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('starts no round while one runs when /health changes the interval meanwhile', async () => {
    const { interval, refresh } = start(5);
    let endRound = () => {};
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => (endRound = resolve)));
    await vi.advanceTimersByTimeAsync(5_000);

    interval.set(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    endRound();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('starts when /health turns it on and stops when it turns it off', async () => {
    const { interval, refresh } = start(0);

    interval.set(5);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    interval.set(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('clears its timer and its listener when stopped', async () => {
    const { page, refresh, stop } = start(5);

    stop();
    page.setHidden(true);
    page.setHidden(false);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(page.listenerCount).toBe(0);
  });
});

describe('waitAfterFailure', () => {
  it.each([
    ['doubles the interval', 5_000, 5_000, 10_000],
    ['doubles the last wait', 20_000, 5_000, 40_000],
    ['stops at the longest wait', 40_000, 5_000, MAX_FAILED_WAIT_MS],
    ['stays at the longest wait', MAX_FAILED_WAIT_MS, 5_000, MAX_FAILED_WAIT_MS],
    ['never waits less than an interval above the longest wait', 120_000, 120_000, 120_000],
  ])('%s', (_name, waitMs, intervalMs, expected) => {
    expect(waitAfterFailure(waitMs, intervalMs)).toBe(expected);
  });
});

describe('refreshSecondsOf', () => {
  function answered(fields: Partial<HealthResponse>, kind: 'ok' | 'incompatible' = 'ok') {
    return {
      connected: true,
      loading: false,
      error: null,
      data: { contract_version: '2.0', ...fields } as HealthResponse,
      contract:
        kind === 'ok'
          ? { kind: 'ok', major: 2, minor: 0 }
          : { kind: 'incompatible', major: 1, minor: 7, message: 'refused' },
      features: [],
    } satisfies HealthState;
  }
  const failed: HealthState = {
    connected: false,
    loading: false,
    error: 'Failed to fetch',
    data: null,
    contract: { kind: 'unknown' },
    features: [],
  };

  it.each([
    ['the seconds /health gives', answered({ tree_refresh_seconds: 7 }), 5, 7],
    ['0 from /health', answered({ tree_refresh_seconds: 0 }), 5, 0],
    ['no value', answered({}), 5, 0],
    ['a value that is not a number', answered({ tree_refresh_seconds: '5' as never }), 5, 0],
    ['a negative value', answered({ tree_refresh_seconds: -1 }), 5, 0],
    ['a fraction', answered({ tree_refresh_seconds: 2.5 }), 5, 0],
    ['a value above an hour', answered({ tree_refresh_seconds: 7_200 }), 5, 3_600],
    ['a refused contract', answered({ tree_refresh_seconds: 7 }, 'incompatible'), 5, 0],
    ['a /health that could not be read', failed, 5, 5],
  ])('reads %s', (_name, state, previous, expected) => {
    expect(refreshSecondsOf(state, previous)).toBe(expected);
  });
});

describe('startTreeRefresh', () => {
  it('reads every open folder again each tree_refresh_seconds of /health, one request each', async () => {
    const backend = new TreeDirBackend(['/logs'], { treeRefreshSeconds: 5 });
    backend.add('/logs/app', 'directory');
    backend.add('/logs/app/a.log', 'file');
    backend.add('/logs/closed', 'directory');
    serveTreeDir(backend);
    await health.check();
    await tree.loadRoots();
    await tree.expand('/logs/app');
    const asked = backend.listingsAsked().length;

    stops.push(startTreeRefresh());
    await vi.advanceTimersByTimeAsync(5_000);

    expect(backend.listingsAsked().slice(asked).sort()).toEqual(['/logs', '/logs/app']);
  });
});
