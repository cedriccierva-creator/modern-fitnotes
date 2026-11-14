// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { createElement, useLayoutEffect } from 'react';
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

/**
 * Held records reads.
 *
 * A race needs two reads in flight at the same time, which the one-shot
 * intercept above cannot express: it consumes the next call before that call has
 * been matched to an exercise. A held read is matched by the exercise ids it was
 * asked about and blocks on its own gate until the test opens it, so an ordering
 * is established by *which gate is opened first* -- never by a sleep. Its answer
 * is the real database read, an explicit value, or a rejection.
 */
interface HeldRead {
  when: (exerciseIds: readonly string[]) => boolean;
  gate: Promise<void>;
  release: () => void;
  answer: ReadonlyMap<string, ExercisePR> | 'real' | 'reject';
}

const heldReads: HeldRead[] = [];

function holdRead(
  when: (exerciseIds: readonly string[]) => boolean,
  answer: HeldRead['answer'] = 'real',
): HeldRead {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const held: HeldRead = { when, gate, release, answer };
  heldReads.push(held);
  return held;
}

/** Hold the next read that asks about exactly these exercise ids (order-free). */
function holdReadFor(
  exerciseIds: readonly string[],
  answer: HeldRead['answer'] = 'real',
): HeldRead {
  const wanted = [...exerciseIds].sort().join(',');
  return holdRead((ids) => [...ids].sort().join(',') === wanted, answer);
}

/** Hold the next whole-day read, i.e. one that asks about several exercises. */
function holdFullRead(answer: HeldRead['answer'] = 'real'): HeldRead {
  return holdRead((ids) => ids.length > 1, answer);
}

/** Take the first held read that matches, so each hold affects exactly one call. */
function takeHeldRead(exerciseIds: readonly string[]): HeldRead | null {
  const index = heldReads.findIndex((held) => held.when(exerciseIds));
  if (index === -1) return null;
  return heldReads.splice(index, 1)[0];
}

/** Open every gate still closed, so teardown can never wait on one. */
function releaseHeldReads(): void {
  for (const held of heldReads) held.release();
  heldReads.length = 0;
}

/**
 * Held *day* reads.
 *
 * A date visit issues its day read first and its records read only once that day
 * read lands, so a test that needs a record's answer to arrive between those two
 * points has to hold the day read itself. Same gate discipline as above.
 */
interface HeldDayRead {
  when: (date: string) => boolean;
  gate: Promise<void>;
  release: () => void;
}

const heldDayReads: HeldDayRead[] = [];

function holdDayRead(when: (date: string) => boolean): HeldDayRead {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const held: HeldDayRead = { when, gate, release };
  heldDayReads.push(held);
  return held;
}

/** Take the first held day read that matches, so each hold affects one call. */
function takeHeldDayRead(date: string): HeldDayRead | null {
  const index = heldDayReads.findIndex((held) => held.when(date));
  if (index === -1) return null;
  return heldDayReads.splice(index, 1)[0];
}

function releaseHeldDayReads(): void {
  for (const held of heldDayReads) held.release();
  heldDayReads.length = 0;
}

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
      const heldDay = takeHeldDayRead(date);
      if (heldDay !== null) await heldDay.gate;
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
      const held = takeHeldRead(exerciseIds);
      if (held !== null) {
        await held.gate;
        if (held.answer === 'reject') throw new Error('held records read failed');
        if (held.answer === 'real') return await realGetPRsForExercises(exerciseIds);
        return held.answer;
      }
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

/** Text only a stale held answer can put on screen; never written to the database. */
const STALE_PR_TEXT = 'PR 999 kg';

/**
 * Exercises whose *committed* DOM showed the stale record.
 *
 * Recorded in a layout effect inside the probe, which runs after React has written
 * that commit to the DOM and before any passive effect: this is a read of rendered
 * output, not of a render-phase invocation. The props history above cannot make
 * that distinction -- it sees calls React may discard, which is why it cannot, on
 * its own, separate "the block was handed a stale record" from "a stale record was
 * actually on screen".
 */
const stalePrCommits: string[] = [];

