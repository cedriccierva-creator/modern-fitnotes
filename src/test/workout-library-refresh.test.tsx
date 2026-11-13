// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WorkoutScreen from '../screens/WorkoutScreen';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import * as workoutData from '../db/workout';
import * as exercisesData from '../db/exercises';
import * as recordsData from '../db/personalRecords';
import { computeExercisePr } from '../lib/pr';
import type { ExercisePR } from '../lib/pr';
import { newId } from '../lib/id';

/**
 * Optimization 6: the exercise library is refreshed on its own.
 *
 * A set write, a session rename or a day load cannot change the `exercises`
 * table, so those paths must not re-read it. Only adoption, creation, renaming
 * and deleting a library row can -- and those still must, immediately.
 *
 * The three reads the screen issues are counted with the same
 * `Object.defineProperty` wrapper technique as `db-quiescence.ts`: the wrapper is
 * installed on the module namespace, which the screen resolves through its live
 * binding, so every count below is a real call against IndexedDB. `vi.mock` is
 * deliberately not used here -- a module factory re-evaluates the data layer in
 * its own registry, so the wrapped functions can end up closing over a second
 * `FitNotesDB` instance and the counts would describe the wrong database.
 *
 * Every assertion is an exact call count. Nothing here measures milliseconds.
 */

const reads = { day: 0, records: 0, library: 0 };
/** Reads still in flight, so teardown can wait for them (see `settle`). */
let inFlight = 0;

/**
 * One-shot intercepts used by the stale-result tests.
 *
 * `recordsIntercept` answers the *next* records read with a value of its own
 * after a gate opens. `dayGate` holds the day read with the given 1-based call
 * number until it is released.
 */
let recordsIntercept: { gate: Promise<void>; value: ReadonlyMap<string, ExercisePR> } | null =
  null;
let dayGate: { call: number; gate: Promise<void> } | null = null;

function replaceExport(holder: object, name: string, value: unknown): void {
  Object.defineProperty(holder, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

function installCounters(): void {
  const realLoadDay = workoutData.loadDay;
  replaceExport(workoutData, 'loadDay', async (date: string) => {
    reads.day += 1;
    const gate = dayGate !== null && reads.day === dayGate.call ? dayGate.gate : null;
    inFlight += 1;
    try {
      if (gate !== null) await gate;
      return await realLoadDay(date);
    } finally {
      inFlight -= 1;
    }
  });

  const realLoadExercises = exercisesData.loadExercises;
  replaceExport(exercisesData, 'loadExercises', async () => {
    reads.library += 1;
    inFlight += 1;
    try {
      return await realLoadExercises();
    } finally {
      inFlight -= 1;
    }
  });

  const realGetPRsForExercises = recordsData.getPRsForExercises;
  replaceExport(recordsData, 'getPRsForExercises', async (exerciseIds: readonly string[]) => {
    reads.records += 1;
    inFlight += 1;
    try {
      if (recordsIntercept !== null) {
        const intercept = recordsIntercept;
        recordsIntercept = null;
        await intercept.gate;
        return intercept.value;
      }
      return await realGetPRsForExercises(exerciseIds);
    } finally {
      inFlight -= 1;
    }
  });
}

installCounters();

/** Resolve once no counted read is in flight, flushing React inside `act`. */
async function settle(): Promise<void> {
  const tick = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  for (;;) {
    await tick();
    if (inFlight !== 0) continue;
    await tick();
    if (inFlight === 0) return;
  }
}

beforeEach(async () => {
  reads.day = 0;
  reads.records = 0;
  reads.library = 0;
  inFlight = 0;
  recordsIntercept = null;
  dayGate = null;
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  recordsIntercept = null;
  dayGate = null;
  // Drain before closing the database, so no read resolves against a deleted one.
  await settle();
  cleanup();
  await db.delete();
});

const DATE = '2026-11-10';
const OTHER_DATE = '2026-11-11';

/**
 * A day holding one exercise with exactly the given sets.
 *
 * `addExerciseToDay` is used first so the day row, the session row and the
 * denormalised `workoutDayId` all come from the real write path; only the
 * generated set rows are replaced, to keep each test's history explicit.
 */
async function seedDay(
  rows: readonly { weightKg: number | null; completed: boolean }[],
): Promise<{ exerciseId: string }> {
  const exercise = await createExercise('Back squat', 'legs');
  const session = await workoutData.addExerciseToDay(DATE, exercise, 'universal');

  await db.workoutSets.where('workoutExerciseId').equals(session.id).delete();
  await db.workoutSets.bulkAdd(
    rows.map((row, index) => ({
      id: newId(),
      workoutExerciseId: session.id,
      workoutDayId: session.workoutDayId,
      setNumber: index + 1,
      weightKg: row.weightKg,
      reps: 5,
      completed: row.completed,
      createdAt: index,
      updatedAt: index,
    })),
  );

  return { exerciseId: exercise.id };
}

/** A PR value built by the real engine, so no PR arithmetic lives in this file. */
function prOf(exerciseId: string, weightKg: number): ExercisePR {
  return computeExercisePr(exerciseId, [
    {
      setId: 'stale-set',
      workoutExerciseId: 'stale-session',
      workoutDayId: 'stale-day',
      exerciseId,
      exerciseName: 'Back squat',
      date: DATE,
      exerciseOrder: 0,
      setNumber: 1,
      weightKg,
      reps: 5,
      completed: true,
      createdAt: 0,
    },
  ]);
}

async function renderWorkout(date = DATE) {
  const view = render(<WorkoutScreen date={date} onBack={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Search exercises')).toBeTruthy());
  return view;
}

/** Wait for the day's set rows to be on screen. */
async function waitForSets(count: number): Promise<void> {
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(count));
}

const completeButton = (setNumber: number): HTMLElement =>
  screen.getByLabelText(`Set ${setNumber} complete`);

const weightInput = (setNumber: number): HTMLInputElement =>
  screen.getByLabelText(`Weight for set ${setNumber}`) as HTMLInputElement;

/** Point the picker at one catalog entry. */
function searchCatalog(term: string): void {
  fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: term } });
}

