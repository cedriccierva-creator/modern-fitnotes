import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { createExercise, deleteExercise, loadExercises, renameExercise } from '../db/exercises';
import {
  addExerciseToDay,
  ensureWorkoutDay,
  loadDay,
  reorderExercises,
  removeExerciseFromDay,
  updateSessionName,
} from '../db/workout';

const BENCH_DAY = '2026-11-11';
const PULL_DAY = '2026-11-12';

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('exercise library', () => {
  it('creates exercises with stable ids and lists them alphabetically', async () => {
    await createExercise('Squat', 'legs');
    await createExercise('Bench Press', 'chest');

    const library = await loadExercises();
    expect(library.map((exercise) => exercise.name)).toEqual(['Bench Press', 'Squat']);
    expect(new Set(library.map((exercise) => exercise.id)).size).toBe(2);
    expect(library[0].archived).toBe(false);
  });

  it('renames without rewriting historical session names', async () => {
    const bench = await createExercise('Bench Press');
    await addExerciseToDay(BENCH_DAY, bench, 'universal');

    await renameExercise(bench.id, 'Barbell Bench Press');

    expect((await db.exercises.get(bench.id))?.name).toBe('Barbell Bench Press');

    const archived = await loadDay(BENCH_DAY);
    expect(archived.exercises[0].exerciseName).toBe('Bench Press');
  });

  it('deletes without corrupting past workouts', async () => {
    const bench = await createExercise('Bench Press');
    await addExerciseToDay(BENCH_DAY, bench, 'high');
    const logged = await loadDay(BENCH_DAY);

    await deleteExercise(bench.id);

    const after = await loadDay(BENCH_DAY);
    expect(after.exercises).toHaveLength(1);
    expect(after.exercises[0]).toMatchObject({
      exerciseId: bench.id,
      exerciseName: 'Bench Press',
      sets: logged.exercises[0].sets,
    });
  });

  it('rejects an empty rename', async () => {
    const squat = await createExercise('Squat');
    await expect(renameExercise(squat.id, '   ')).rejects.toThrow(/cannot be empty/);
  });
});

describe('workout composition', () => {
  it('renames a session row without touching the library or other days', async () => {
    const pull = await createExercise('Pull-Up');
    await addExerciseToDay(PULL_DAY, pull, 'universal');
    await addExerciseToDay(BENCH_DAY, pull, 'universal');

    const pullDay = await loadDay(PULL_DAY);
    await updateSessionName(pullDay.exercises[0].id, 'Weighted Pull-Up');

    expect((await db.exercises.get(pull.id))?.name).toBe('Pull-Up');
    expect((await loadDay(BENCH_DAY)).exercises[0].exerciseName).toBe('Pull-Up');
    expect((await loadDay(PULL_DAY)).exercises[0].exerciseName).toBe('Weighted Pull-Up');
  });

  it('reorders exercises and detaches one without harming the rest', async () => {
    const day = await ensureWorkoutDay(BENCH_DAY);
    const one = await createExercise('A');
    const two = await createExercise('B');
    const three = await createExercise('C');

    await addExerciseToDay(BENCH_DAY, one, 'universal');
    await addExerciseToDay(BENCH_DAY, two, 'universal');
    const third = await addExerciseToDay(BENCH_DAY, three, 'universal');

    await reorderExercises(day.id, [
      third.id,
      (await loadDay(BENCH_DAY)).exercises[0].id,
      (await loadDay(BENCH_DAY)).exercises[1].id,
    ]);

    const reordered = (await loadDay(BENCH_DAY)).exercises.map((session) => session.exerciseName);
    expect(reordered).toEqual(['C', 'A', 'B']);

    await removeExerciseFromDay(third.id);
    const remaining = await loadDay(BENCH_DAY);
    expect(remaining.exercises.map((session) => session.exerciseName)).toEqual(['A', 'B']);
    expect(remaining.exercises[0].sets).toHaveLength(3);
  });

  it('creates the day row lazily and leaves untouched dates empty', async () => {
    expect((await loadDay(BENCH_DAY)).day).toBeNull();
    expect((await loadDay(BENCH_DAY)).exercises).toEqual([]);

    const created = await ensureWorkoutDay(BENCH_DAY);
    const session = await addExerciseToDay(BENCH_DAY, await createExercise('A'), 'universal');

    expect((await loadDay(BENCH_DAY)).day?.id).toBe(created.id);
    expect((await loadDay(BENCH_DAY)).day?.date).toBe(BENCH_DAY);
    expect((await loadDay(BENCH_DAY)).exercises[0].id).toBe(session.id);
    expect((await db.workoutDays.where('date').equals(BENCH_DAY).count())).toBe(1);
  });
});
