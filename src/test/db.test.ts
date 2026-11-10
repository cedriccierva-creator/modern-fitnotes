import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FitNotesDB } from '../db/db';
import { newId } from '../lib/id';
import type { Exercise, WorkoutDay, WorkoutExercise, WorkoutSet } from '../types';

const NOW = 1_700_000_000_000;

let db: FitNotesDB;

beforeEach(() => {
  // A unique name per test keeps the suites isolated without a shared reset.
  db = new FitNotesDB(`fitnotes-test-${newId()}`);
});

afterEach(async () => {
  await db.delete();
});

/** Day + library exercise + its session row, the minimum any set needs. */
async function createSession(name: string, date: string) {
  const day: WorkoutDay = { id: newId(), date, createdAt: NOW, updatedAt: NOW };
  const exercise: Exercise = { id: newId(), name, createdAt: NOW, updatedAt: NOW };
  const logged: WorkoutExercise = {
    id: newId(),
    workoutDayId: day.id,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await db.workoutDays.add(day);
  await db.exercises.add(exercise);
  await db.workoutExercises.add(logged);

  return { day, exercise, logged };
}

describe('schema', () => {
  it('initialises every table at version 1', async () => {
    await db.open();

    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'exercises',
      'plannedDays',
      'settings',
      'workoutDays',
      'workoutExercises',
      'workoutSets',
    ]);
    expect(db.verno).toBe(2);
    expect(await db.workoutDays.count()).toBe(0);
  });
});

describe('records', () => {
  it('stores and retrieves a day, an exercise and a session row', async () => {
    const { day, exercise, logged } = await createSession('Barbell Bench Press', '2026-11-10');

    expect(await db.workoutDays.get(day.id)).toEqual(day);
    expect(await db.exercises.get(exercise.id)).toEqual(exercise);

    const byDate = await db.workoutDays.where('date').equals('2026-11-10').first();
    expect(byDate?.id).toBe(day.id);

    const sessionRows = await db.workoutExercises
      .where('workoutDayId')
      .equals(day.id)
      .toArray();
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].id).toBe(logged.id);
  });

  it('rejects a second workout day on the same date', async () => {
    await db.workoutDays.add({ id: newId(), date: '2026-11-10', createdAt: NOW, updatedAt: NOW });

    await expect(
      db.workoutDays.add({ id: newId(), date: '2026-11-10', createdAt: NOW, updatedAt: NOW }),
    ).rejects.toThrow();

    expect(await db.workoutDays.count()).toBe(1);
  });
});

describe('sets', () => {
  it('persists completed and incomplete sets in order', async () => {
    const { day, logged } = await createSession('Back Squat', '2026-11-11');

    const sets: WorkoutSet[] = [
      {
        id: newId(),
        workoutExerciseId: logged.id,
        workoutDayId: day.id,
        setNumber: 1,
        weightKg: 100,
        reps: 5,
        completed: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: newId(),
        workoutExerciseId: logged.id,
        workoutDayId: day.id,
        setNumber: 2,
        weightKg: null,
        reps: null,
        completed: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    await db.workoutSets.bulkAdd(sets);

    const stored = await db.workoutSets
      .where('workoutExerciseId')
      .equals(logged.id)
      .sortBy('setNumber');

    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ setNumber: 1, weightKg: 100, reps: 5, completed: true });
    expect(stored[1]).toMatchObject({ setNumber: 2, weightKg: null, reps: null, completed: false });
  });
});

describe('historical names', () => {
  it('keeps the logged name after the library exercise is renamed', async () => {
    const { exercise, logged } = await createSession('Incline DB Press', '2026-11-12');

    await db.exercises.update(exercise.id, {
      name: 'Incline Dumbbell Press',
      updatedAt: NOW + 1,
    });

    expect((await db.exercises.get(exercise.id))?.name).toBe('Incline Dumbbell Press');
    expect((await db.workoutExercises.get(logged.id))?.exerciseName).toBe('Incline DB Press');
  });
});
