import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Test-only teardown support: wait for the app's database reads to finish
 * before a test environment is torn down.
 *
 * Why this is needed
 * ------------------
 * The screens start their loads without awaiting them (`void loadDay(...)`), so
 * the last interaction in a test can leave a read running after the test body
 * returns. When the environment goes away underneath those reads, Dexie reports
 * it in one of two ways, both intermittent:
 *
 *  - `DatabaseClosedError: Database has been closed` when the database is
 *    deleted while a read is still using it.
 *  - `ReferenceError: dispatchEvent is not defined` when a read *re-opens* a
 *    database whose `on('ready')` handler fires Dexie's global "storage
 *    mutated" event. Dexie's module decides at import time whether `dispatchEvent`
 *    exists, and if Dexie was first loaded under the `node` environment the
 *    answer is "no", so firing that event throws — after the test has finished.
 *
 * Both are teardown races, not assertion failures: every assertion in the suite
 * passes either way. The fix is to establish real quiescence instead of hoping a
 * fixed delay is long enough.
 *
 * How it works
 * ------------
 * `trackDatabaseReads` wraps the read functions the screens call, keeping a
 * counter of how many are in flight. `settleDatabaseReads` then waits for that
 * counter to reach zero. It is not an arbitrary delay: each pass yields one
 * macrotask (Dexie resolves its promise zones on a macrotask, so a read is only
 * "done" once its handlers have run and any follow-up read has been issued) and
 * the wait ends as soon as the counter is zero.
 */

let readsInFlight = 0;

/**
 * Wrap the given read functions so they can be counted.
 *
 * `vi.spyOn` is used because a module namespace's properties are getter-only,
 * and the original is captured first because after spying the property *is* the
 * spy. Call `settleDatabaseReads` before `vi.restoreAllMocks()`, or the counter
 * stops being updated.
 */
export function trackDatabaseReads(
  target: object,
  names: readonly string[],
): void {
  for (const name of names) {
    const holder = target as Record<string, unknown>;
    const real = holder[name] as (...args: never[]) => Promise<unknown>;

    vi.spyOn(holder as never, name as never).mockImplementation((async (
      ...args: never[]
    ) => {
      readsInFlight += 1;
      try {
        return await real.apply(holder, args);
      } finally {
        readsInFlight -= 1;
      }
    }) as never);
  }
}

/** How many tracked reads are currently in flight. */
export function readsPending(): number {
  return readsInFlight;
}

/**
 * Resolve once no tracked read is in flight.
 *
 * The `act` wrapper flushes the React state updates a finishing read triggers,
 * so the drain doubles as the correct flush instead of leaving un-acted updates
 * to warn about.
 */
export async function settleDatabaseReads(): Promise<void> {
  const tick = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  for (;;) {
    await tick();
    if (readsInFlight !== 0) continue;

    // A read is decremented when its own promise settles, which is *before* the
    // screen's `.then(setState)` continuation runs. One more idle tick lets
    // those continuations run, inside `act`, so their updates are flushed rather
    // than reported as un-acted.
    await tick();
    if (readsInFlight === 0) return;
  }
}