function installBlockProbe(): void {
  const RealExerciseBlock = blockModule.ExerciseBlock;

  function Probe(props: BlockProps) {
    const seen = seenPrByExercise.get(props.session.exerciseName) ?? [];
    seen.push(props.pr);
    seenPrByExercise.set(props.session.exerciseName, seen);

    useLayoutEffect(() => {
      if ((document.body.textContent ?? '').includes(STALE_PR_TEXT)) {
        stalePrCommits.push(props.session.exerciseName);
      }
    });

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

/** How many times a memoised block was handed its props, i.e. how often the
 *  screen re-rendered with that exercise in the day. */
function renderCount(exerciseName: string): number {
  return (seenPrByExercise.get(exerciseName) ?? []).length;
}

/**
 * Drain pending work without waiting for a read a test is deliberately holding.
 *
 * `settle` waits for every counted read to finish, so it cannot be used while a
 * gate is still closed. This only flushes microtasks and timers inside `act`; it
 * establishes no ordering of its own -- the gates do that.
 */
async function flush(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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
  heldReads.length = 0;
  heldDayReads.length = 0;
  seenPrByExercise.clear();
  stalePrCommits.length = 0;
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  recordsIntercept = null;
  rejectNextRecords = false;
  // A gate left closed by a failing assertion would keep the drain waiting.
  releaseHeldReads();
  releaseHeldDayReads();
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

/**
 * Put an exercise that already exists on another date, with sets of its own.
 *
 * `seedDay` creates a fresh library row per name, which gives each date a distinct
 * exercise id; a test that needs the *same* exercise on two dates (so a stale entry
 * would actually match a block on the other date) has to reuse the row.
 */
async function seedSessionOn(
  date: string,
  exerciseId: string,
  sets: ReadonlyArray<{ weightKg: number; reps?: number; completed: boolean }>,
): Promise<string> {
  const exercise = await db.exercises.get(exerciseId);
  if (!exercise) throw new Error(`no exercise ${exerciseId}`);

  const session = await workoutData.addExerciseToDay(date, exercise, 'universal');
  await db.workoutSets.where('workoutExerciseId').equals(session.id).delete();
  await db.workoutSets.bulkAdd(
    sets.map((row, index) => ({
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

  return session.id;
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

/**
 * Optimization 7.1: overlapping refreshes for *different* exercises.
 *
 * A targeted refresh speaks for one exercise, so it may not invalidate a
 * different exercise's answer. Before this fix the records stage was guarded by
 * the single day ticket, and a second write that started while the first
 * exercise's records read was still in flight discarded that answer outright --
 * the newer refresh only spoke for its own exercise, so nothing ever re-read the
 * first one and a just-set record never showed its trophy.
 *
 * Every test here establishes its ordering by opening gates, never by sleeping:
 * `waitFor` only waits for a read to have been *issued*, which the counters
 * observe exactly.
 */
describe('overlapping refreshes for different exercises', () => {
  it('keeps both results when two exercises\' records reads overlap', async () => {
    const seeded = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
      {
        name: 'Bench press',
        sets: [
          { weightKg: 80, completed: true },
          { weightKg: 95, completed: false },
        ],
      },
    ]);
    const squatId = seeded.get('Back squat')!.exerciseId;
    const benchId = seeded.get('Bench press')!.exerciseId;

    await renderWorkout();
    await waitForSets(4);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('PR 80 kg')).toBeTruthy());
    await settle();

    // Both targeted reads are held, so the second write starts while the first
    // exercise's records read is still in flight.
    const squatRead = holdReadFor([squatId]);
    const benchRead = holdReadFor([benchId]);

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);

    fireEvent.click(within(blockFor('Bench press')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(3));
    expect(idsOfLastRecordsCall()).toEqual([benchId]);

    // The newer read answers first...
    benchRead.release();
    await waitFor(() => expect(within(blockFor('Bench press')).getByText('PR 95 kg')).toBeTruthy());

    // ...and the older one still reaches the screen: it owns its own exercise.
    squatRead.release();
    await waitFor(() => expect(within(blockFor('Back squat')).getByText('PR 120 kg')).toBeTruthy());
    expect(within(blockFor('Back squat')).getAllByLabelText('Personal record set')).toHaveLength(1);
    expect(within(blockFor('Bench press')).getAllByLabelText('Personal record set')).toHaveLength(1);
    await settle();
  });

  it('a whole-day read cannot overwrite a newer targeted result', async () => {
    const seeded = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);
    const squatId = seeded.get('Back squat')!.exerciseId;
    const benchId = seeded.get('Bench press')!.exerciseId;

    await renderWorkout();
    await waitForSets(3);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    // A whole-day read (a reorder) starts first and hangs, answering with a stale
    // 999 kg record for the squat.
    const fullRead = holdFullRead(
      new Map([
        [squatId, prOf(squatId, 'Back squat', 999)],
        [benchId, prOf(benchId, 'Bench press', 80)],
      ]),
    );

    fireEvent.click(screen.getByLabelText('Move Back squat down'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toHaveLength(2);

    // A targeted read is issued after it and lands first.
    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(3));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);
    await waitFor(() => expect(screen.getByText('PR 120 kg')).toBeTruthy());

    // The older whole-day answer cannot undo it.
    fullRead.release();
    await settle();

    expect(screen.getByText('PR 120 kg')).toBeTruthy();
    expect(screen.queryByText('PR 999 kg')).toBeNull();
    expect(screen.getByText('PR 80 kg')).toBeTruthy();
  });

  it('a targeted result cannot overwrite a newer whole-day read', async () => {
    const seeded = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);
    const squatId = seeded.get('Back squat')!.exerciseId;

    await renderWorkout();
    await waitForSets(3);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    // The targeted read starts first and hangs, answering with a stale 999 kg.
    const targetedRead = holdReadFor([squatId], new Map([[squatId, prOf(squatId, 'Back squat', 999)]]));

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);

    // A whole-day read is issued after it and answers first, from the database.
    fireEvent.click(screen.getByLabelText('Move Back squat down'));
    await waitFor(() => expect(reads.records).toBe(3));
    expect(idsOfLastRecordsCall()).toHaveLength(2);
    await waitFor(() => expect(screen.getByText('PR 120 kg')).toBeTruthy());

    targetedRead.release();
    await settle();

    // The whole-day read covers the squat, so the older targeted answer loses.
    expect(screen.getByText('PR 120 kg')).toBeTruthy();
    expect(screen.queryByText('PR 999 kg')).toBeNull();
  });

  it('a failed targeted read still drops only its own exercise', async () => {
    const seeded = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
      {
        name: 'Bench press',
        sets: [
          { weightKg: 80, completed: true },
          { weightKg: 95, completed: false },
        ],
      },
    ]);
    const squatId = seeded.get('Back squat')!.exerciseId;
    const benchId = seeded.get('Bench press')!.exerciseId;

    await renderWorkout();
    await waitForSets(4);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    const squatRead = holdReadFor([squatId], 'reject');
    const benchRead = holdReadFor([benchId]);

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    fireEvent.click(within(blockFor('Bench press')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(3));

    benchRead.release();
    await waitFor(() => expect(within(blockFor('Bench press')).getByText('PR 95 kg')).toBeTruthy());

    // The failure is still this exercise's own answer, even though a newer read
    // for another exercise started after it: no record rather than a sorted one.
    squatRead.release();
    await settle();

    expect(within(blockFor('Back squat')).queryByText('PR 100 kg')).toBeNull();
    expect(lastPrProp('Back squat')).toBeNull();
    expect(within(blockFor('Bench press')).getByText('PR 95 kg')).toBeTruthy();
    expect(lastPrProp('Bench press')).not.toBeNull();
  });

  it('distinguishes a successful empty result from a missing one', async () => {
    const seeded = await seedDay(DATE, [
      { name: 'Back squat', sets: [{ weightKg: 100, completed: true }] },
      { name: 'Bench press', sets: [{ weightKg: 80, completed: true }] },
    ]);
    const squatId = seeded.get('Back squat')!.exerciseId;

    await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('PR 80 kg')).toBeTruthy());
    await settle();

    // Un-completing the only set leaves no qualifying set: the read still
    // succeeds, for an exercise with no record.
    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 1 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    await settle();

    const empty = lastPrProp('Back squat');
    expect(empty === null || empty === undefined).toBe(false);
    expect(empty?.exerciseId).toBe(squatId);
    expect(empty?.current).toBeNull();
    expect(within(blockFor('Back squat')).queryByText(/^PR /)).toBeNull();

    // A failed read is a different answer: the entry is absent, not empty.
    rejectNextRecords = true;
    fireEvent.click(within(blockFor('Bench press')).getByLabelText('Set 1 complete'));
    await waitFor(() => expect(reads.records).toBe(3));
    await settle();

    expect(lastPrProp('Bench press')).toBeNull();
    // The empty-but-successful answer survives the unrelated failure.
    expect(lastPrProp('Back squat')).not.toBeNull();
  });
});

