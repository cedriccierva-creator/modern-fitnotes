import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import { deleteSet, ensureWorkoutDay, updateSet } from '../db/workout';
import { getPRsForExercise } from '../db/personalRecords';
import { computeExercisePr, isImprovement, toCanonicalKg } from '../lib/pr';
import { parseWeightInput } from '../lib/units';
import { newId } from '../lib/id';
import type { SetPerformance } from '../lib/pr';

interface LoggedSet {
  weightKg: number | null;
  reps?: number | null;
  completed?: boolean;
}

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

/** Write one session using the real tables, returning the set ids. */
async function logSession(
  date: string,
  exerciseId: string,
  exerciseName: string,
  entries: readonly LoggedSet[],
  order = 0,
): Promise<string[]> {
  const day = await ensureWorkoutDay(date);
  const now = Date.now();
  const sessionId = newId();

  await db.workoutExercises.add({
    id: sessionId,
    workoutDayId: day.id,
    exerciseId,
    exerciseName,
    order,
    createdAt: now,
    updatedAt: now,
  });

  const ids: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const id = newId();
    ids.push(id);
    await db.workoutSets.add({
      id,
      workoutExerciseId: sessionId,
      workoutDayId: day.id,
      setNumber: index + 1,
      weightKg: entry.weightKg,
      reps: entry.reps ?? 5,
      completed: entry.completed ?? true,
      createdAt: now + index,
      updatedAt: now + index,
    });
  }
  return ids;
}

const trophies = async (exerciseId: string) => (await getPRsForExercise(exerciseId)).trophySetIds;
const currentWeight = async (exerciseId: string) =>
  (await getPRsForExercise(exerciseId)).current?.weightKg;

