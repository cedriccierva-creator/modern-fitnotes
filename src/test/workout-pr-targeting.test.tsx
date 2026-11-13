// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WorkoutScreen from '../screens/WorkoutScreen';
import * as blockModule from '../components/ExerciseBlock';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import * as workoutData from '../db/workout';
import * as recordsData from '../db/personalRecords';
import { computeExercisePr } from '../lib/pr';
import type { ExercisePR } from '../lib/pr';
import { newId } from '../lib/id';

/**
 * Optimization 7: a set write re-reads the records of the one exercise it moved.
 *
 * `computeExercisePrView` is per exercise -- it reads nothing but that exercise's
 * own history -- so toggling a set, editing its weight or reps, adding a set or
 * deleting one may only ask the batch about the owning exercise. Everything that
 * can move another exercise's records (mount, a date change, attaching or
 * removing an exercise, reordering a day, renaming a session) must still ask for
 * every exercise in the day.
 *
 * The reads are counted exactly as in `workout-library-refresh.test.tsx`: wrappers
 * installed on the module namespace with `Object.defineProperty`, never `vi.mock`,
 * because a module factory would re-evaluate the data layer in its own registry
 * and the counts would describe a second database. Every assertion here is an
 * exact call count or an exact argument list; nothing measures milliseconds.
 */

const reads = { day: 0, records: 0 };
/** The exercise ids each `getPRsForExercises` call was asked about, in order. */
const recordsArgs: string[][] = [];
/** Reads still in flight, so teardown can wait for them (see `settle`). */
let inFlight = 0;

/**
 * One-shot intercepts.
 *
 * `recordsIntercept` answers the *next* records read with a value of its own once
 * its gate opens; `rejectNextRecords` makes the next one fail. Both are consumed
 * by the call they affect, so a later read sees the real database again.
 */