/**
 * Optimization 7.1, date level: a records answer belongs to a date.
 *
 * Per-exercise tickets order reads within a day. They cannot order reads across a
 * date switch, because the new day never registers the exercises the old day had:
 * a targeted read for an exercise the new day does not hold is never superseded by
 * anything, so it would write its record into a day that does not contain that
 * exercise. The gate under test is the date on the answer.
 *
 * The leaked entry is not visible in the DOM -- an exercise the day does not hold
 * has no block -- so the observable is the screen's records state itself: a
 * committed answer re-renders the day, and the block probe counts that exactly.
 * The DOM assertions prove nothing *else* changed.
 */
describe('date switches', () => {
  it("does not let an old date's records answer into the new day", async () => {
    const dayA = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
    ]);
    // A different day, holding a different exercise: the squat is not in it.
    const dayB = await seedDay(OTHER_DATE, [
      { name: 'Bench press', sets: [{ weightKg: 85, completed: true }] },
    ]);
    const squatId = dayA.get('Back squat')!.exerciseId;

    const view = await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    // Day A's targeted read is held, and answers with a record of its own.
    const staleRead = holdReadFor([squatId], new Map([[squatId, prOf(squatId, 'Back squat', 999)]]));

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);

    // Switch to the day that does not hold that exercise. `settle` cannot be used
    // here: the old date's read is deliberately still in flight, so the wait is on
    // the new day's own read and on its committed state.
    view.rerender(<WorkoutScreen date={OTHER_DATE} onBack={() => {}} />);
    await waitFor(() => expect(reads.records).toBe(3));
    expect(idsOfLastRecordsCall()).toEqual([dayB.get('Bench press')!.exerciseId]);
    await flush();
    await waitFor(() => expect(screen.getByText('PR 85 kg')).toBeTruthy());

    const rendersBefore = {
      bench: renderCount('Bench press'),
      squat: renderCount('Back squat'),
    };
    expect(screen.getAllByRole('article')).toHaveLength(1);

    // The old date's answer lands only now.
    staleRead.release();
    await settle();

    // It must not reach this day's records: no entry for an exercise this day does
    // not hold, and therefore no re-render of the block that is on screen.
    expect(renderCount('Bench press')).toBe(rendersBefore.bench);
    expect(renderCount('Back squat')).toBe(rendersBefore.squat);
    expect(screen.queryByText('PR 999 kg')).toBeNull();

    // And the day that is on screen is untouched.
    const blocks = screen.getAllByRole('article');
    expect(blocks).toHaveLength(1);
    expect(within(blocks[0]).queryByText('Back squat')).toBeNull();
    expect(within(blocks[0]).getByText('PR 85 kg')).toBeTruthy();
  });

  it("does not let an old date's answer in before the new day has read its records", async () => {
    const dayA = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
    ]);
    const dayB = await seedDay(OTHER_DATE, [
      { name: 'Bench press', sets: [{ weightKg: 85, completed: true }] },
    ]);
    const squatId = dayA.get('Back squat')!.exerciseId;
    const benchId = dayB.get('Bench press')!.exerciseId;

    const view = await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    const staleRead = holdReadFor([squatId], new Map([[squatId, prOf(squatId, 'Back squat', 999)]]));
    const newDayRead = holdReadFor([benchId]);

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);

    // Switch dates; the new day's own records read is held, so its answer cannot
    // arrive before the old date's answer does.
    view.rerender(<WorkoutScreen date={OTHER_DATE} onBack={() => {}} />);
    await waitFor(() => expect(reads.records).toBe(3));
    expect(idsOfLastRecordsCall()).toEqual([benchId]);
    await flush();

    const rendersBefore = renderCount('Bench press');
    expect(within(screen.getAllByRole('article')[0]).queryByText(/^PR /)).toBeNull();

    // The old date's answer resolves after the transition has started but before
    // the new date's records read has committed.
    staleRead.release();
    await flush();

    expect(renderCount('Bench press')).toBe(rendersBefore);
    expect(screen.queryByText('PR 999 kg')).toBeNull();

    // The new day's read then commits normally.
    newDayRead.release();
    await settle();

    const blocks = screen.getAllByRole('article');
    expect(blocks).toHaveLength(1);
    expect(within(blocks[0]).getByText('PR 85 kg')).toBeTruthy();
    expect(screen.queryByText('PR 999 kg')).toBeNull();
  });
});

