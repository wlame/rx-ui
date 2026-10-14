import { describe, expect, it } from 'vitest';
import { settleInPool } from './settleInPool';

/** A run that waits until the test ends it, counting how many run at once. */
function heldRuns() {
  const ends = new Map<number, (fail: boolean) => void>();
  let running = 0;
  let mostAtOnce = 0;
  const run = (item: number) =>
    new Promise<number>((resolve, reject) => {
      running++;
      mostAtOnce = Math.max(mostAtOnce, running);
      ends.set(item, (fail) => {
        running--;
        if (fail) reject(new Error(`item ${item} failed`));
        else resolve(item * 10);
      });
    });
  return { run, ends, mostAtOnce: () => mostAtOnce };
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('settleInPool', () => {
  it('runs at most `limit` items at once, and the next as soon as a slot frees', async () => {
    const { run, ends, mostAtOnce } = heldRuns();

    const all = settleInPool([1, 2, 3, 4, 5, 6], 4, run);
    await settled();
    expect([...ends.keys()]).toEqual([1, 2, 3, 4]);

    ends.get(2)?.(false);
    await settled();
    expect([...ends.keys()]).toEqual([1, 2, 3, 4, 5]);

    for (const item of [1, 3, 4, 5]) ends.get(item)?.(false);
    await settled();
    ends.get(6)?.(false);
    await all;
    expect(mostAtOnce()).toBe(4);
  });

  it('settles every item in the order given, a failure as a rejection', async () => {
    const { run, ends } = heldRuns();

    const all = settleInPool([1, 2, 3], 2, run);
    await settled();
    ends.get(2)?.(true);
    ends.get(1)?.(false);
    await settled();
    ends.get(3)?.(false);

    expect(await all).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'rejected', reason: new Error('item 2 failed') },
      { status: 'fulfilled', value: 30 },
    ]);
  });

  it('settles an empty list at once', async () => {
    expect(await settleInPool([], 4, async () => 1)).toEqual([]);
  });
});
