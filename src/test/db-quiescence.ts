import { act } from '@testing-library/react';

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
 * Wrappers already installed, so a repeated `trackDatabaseReads` call cannot
 * stack a second wrapper on top of the first and double-count reads.
 */
const WRAPPED = new WeakSet<(...args: never[]) => Promise<unknown>>();

/**
 * Wrap the given read functions so they can be counted.
 *
 * The wrappers are plain functions installed with `Object.defineProperty`, not
 * `vi.spyOn` mocks. That matters because a spy is registered in Vitest's mock
 * restoration registry, and `vi.restoreAllMocks()` both reverts the spy and
 * clears the registry. Since tracking is installed once at module load but
 * `restoreAllMocks()` runs in every `afterEach`, a spy-based tracker is
 * disarmed permanently after the first test: `settleDatabaseReads` then reads a
 * counter that never moves while real reads are still in flight, and the next
 * test's `db.delete()` closes the database underneath them.
 *
 * Assignment (`holder[name] = wrapper`) is not an option: ES module namespace
 * exports are getter-only, so it throws in strict mode. `defineProperty` works
 * because namespace properties are configurable.
 */
export function trackDatabaseReads(
  target: object,
  names: readonly string[],
): void {
  const holder = target as unknown as Record<string, (...args: never[]) => Promise<unknown>>;

  for (const name of names) {
    const current = holder[name];
    if (typeof current !== 'function') {
      throw new TypeError(`trackDatabaseReads: ${name} is not a function`);
    }

    /*
     * Never wrap twice. Without this guard a second tracking call would build a
     * wrapper around the first, double-counting every read.
     */
    if (WRAPPED.has(current)) continue;
    const real = current;

    const wrapper = async (...args: never[]): Promise<unknown> => {
      readsInFlight += 1;
      try {
        return await real.apply(holder, args);
      } finally {
        readsInFlight -= 1;
      }
    };

    // Tagged so the guard above can recognise it, and so nothing treats the
    // wrapper as a mock.
    WRAPPED.add(wrapper);

    Object.defineProperty(holder, name, {
      value: wrapper,
      configurable: true,
      writable: true,
      enumerable: true,
    });
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