/**
 * Optimization 7.1, visit level: a records answer belongs to one visit of a date.
 *
 * A date string cannot identify a visit. Visiting A, then B, then A again leaves
 * the same string in state, so a read issued during the first visit of A looks
 * current again during the third -- and while that third visit's own records read
 * is still in flight, no per-exercise ticket has been registered for the exercise,
 * so nothing else rejects it. The token bumped by the date transition is
 * what separates the two visits.
 *
 * Both checks are applied twice over: when the answer arrives, and again inside the
 * state updater that merges it. These tests pin the observable outcome of both --
 * the map of the visit that is on screen, whichever render React applies the
 * update in.
 */
describe('date visit invalidation', () => {
  it('does not apply a queued answer across a date transition', async () => {
    const dayA = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
    ]);
    await seedDay(OTHER_DATE, [{ name: 'Bench press', sets: [{ weightKg: 85, completed: true }] }]);
    const squatId = dayA.get('Back squat')!.exerciseId;

    const view = await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    const staleRead = holdReadFor([squatId], new Map([[squatId, prOf(squatId, 'Back squat', 999)]]));

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);

    /*
     * The old answer is released and its update queued, and the date transition
     * happens before the update is applied: microtasks are drained (so the answer's
     * handler runs and calls `setPrs`) without yielding to the renderer, then the
     * transition is rendered. React applies the queued updater in that render, so
     * the update lands after a new visit has begun.
     */
    await act(async () => {
      staleRead.release();
      for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
      view.rerender(<WorkoutScreen date={OTHER_DATE} onBack={() => {}} />);
      await flush();
    });

    // The new day's records state is its own: no entry for the squat, no 999 kg.
    await flush();
    expect(screen.getByText('PR 85 kg')).toBeTruthy();
    expect(screen.queryByText('PR 999 kg')).toBeNull();

    const blocks = screen.getAllByRole('article');
    expect(blocks).toHaveLength(1);
    expect(within(blocks[0]).queryByText('Back squat')).toBeNull();
    expect(within(blocks[0]).getByText('PR 85 kg')).toBeTruthy();
  });

  it("does not accept the first visit's answer after returning to the same date", async () => {
    const dayA = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
    ]);
    await seedDay(OTHER_DATE, [{ name: 'Bench press', sets: [{ weightKg: 85, completed: true }] }]);
    const squatId = dayA.get('Back squat')!.exerciseId;

    const view = await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    // First visit of Day A: its targeted read is held, and answers 999 kg.
    const firstVisitRead = holdReadFor([squatId], new Map([[squatId, prOf(squatId, 'Back squat', 999)]]));

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);

    // Second visit: Day B, whose own read completes normally.
    view.rerender(<WorkoutScreen date={OTHER_DATE} onBack={() => {}} />);
    await waitFor(() => expect(reads.records).toBe(3));
    await flush();
    await waitFor(() => expect(screen.getByText('PR 85 kg')).toBeTruthy());

    /*
     * Third visit: back to Day A. Its day read is held, so the first visit's answer
     * arrives after the new visit started but before this visit has issued its own
     * records read -- the one window in which the same date string would otherwise
     * make the old answer look current.
     */
    const thirdVisitDay = holdDayRead((date) => date === DATE);
    const thirdVisitRead = holdReadFor([squatId]);

    view.rerender(<WorkoutScreen date={DATE} onBack={() => {}} />);
    await waitFor(() => expect(reads.day).toBe(4));
    await flush();

    firstVisitRead.release();
    await flush();
    expect(screen.queryByText('PR 999 kg')).toBeNull();

    // This visit's day lands, so the day is on screen while its records read is
    // still in flight: nothing from the first visit may be showing meanwhile.
    thirdVisitDay.release();
    await waitFor(() => expect(reads.records).toBe(4));
    await flush();

    expect(within(blockFor('Back squat')).queryByText(/^PR /)).toBeNull();
    expect(screen.queryByText('PR 999 kg')).toBeNull();

    thirdVisitRead.release();
    await settle();

    const blocks = screen.getAllByRole('article');
    expect(blocks).toHaveLength(1);
    expect(within(blocks[0]).getByText('PR 120 kg')).toBeTruthy();
    expect(screen.queryByText('PR 999 kg')).toBeNull();
  });
});