describe('mount', () => {
  it('loads the day, the records and the library once each', async () => {
    await seedDay([{ weightKg: 100, completed: true }]);

    await renderWorkout();
    await waitForSets(1);

    expect(reads.day).toBe(1);
    expect(reads.records).toBe(1);
    expect(reads.library).toBe(1);

    // The day's record is on screen, so those counts describe a render that
    // happened rather than reads still in flight.
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
  });
});

describe('set writes do not touch the library', () => {
  it('refreshes the day and the records on a weight commit, and never the library', async () => {
    await seedDay([{ weightKg: null, completed: false }]);
    await renderWorkout();
    await waitForSets(1);

    const user = userEvent.setup();
    await user.type(weightInput(1), '100');
    await user.tab();

    await waitFor(() => expect(reads.day).toBe(2));
    await waitFor(() => expect(reads.records).toBe(2));
    await waitFor(() => expect(weightInput(1).value).toBe('100'));

    // The whole point of Optimization 6.
    expect(reads.library).toBe(1);
    expect(await db.exercises.count()).toBe(1);
  });

  it('refreshes the day and the records on a completion toggle, and never the library', async () => {
    await seedDay([{ weightKg: 100, completed: false }]);
    await renderWorkout();
    await waitForSets(1);

    fireEvent.click(completeButton(1));

    await waitFor(() => expect(completeButton(1).getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(reads.day).toBe(2));
    await waitFor(() => expect(reads.records).toBe(2));

    expect(reads.library).toBe(1);
  });
});

describe('library changes still refresh the library', () => {
  it('refreshes the library on adoption and shows "In library" immediately', async () => {
    await renderWorkout();

    searchCatalog('goblet squat');
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));

    await waitFor(() => expect(reads.library).toBe(2));
    await waitFor(() =>
      expect(screen.getByLabelText('Goblet squat is in your library')).toBeTruthy(),
    );

    // Adoption writes `exercises` only, so the day was not re-read for it.
    expect(reads.day).toBe(1);
    expect(reads.records).toBe(1);
    expect(await db.exercises.count()).toBe(1);
  });

  it('shows a newly created exercise in the Library list', async () => {
    await renderWorkout();

    fireEvent.change(screen.getByLabelText('New exercise name'), {
      target: { value: 'Sled drag custom' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // Creating attaches it to today (day refresh) and adds a library row.
    await waitFor(() => expect(reads.day).toBe(2));
    await waitFor(() => expect(reads.library).toBe(2));
    await waitFor(() => expect(screen.getByLabelText('Rename Sled drag custom')).toBeTruthy());

    expect(await db.exercises.count()).toBe(1);
    expect(await db.workoutExercises.count()).toBe(1);
  });

  it('does not reload the library when a catalog entry is logged without adopting it', async () => {
    await renderWorkout();

    searchCatalog('goblet squat');
    fireEvent.click(screen.getByLabelText('Add Goblet squat to today'));

    await waitFor(() => expect(reads.day).toBe(2));
    await waitFor(() => expect(reads.records).toBe(2));

    // The two picker actions stay separate: logging is not adopting.
    expect(reads.library).toBe(1);
    expect(await db.exercises.count()).toBe(0);
    expect(await db.workoutExercises.count()).toBe(1);
  });
});

describe('date changes', () => {
  it('reloads both the day and the library', async () => {
    await seedDay([{ weightKg: 100, completed: true }]);
    const view = await renderWorkout();
    await waitForSets(1);

    view.rerender(<WorkoutScreen date={OTHER_DATE} onBack={() => {}} />);

    await waitFor(() => expect(reads.day).toBe(2));
    await waitFor(() => expect(reads.library).toBe(2));

    // The new date has no workout, so its records read is answered for no exercises.
    expect(reads.records).toBe(2);
    await waitFor(() => expect(screen.getByText(/No exercises logged yet/)).toBeTruthy());
  });
});

describe('stale asynchronous results', () => {
  it('cannot let a slow record read overwrite a newer one', async () => {
    const { exerciseId } = await seedDay([
      { weightKg: 100, completed: true },
      { weightKg: 120, completed: false },
    ]);
    await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The next records read of the test hangs, then answers with a 999 kg record.
    recordsIntercept = { gate, value: new Map([[exerciseId, prOf(exerciseId, 999)]]) };

    // Refresh 1: complete set 2, whose records read is the slow one.
    fireEvent.click(completeButton(2));
    await waitFor(async () =>
      expect((await db.workoutSets.toArray()).filter((row) => row.completed)).toHaveLength(2),
    );

    // Refresh 1's records read must have started before the newer one is issued:
    // the counter is bumped as the read begins, before it blocks on the gate.
    await waitFor(() => expect(reads.records).toBe(2));
    // Explicit: exactly the intercepted read is in flight, and nothing newer.
    expect(reads.records).toBe(2);

    // Refresh 2: a newer read that answers immediately with 130 kg.
    const user = userEvent.setup();
    await user.clear(weightInput(1));
    await user.type(weightInput(1), '130');
    await user.tab();
    await waitFor(() => expect(screen.getByText('PR 130 kg')).toBeTruthy());

    // The slow, older answer lands last and must be discarded.
    release();
    await settle();

    expect(screen.getByText('PR 130 kg')).toBeTruthy();
    expect(screen.queryByText('PR 999 kg')).toBeNull();
  });

  it('cannot let a library refresh in flight discard a day refresh', async () => {
    await seedDay([{ weightKg: 100, completed: false }]);
    await renderWorkout();
    await waitForSets(1);
    expect(completeButton(1).getAttribute('aria-checked')).toBe('false');

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Hold the second day read of this test: the one the toggle triggers.
    dayGate = { call: 2, gate };

    fireEvent.click(completeButton(1));
    // The write landed, but the day read that follows it is still held.
    await waitFor(async () =>
      expect((await db.workoutSets.toArray())[0].completed).toBe(true),
    );

    // A library refresh completes while that day read is in flight. With one
    // shared ticket this would invalidate the day read and the tick would never
    // appear; the two tickets keep the slices independent.
    searchCatalog('goblet squat');
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));
    await waitFor(() =>
      expect(screen.getByLabelText('Goblet squat is in your library')).toBeTruthy(),
    );
    expect(completeButton(1).getAttribute('aria-checked')).toBe('false');

    release();
    await waitFor(() => expect(completeButton(1).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByLabelText('Goblet squat is in your library')).toBeTruthy();
  });
});
