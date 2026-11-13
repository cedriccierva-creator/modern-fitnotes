import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { getPRsForExercise, loadExercisePerformance } from '../db/personalRecords';
import { newId } from '../lib/id';

/**
 * `loadExercisePerformance` fetches only the days its sets reference
 * (`bulkGet`), rather than scanning the whole `workoutDays` table. These
 * tests pin the two behaviors that read depends on: a set whose day row is
 * missing is skipped (never guessed at), and unrelated days never leak into
 * the result.
 */

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

const NOW = 1_700_000_000_000;

/** One day + one session for `exerciseId`, returning the ids. */
async function seedSession(date: string, exerciseId: string): Promise<{ dayId: string; sessionId: string }> {
  const dayId = newId();
  const sessionId = newId();
  await db.workoutDays.add({ id: dayId, date, createdAt: NOW, updatedAt: NOW });
  await db.workoutExercises.add({
    id: sessionId,
    workoutDayId: dayId,
    exerciseId,
    exerciseName: 'Squat',
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return { dayId, sessionId };
}

async function seedSet(
  id: string,
  sessionId: string,
  dayId: string,
  setNumber: number,
  weightKg: number,
): Promise<void> {
  await db.workoutSets.add({
    id,
    workoutExerciseId: sessionId,
    workoutDayId: dayId,
    setNumber,
    weightKg,
    reps: 5,
    completed: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('PR reads fetch only referenced days', () => {
  it('skips a set whose day row is missing instead of guessing its date', async () => {
    const exerciseId = newId();
    const { dayId, sessionId } = await seedSession('2026-11-01', exerciseId);
    await seedSet('good-set', sessionId, dayId, 1, 100);
    // Orphan: points at a day that does not exist, with a heavier load that
    // would win the PR if it were not skipped.
    await seedSet('orphan-set', sessionId, 'missing-day-id', 2, 999);

    const performance = await loadExercisePerformance(exerciseId);
    expect(performance.map((set) => set.setId)).toEqual(['good-set']);

    const record = await getPRsForExercise(exerciseId);
    expect(record.history.map((set) => set.setId)).toEqual(['good-set']);
    expect(record.current?.weightKg).toBe(100);
    expect(record.trophySetIds).toEqual(['good-set']);
  });

  it('joins across multiple dates and never leaks unrelated days', async () => {
    const exerciseId = newId();
    const first = await seedSession('2026-11-01', exerciseId);
    await seedSet('set-first', first.sessionId, first.dayId, 1, 80);
    const second = await seedSession('2026-11-08', exerciseId);
    await seedSet('set-second', second.sessionId, second.dayId, 1, 100);

    // Unrelated history for another exercise must not appear here.
    const otherExerciseId = newId();
    const other = await seedSession('2026-11-05', otherExerciseId);
    await seedSet('set-other', other.sessionId, other.dayId, 1, 200);

    const record = await getPRsForExercise(exerciseId);
    expect(record.history.map((set) => set.date)).toEqual(['2026-11-01', '2026-11-08']);
    expect(record.history.map((set) => set.setId)).toEqual(['set-first', 'set-second']);
    expect(record.current?.weightKg).toBe(100);
  });

  it('returns empty performance for a session with no sets', async () => {
    const exerciseId = newId();
    await seedSession('2026-11-01', exerciseId);

    expect(await loadExercisePerformance(exerciseId)).toEqual([]);
    const record = await getPRsForExercise(exerciseId);
    expect(record.current).toBeNull();
    expect(record.history).toEqual([]);
  });
});