/**
 * The guarantee is about *rendering*, not about what a later effect leaves behind.
 *
 * A map that is only cleared by an effect for the new date is still on screen for
 * the commit that switches dates: React applies queued state updates during the
 * render of the new date, before any effect for it runs. If the previous visit's
 * answer is applied in that render, the new date's block is handed the old value --
 * a real frame, not a discarded one -- and the effect's clear merely hides it
 * afterwards. Stamping the map with its date/visit and deriving what is displayed
 * from that stamp is what makes the switching commit itself clean.
 *
 * The other date holds the *same* exercise, so a leaked entry has a block to land
 * on; with disjoint days the leak would be invisible and the test would prove
 * nothing.
 */
describe('records are never rendered for a visit they do not belong to', () => {
  it('renders no stale record in the commit that switches dates', async () => {
    const dayA = await seedDay(DATE, [
      {
        name: 'Back squat',
        sets: [
          { weightKg: 100, completed: true },
          { weightKg: 120, completed: false },
        ],
      },
    ]);
    const squatId = dayA.get('Back squat')!.exerciseId;
    await seedSessionOn(OTHER_DATE, squatId, [{ weightKg: 60, completed: true }]);

    const view = await renderWorkout();
    await waitForSets(2);
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    await settle();

    // Only what the transition renders is of interest from here on.
    seenPrByExercise.set('Back squat', []);
    stalePrCommits.length = 0;

    const staleRead = holdReadFor([squatId], new Map([[squatId, prOf(squatId, 'Back squat', 999)]]));

    fireEvent.click(within(blockFor('Back squat')).getByLabelText('Set 2 complete'));
    await waitFor(() => expect(reads.records).toBe(2));
    expect(idsOfLastRecordsCall()).toEqual([squatId]);

    /*
     * The old answer is released and its update queued while Day A is still on
     * screen (microtasks drained, renderer not yielded), then the date changes.
     * React applies the queued update in the very render that shows Day B.
     */
    await act(async () => {
      staleRead.release();
      for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
      view.rerender(<WorkoutScreen date={OTHER_DATE} onBack={() => {}} />);


      await flush();
    });
    await settle();

    // Every value Day B's block was handed, in render order, expressed as the
    // heaviest weight of the record it was given (null = no record).
    const rendered = (seenPrByExercise.get('Back squat') ?? []).map((pr) => {
      const value = pr as ExercisePR | null;
      return value === null ? null : (value.current?.weightKg ?? null);
    });

    /*
     * 999 kg exists only in the held answer: it is not in the database, so no block
     * may ever have been handed it -- not in the switching commit, not later.
     *
     * The committed-output half of the claim, and the strongest evidence the harness
     * can produce: every commit between the reset above and `settle()` was inspected
     * *after* React wrote it to the DOM and *before* any passive effect could clear
     * it. This is the record of what was actually on screen during the switch -- the
     * frame a date-keyed map paints and only clears afterwards.
     */
    expect(stalePrCommits).toEqual([]);

    /*
     * The render-history half: which records the screen handed its blocks, including
     * renders React might have discarded. Complementary to the witness above, not a
     * substitute for it -- the probe records render-phase invocations, not output.
     */
    expect(rendered).not.toContain(999);

    // The settled DOM, which on its own cannot see a frame that was cleared again.
    expect(screen.queryByText('PR 999 kg')).toBeNull();

    /*
     * And the day still reads correctly: the toggle above made 120 kg a completed
     * set, so the exercise's records -- which are all-time, not per date -- are
     * 120 kg once the new visit's own read lands. Day B shows that, not the stale
     * answer and not a permanently empty map.
     */
    expect(screen.getByText('PR 120 kg')).toBeTruthy();
  });
});
