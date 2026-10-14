/**
 * Run `run` over every item of `items`, at most `limit` at once, and
 * settle each as `Promise.allSettled` does, in the order of `items`. A
 * slot that frees takes the next item at once, so a slow item holds only
 * its own slot. Used where many requests of one kind would otherwise take
 * every connection the browser keeps to the backend.
 */
export async function settleInPool<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  // Each slot takes the next item until none is left.
  async function slot(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await run(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  const slots = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: slots }, slot));
  return results;
}