let recordsIntercept: { gate: Promise<void>; value: ReadonlyMap<string, ExercisePR> } | null = null;
let rejectNextRecords = false;

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
    inFlight += 1;
    try {
      return await realLoadDay(date);
    } finally {
      inFlight -= 1;
    }
  });

  const realGetPRsForExercises = recordsData.getPRsForExercises;
  replaceExport(recordsData, 'getPRsForExercises', async (exerciseIds: readonly string[]) => {
    reads.records += 1;
    recordsArgs.push([...exerciseIds]);
    inFlight += 1;
    try {
      if (rejectNextRecords) {
        rejectNextRecords = false;
        throw new Error('records read failed');
      }
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

/**
 * Probe on the block component's `pr` prop.
 *
 * The prop a block receives is the value the screen holds in its PR map, so
 * recording it on every render is how "the untouched exercises keep the same
 * object" becomes observable from a test. The probe is deliberately not
 * memoised: it re-renders with the screen and then hands the props to the real
 * (memoised) block, so neither the bail-outs being asserted nor the DOM change.
 */
type BlockProps = ComponentProps<typeof blockModule.ExerciseBlock>;
const seenPrByExercise = new Map<string, unknown[]>();

function installBlockProbe(): void {
  const RealExerciseBlock = blockModule.ExerciseBlock;

  function Probe(props: BlockProps) {
    const seen = seenPrByExercise.get(props.session.exerciseName) ?? [];
    seen.push(props.pr);
    seenPrByExercise.set(props.session.exerciseName, seen);
    return createElement(RealExerciseBlock, props);
  }

  replaceExport(blockModule, 'default', Probe);
}

installBlockProbe();

/** The most recent `pr` prop one exercise's block was rendered with. */
function lastPrProp(exerciseName: string): ExercisePR | null | undefined {
  const seen = seenPrByExercise.get(exerciseName) ?? [];
  return seen[seen.length - 1] as ExercisePR | null | undefined;
}

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
  recordsArgs.length = 0;
  inFlight = 0;
  recordsIntercept = null;
  rejectNextRecords = false;
  seenPrByExercise.clear();
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  recordsIntercept = null;
  rejectNextRecords = false;
  // Drain before closing the database, so no read resolves against a deleted one.
  await settle();
  cleanup();
  await db.delete();
});

const DATE = '2026-11-10';
const OTHER_DATE = '2026-11-11';

interface SeedSpec {
  name: string;
  sets: readonly { weightKg: number | null; reps?: number; completed: boolean }[];
}

interface Seeded {
  exerciseId: string;
  sessionId: string;
}

/**
 * A day holding the given exercises, each with exactly the given sets.
 *
 * `addExerciseToDay` is used first so the day row, the session rows and the
 * denormalised `workoutDayId` all come from the real write path; only the
 * generated set rows are replaced, to keep each test's history explicit.
 */
async function seedDay(
  date: string,
  specs: readonly SeedSpec[],
): Promise<Map<string, Seeded>> {
  const seeded = new Map<string, Seeded>();

  for (const spec of specs) {
    const exercise = await createExercise(spec.name);
    const session = await workoutData.addExerciseToDay(date, exercise, 'universal');

    await db.workoutSets.where('workoutExerciseId').equals(session.id).delete();
    await db.workoutSets.bulkAdd(
      spec.sets.map((row, index) => ({
        id: newId(),
        workoutExerciseId: session.id,
        workoutDayId: session.workoutDayId,
        setNumber: index + 1,
        weightKg: row.weightKg,
        reps: row.reps ?? 5,
        completed: row.completed,
        createdAt: index,
        updatedAt: index,
      })),
    );

    seeded.set(spec.name, { exerciseId: exercise.id, sessionId: session.id });
  }

  return seeded;
}

/** A PR value built by the real engine, so no PR arithmetic lives in this file. */
function prOf(exerciseId: string, exerciseName: string, weightKg: number): ExercisePR {
  return computeExercisePr(exerciseId, [
    {
      setId: 'intercepted-set',
      workoutExerciseId: 'intercepted-session',
      workoutDayId: 'intercepted-day',
      exerciseId,
      exerciseName,
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

/** Wait for the screen's set rows to be on screen. */
async function waitForSets(count: number): Promise<void> {
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(count));
}

/** One exercise's block, found by the name it renders in its header. */
function blockFor(name: string): HTMLElement {
  const blocks = screen.getAllByRole('article');
  const found = blocks.find((block) => within(block).queryByText(name) !== null);
  if (found === undefined) throw new Error(`No block rendered for ${name}`);
  return found;
}

const idsOfLastRecordsCall = (): string[] => recordsArgs[recordsArgs.length - 1] ?? [];

describe('whole-day record refreshes', () => {
  it('mount asks about every exercise in the day, in one batch read', async () => {
    const seeded = await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    expect(reads.records).toBe(1);
    expect(recordsArgs).toHaveLength(1);
    expect(recordsArgs[0]).toHaveLength(2);
    expect(new Set(recordsArgs[0])).toEqual(
      new Set([seeded.get('Back squat')!.exerciseId, seeded.get('Bench press')!.exerciseId]),
    );

    // Both records are on screen, so the call above was answered and rendered.
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    expect(screen.getByText('PR 80 kg')).toBeTruthy();
  });

  it('a date change asks about every exercise in the new day', async () => {
    await seedDay(DATE, [{ name: 'Back squat', sets: [{ weightKg: 100, completed: true }] }]);
    const nextDay = await seedDay(OTHER_DATE, [
      { name: 'Back squat', sets: [{ weightKg: 105, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 85, completed: true }] },
    ]);

    const view = await renderWorkout();
    await waitForSets(1);

    view.rerender(<WorkoutScreen date={OTHER_DATE} onBack={() => {}} />);
    await waitFor(() => expect(reads.records).toBe(2));

    expect(idsOfLastRecordsCall()).toHaveLength(2);
    expect(new Set(idsOfLastRecordsCall())).toEqual(
      new Set([nextDay.get('Back squat')!.exerciseId, nextDay.get('Bench press')!.exerciseId]),
    );
    await waitForSets(2);
  });

  it('keeps one batch read per refresh, never one per exercise', async () => {
    await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
      { name: 'Deadlift', sets: [{ weightKg: 140, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(3);
    expect(reads.records).toBe(1);

    // Attaching a third exercise gives the day three ids in one call, not three.
    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'goblet squat' } });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to today'));

    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(recordsArgs).toHaveLength(2);
    expect(idsOfLastRecordsCall()).toHaveLength(4);
  });
});

describe('single-exercise record refreshes', () => {
  it('a completion toggle asks only about the exercise that owns the set', async () => {
    const seeded = await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: false }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);
    expect(reads.records).toBe(1);

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 1 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Back squat')!.exerciseId]);
    await waitFor(() =>
      expect(within(blockFor('Back squat')).getByLabelText('Set 1 complete').getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
  });

  it('a weight commit asks only about the exercise that owns the set', async () => {
    const seeded = await seedDay(DATE, [
      // Completed but unweighted: the typed value is the first performance, so
      // the record on screen proves the targeted answer was the one committed.
      { name: 'Back squat', sets: [{ weightKg: null, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    const user = userEvent.setup();
    const input = within(blockFor('Back squat')).getByLabelText('Weight for set 1') as HTMLInputElement;
    await user.type(input, '110');
    await user.tab();

    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Back squat')!.exerciseId]);
    // The new record is displayed, so the targeted answer was the one committed.
    await waitFor(() => expect(within(blockFor('Back squat')).getByText('PR 110 kg')).toBeTruthy());
  });

  it('a reps commit asks only about the exercise that owns the set', async () => {
    const seeded = await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, reps: 5, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    const user = userEvent.setup();
    const reps = within(blockFor('Back squat')).getByLabelText('Repetitions for set 1');
    await user.clear(reps);
    await user.type(reps, '3');
    await user.tab();

    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Back squat')!.exerciseId]);
  });

  it('adding a set asks only about the exercise that owns the set', async () => {
    const seeded = await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    fireEvent.click(within(blockFor('Back squat')).getByRole('button', { name: '+ set' }));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Back squat')!.exerciseId]);
    await waitForSets(3);
  });

  it('deleting a set asks only about the exercise that owns the set', async () => {
    const seeded = await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Delete set 1'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Back squat')!.exerciseId]);
  });
});

describe('operations that can move several exercises', () => {
  it('reordering a day asks about every exercise again', async () => {
    await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    fireEvent.click(screen.getByLabelText('Move Back squat down'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(idsOfLastRecordsCall()).toHaveLength(2);
  });

  it('removing an exercise asks about every remaining exercise', async () => {
    const seeded = await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    fireEvent.click(screen.getByLabelText('Delete Back squat from workout'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Bench press')!.exerciseId]);
    // One block left, and it is the other exercise's. The name itself still
    // appears in the catalog list, so the block count is what is asserted.
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(within(screen.getAllByRole('article')[0]).queryByText('Back squat')).toBeNull();
  });

  it('renaming a session still refreshes the whole day', async () => {
    await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);

    // The block is captured before editing: while renaming, its header is an
    // input rather than the name, so it can no longer be found by its text. Both
    // controls are scoped to the block because the Library list's own rename
    // button carries the same accessible name for the same exercise.
    const block = blockFor('Back squat');
    fireEvent.click(within(block).getByLabelText('Rename Back squat in workout'));
    const input = within(block).getByLabelText('Rename Back squat');
    fireEvent.change(input, { target: { value: 'Low-bar squat' } });
    fireEvent.blur(input);

    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    // A rename rewrites the snapshot the record's name comes from, so the day's
    // records are all re-read rather than one exercise's.
    expect(idsOfLastRecordsCall()).toHaveLength(2);
  });
});

describe('the untouched exercises keep their records', () => {
  it('preserves the PR objects of exercises the write cannot have changed', async () => {
    await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: false }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 80 kg')).toBeTruthy());
    await settle();

    const benchBefore = lastPrProp('Bench press');
    expect(benchBefore).not.toBeNull();

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 1 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    // Same object, not merely an equal value: the targeted merge carried the
    // entry over untouched instead of rebuilding the map.
    expect(lastPrProp('Bench press')).toBe(benchBefore);
    // And the untouched block still shows its record.
    expect(within(blockFor('Bench press')).getByText('PR 80 kg')).toBeTruthy();
  });

  it('promotes the previous best when a record-holding set is deleted', async () => {
    await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 95, completed: true },
          { weightKg: 100, completed: true },
        ],
      },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(3);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Delete set 2'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    // The deleted set was the record; the row behind it becomes the record, and
    // the other exercise's record is untouched.
    await waitFor(() => expect(screen.getByText('PR 95 kg')).toBeTruthy());
    expect(screen.queryByText('PR 100 kg')).toBeNull();
    expect(screen.getByText('PR 80 kg')).toBeTruthy();
  });
});

describe('failure and staleness on the targeted path', () => {
  it('a failed targeted read drops only the affected exercise record', async () => {
    await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);

    await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());

    rejectNextRecords = true;
    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 1 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    // The exercise whose read failed shows no record...
    expect(within(blockFor('Back squat')).queryByText('PR 100 kg')).toBeNull();
    // ...and the unrelated exercise keeps its own.
    expect(screen.getByText('PR 80 kg')).toBeTruthy();
  });

  it('cannot let a slow targeted read overwrite a newer one', async () => {
    const seeded = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: null, completed: false },
        ],
      },
    ]);

    await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The next targeted read hangs, then answers with a 999 kg record.
    recordsIntercept = {
      gate,
      value: new Map([[seeded.get('Back squat')!.exerciseId, prOf(seeded.get('Back squat')!.exerciseId, 'Back squat', 999)]]),
    };

    // Refresh 1: complete set 2, whose record read is the slow one.
    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(async () =>
      expect((await db.workoutSets.toArray()).filter((row) => row.completed)).toHaveLength(2),
    );
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Back squat')!.exerciseId]);

    // Refresh 2: a newer targeted read that answers immediately with 130 kg.
    const user = userEvent.setup();
    const input = within(blockFor('Back squat')).getByLabelText('Weight for set 1') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '130');
    await user.tab();
    await waitFor(() => expect(screen.getByText('PR 130 kg')).toBeTruthy());
    expect(idsOfLastRecordsCall()).toEqual([seeded.get('Back squat')!.exerciseId]);

    // The slow, older answer lands last and must be discarded.
    release();
    await settle();

    expect(screen.getByText('PR 130 kg')).toBeTruthy();
    expect(screen.queryByText('PR 999 kg')).toBeNull();
  });
});
