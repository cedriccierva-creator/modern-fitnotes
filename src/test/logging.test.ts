import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import {
  addExerciseToDay,
  addSetsToExercise,
  deleteSet,
  loadDay,
  updateSet,
} from '../db/workout';
import { loadWeightUnit, setWeightUnit } from '../db/settings';
import { findIntensity } from '../lib/intensity';

const DATE = '2026-11-10';

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('set logging', () => {
  it('generates the right number of set rows per intensity', async () => {
    const squat = await createExercise('Squat');

    await addExerciseToDay(DATE, squat, 'high');
    await addExerciseToDay(DATE, squat, 'universal');
    await addExerciseToDay(DATE, squat, 'power');

    const sizes = (await loadDay(DATE)).exercises.map((session) => session.sets.length);
    expect(sizes).toEqual([2, 3, 3]);
  });

  it('persists decimal weights in kilograms', async () => {
    const bench = await createExercise('Bench Press');
    await addExerciseToDay(DATE, bench, 'universal');
    const setId = (await loadDay(DATE)).exercises[0].sets[0].id;

    await updateSet(setId, { weightKg: 0.1 + 0.2 });
    await updateSet(setId, { reps: 12 });

    const stored = await db.workoutSets.get(setId);
    expect(stored?.weightKg).toBe(0.3);
    expect(stored?.reps).toBe(12);
  });

  it('completes and uncompletes a set', async () => {
    const bench = await createExercise('Bench Press');
    await addExerciseToDay(DATE, bench, 'high');
    const setId = (await loadDay(DATE)).exercises[0].sets[0].id;

    await updateSet(setId, { completed: true });
    expect((await db.workoutSets.get(setId))?.completed).toBe(true);

    await updateSet(setId, { completed: false });
    expect((await db.workoutSets.get(setId))?.completed).toBe(false);
  });

  it('clears a weight to null rather than storing zero', async () => {
    const bench = await createExercise('Bench Press');
    await addExerciseToDay(DATE, bench, 'universal');
    const setId = (await loadDay(DATE)).exercises[0].sets[0].id;

    await updateSet(setId, { weightKg: 80, reps: 10 });
    await updateSet(setId, { weightKg: null, reps: null });

    const stored = await db.workoutSets.get(setId);
    expect(stored?.weightKg).toBeNull();
    expect(stored?.reps).toBeNull();
  });

  it('edits and deletes individual sets', async () => {
    const bench = await createExercise('Bench Press');
    await addExerciseToDay(DATE, bench, 'universal');
    const before = (await loadDay(DATE)).exercises[0].sets;
    const middle = before[1];

    await updateSet(middle.id, { weightKg: 90, reps: 5, completed: true });
    const edited = (await loadDay(DATE)).exercises[0].sets.find((set) => set.id === middle.id);
    expect(edited).toMatchObject({ weightKg: 90, reps: 5, completed: true });

    await deleteSet(middle.id);
    const after = (await loadDay(DATE)).exercises[0].sets.map((set) => set.id);
    expect(after).not.toContain(middle.id);
    expect(after).toHaveLength(2);
  });

  it('adds sets after the existing numbering', async () => {
    const bench = await createExercise('Bench Press');
    const session = await addExerciseToDay(DATE, bench, 'high');

    const added = await addSetsToExercise(session.id, 2, 12);
    expect(added.map((set) => set.setNumber)).toEqual([3, 4]);
    expect((await loadDay(DATE)).exercises[0].sets).toHaveLength(4);
  });

  it('survives a fresh database handle, i.e. real persistence', async () => {
    const bench = await createExercise('Bench Press');
    const session = await addExerciseToDay(DATE, bench, 'universal');
    await updateSet(session.sets[0].id, { weightKg: 100, reps: 8, completed: true });

    const reopened = new (await import('../db/db')).FitNotesDB();
    await reopened.open();

    const stored = await reopened.workoutExercises.get(session.id);
    const sets = await reopened.workoutSets.where('workoutExerciseId').equals(session.id).toArray();
    expect(stored?.exerciseName).toBe('Bench Press');
    expect(sets).toHaveLength(3);
    // Select by setNumber: an index scan is not guaranteed to return insertion order.
    const firstSet = sets.find((set) => set.setNumber === 1);
    expect(firstSet).toMatchObject({ weightKg: 100, reps: 8, completed: true });
    expect(findIntensity('universal').repMax).toBe(12);

    await reopened.delete();
  });
});

describe('settings', () => {
  it('defaults to kilograms and remembers a change', async () => {
    expect(await loadWeightUnit()).toBe('kg');

    await setWeightUnit('lb');
    expect(await loadWeightUnit()).toBe('lb');

    await setWeightUnit('kg');
    expect(await loadWeightUnit()).toBe('kg');
  });
});