describe('PR detection (weight only)', () => {
  it('records the first performance as the PR', async () => {
    const squat = await createExercise('Squat');
    const ids = await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100 }]);

    const pr = await getPRsForExercise(squat.id);
    expect(pr.current?.weightKg).toBe(100);
    expect(pr.current?.setId).toBe(ids[0]);
    expect(pr.history).toHaveLength(1);
    expect(pr.trophySetIds).toEqual([ids[0]]);
  });

  it('detects a genuine improvement and keeps history in order', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100 }]);
    await logSession('2026-11-03', squat.id, squat.name, [{ weightKg: 105 }]);

    const pr = await getPRsForExercise(squat.id);
    expect(pr.history.map((set) => set.weightKg)).toEqual([100, 105]);
    expect(pr.current?.weightKg).toBe(105);
  });

  it('does not treat an equal performance as a new PR', async () => {
    const bench = await createExercise('Bench Press');
    await logSession('2026-11-01', bench.id, bench.name, [{ weightKg: 80 }]);
    await logSession('2026-11-05', bench.id, bench.name, [{ weightKg: 80 }]);

    expect(await currentWeight(bench.id)).toBe(80);
    expect(await trophies(bench.id)).toHaveLength(1);
  });

  it('does not treat a lower performance as a new PR', async () => {
    const bench = await createExercise('Bench Press');
    await logSession('2026-11-01', bench.id, bench.name, [{ weightKg: 80 }]);
    await logSession('2026-11-05', bench.id, bench.name, [{ weightKg: 70 }]);

    expect(await currentWeight(bench.id)).toBe(80);
    expect(await trophies(bench.id)).toHaveLength(1);
  });

  it('keeps the first day when the same weight is hit again later', async () => {
    const deadlift = await createExercise('Deadlift');
    const first = await logSession('2026-11-01', deadlift.id, deadlift.name, [{ weightKg: 140 }]);
    await logSession('2026-11-09', deadlift.id, deadlift.name, [{ weightKg: 140 }]);

    expect(await trophies(deadlift.id)).toEqual([first[0]]);
  });

  it('treats equivalent values in mixed units as the same performance', async () => {
    const deadlift = await createExercise('Deadlift');
    const kg = parseWeightInput('100', 'kg') as number;
    const lb = parseWeightInput('220.462', 'lb') as number;
    expect(lb).toBe(kg);

    await logSession('2026-11-01', deadlift.id, deadlift.name, [{ weightKg: kg }]);
    await logSession('2026-11-02', deadlift.id, deadlift.name, [{ weightKg: lb }]);
    await logSession('2026-11-03', deadlift.id, deadlift.name, [
      { weightKg: toCanonicalKg(220.46, 'lb') },
    ]);

    expect(await currentWeight(deadlift.id)).toBe(100);
    expect(await trophies(deadlift.id)).toHaveLength(1);
  });

  it('compares stored kg values at the storage resolution, through the input path', () => {
    const stored = (raw: string, unit: 'kg' | 'lb') => parseWeightInput(raw, unit) as number;

    expect(stored('225', 'lb')).toBe(102.06);
    expect(stored('102.058', 'kg')).toBe(102.06);
    expect(isImprovement(stored('225', 'lb'), stored('102.058', 'kg'))).toBe(false);

    expect(stored('220.462', 'lb')).toBe(100);
    expect(isImprovement(stored('100', 'kg'), stored('220.462', 'lb'))).toBe(false);

    // 220.46 lb stores as 100.00 kg too: a tie at the stored resolution.
    expect(stored('220.46', 'lb')).toBe(100);
    expect(isImprovement(stored('220.46', 'lb'), stored('100', 'kg'))).toBe(false);

    expect(isImprovement(stored('100.5', 'kg'), stored('220.462', 'lb'))).toBe(true);
    expect(isImprovement(stored('102.07', 'kg'), stored('102.06', 'kg'))).toBe(true);
  });

  it('ignores blank weights and incomplete sets', async () => {
    const press = await createExercise('Overhead Press');
    await logSession('2026-11-01', press.id, press.name, [
      { weightKg: 50 },
      { weightKg: 60, completed: false },
      { weightKg: null },
    ]);

    const pr = await getPRsForExercise(press.id);
    expect(pr.current?.weightKg).toBe(50);
    expect(pr.trophySetIds).toHaveLength(1);
  });

  it('picks a single trophy per workout day, earliest set on an internal tie', async () => {
    const row = await createExercise('Barbell Row');
    const ids = await logSession('2026-11-01', row.id, row.name, [
      { weightKg: 70 },
      { weightKg: 70 },
      { weightKg: 60 },
    ]);

    expect(await trophies(row.id)).toEqual([ids[0]]);
  });

  it('gives one trophy per exercise per day across two sessions of the same day', async () => {
    const squat = await createExercise('Squat');
    const first = await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100 }], 0);
    const second = await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 110 }], 1);

    expect(await trophies(squat.id)).toEqual([second[0]]);
    expect(first[0]).not.toBe(second[0]);
  });

  it('returns an empty view for an exercise with no qualifying set', async () => {
    const curl = await createExercise('Curl');
    const pr = await getPRsForExercise(curl.id);
    expect(pr.current).toBeNull();
    expect(pr.history).toEqual([]);
    expect(pr.trophySetIds).toEqual([]);
  });
});

describe('recalculation after history changes', () => {
  it('promotes the previous best when the PR set is edited down', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100 }]);
    const top = await logSession('2026-11-05', squat.id, squat.name, [{ weightKg: 110 }]);
    expect(await currentWeight(squat.id)).toBe(110);

    await updateSet(top[0], { weightKg: 95 });
    const pr = await getPRsForExercise(squat.id);
    expect(pr.current?.weightKg).toBe(100);
    expect(pr.trophySetIds).not.toContain(top[0]);
  });

  it('promotes the next best when the PR holder is deleted', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100 }]);
    const mid = await logSession('2026-11-03', squat.id, squat.name, [{ weightKg: 105 }]);
    const top = await logSession('2026-11-06', squat.id, squat.name, [{ weightKg: 110 }]);

    await deleteSet(top[0]);
    expect(await currentWeight(squat.id)).toBe(105);

    await deleteSet(mid[0]);
    const pr = await getPRsForExercise(squat.id);
    expect(pr.current?.weightKg).toBe(100);
    expect(pr.history.map((set) => set.weightKg)).toEqual([100]);
  });

  it('clears the PR when its only set is deleted', async () => {
    const curl = await createExercise('Curl');
    const sets = await logSession('2026-11-02', curl.id, curl.name, [{ weightKg: 30 }]);

    await deleteSet(sets[0]);
    const pr = await getPRsForExercise(curl.id);
    expect(pr.current).toBeNull();
    expect(pr.trophySetIds).toEqual([]);
  });

  it('removes later trophies when an old set is edited higher', async () => {
    const squat = await createExercise('Squat');
    const first = await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100 }]);
    const later = await logSession('2026-11-05', squat.id, squat.name, [{ weightKg: 105 }]);

    expect(await trophies(squat.id)).toEqual([first[0], later[0]]);

    // The old day becomes the best day overall; the later set no longer beats it.
    await updateSet(first[0], { weightKg: 120 });
    const pr = await getPRsForExercise(squat.id);
    expect(pr.current?.weightKg).toBe(120);
    expect(pr.trophySetIds).toEqual([first[0]]);
  });

  it('recalculates when a session moves to another date', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100 }]);
    await logSession('2026-11-05', squat.id, squat.name, [{ weightKg: 105 }]);

    const day = await db.workoutDays.where('date').equals('2026-11-05').first();
    await db.workoutDays.update((day as { id: string }).id, { date: '2026-10-30' });

    const pr = await getPRsForExercise(squat.id);
    // 105 now happened first, so 100 on 2026-11-01 is no longer a PR day.
    expect(pr.history.map((set) => [set.date, set.weightKg])).toEqual([['2026-10-30', 105]]);
    expect(pr.current?.weightKg).toBe(105);
  });

  it('never leaves stale trophies behind after repeated edits', async () => {
    const squat = await createExercise('Squat');
    const sets = await logSession('2026-11-01', squat.id, squat.name, [
      { weightKg: 90 },
      { weightKg: 95 },
    ]);

    await updateSet(sets[1], { weightKg: 94 });
    await updateSet(sets[0], { weightKg: 96 });
    const pr = await getPRsForExercise(squat.id);
    expect(pr.trophySetIds).toEqual([sets[0]]);
    expect(pr.current?.weightKg).toBe(96);
  });
});

describe('engine edge cases', () => {
  const performance = (overrides: Partial<SetPerformance>): SetPerformance => ({
    setId: newId(),
    workoutExerciseId: 'session',
    workoutDayId: 'day',
    exerciseId: 'exercise',
    exerciseName: 'Squat',
    date: '2026-11-01',
    exerciseOrder: 0,
    setNumber: 1,
    weightKg: 100,
    reps: 5,
    completed: true,
    createdAt: 0,
    ...overrides,
  });

  it('orders history by date regardless of input order', () => {
    const pr = computeExercisePr('exercise', [
      performance({ date: '2026-11-05', weightKg: 110 }),
      performance({ date: '2026-11-01', weightKg: 100 }),
    ]);
    expect(pr.history.map((set) => set.weightKg)).toEqual([100, 110]);
  });

  it('keeps exercises apart even at identical weights', () => {
    const a = computeExercisePr('a', [performance({ exerciseId: 'a' })]);
    const b = computeExercisePr('b', [performance({ exerciseId: 'b' })]);
    expect(a.current?.weightKg).toBe(100);
    expect(b.current?.weightKg).toBe(100);
    expect(a.exerciseId).not.toBe(b.exerciseId);
  });

  it('rejects zero, negative and non-finite weights', () => {
    const pr = computeExercisePr('exercise', [
      performance({ setId: 'zero', weightKg: 0 }),
      performance({ setId: 'negative', weightKg: -50 }),
      performance({ setId: 'nan', weightKg: Number.NaN }),
      performance({ setId: 'missing', weightKg: null }),
    ]);
    expect(pr.current).toBeNull();
    expect(pr.trophySetIds).toEqual([]);
  });

  it('handles an empty history', () => {
    expect(computeExercisePr('exercise', []).current).toBeNull();
  });
});
