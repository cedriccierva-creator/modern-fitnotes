import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import { deleteSet, ensureWorkoutDay, updateSet } from '../db/workout';
import {
  loadExercisePersonalRecords,
  loadPersonalRecords,
  loadRecordHitsForDate,
  recalculatePersonalRecords,
} from '../db/personalRecords';
import {
  computePersonalRecords,
  estimateOneRepMax,
  isImprovement,
  metricValue,
  toCanonicalKg,
  type PrMetric,
  type SetPerformance,
} from '../lib/pr';
import { newId } from '../lib/id';
import { parseWeightInput } from '../lib/units';

interface LoggedSet {
  weightKg: number | null;
  reps: number | null;
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

/** Write one session using the real tables and types, returning the set ids. */
async function logSession(
  date: string,
  exerciseId: string,
  exerciseName: string,
  entries: readonly LoggedSet[],
): Promise<string[]> {
  const day = await ensureWorkoutDay(date);
  const now = Date.now();
  const sessionId = newId();

  await db.workoutExercises.add({
    id: sessionId,
    workoutDayId: day.id,
    exerciseId,
    exerciseName,
    order: 0,
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
      reps: entry.reps,
      completed: entry.completed ?? true,
      createdAt: now + index,
      updatedAt: now + index,
    });
  }
  return ids;
}

function prValue(
  records: Awaited<ReturnType<typeof loadPersonalRecords>>,
  exerciseId: string,
  metric: PrMetric,
): number | undefined {
  return records.find((record) => record.exerciseId === exerciseId)?.metrics[metric]?.value;
}

function improvementCount(
  records: Awaited<ReturnType<typeof loadPersonalRecords>>,
  exerciseId: string,
  metric: PrMetric,
): number {
  const record = records.find((row) => row.exerciseId === exerciseId);
  return record?.improvements.filter((entry) => entry.metric === metric).length ?? 0;
}

describe('PR detection', () => {
  it('records the first performance as a PR', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100, reps: 5 }]);

    const records = await loadPersonalRecords();
    expect(prValue(records, squat.id, 'weight')).toBe(100);
    expect(improvementCount(records, squat.id, 'weight')).toBe(1);
  });

  it('detects a genuine improvement and keeps the progression in order', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100, reps: 5 }]);
    await logSession('2026-11-03', squat.id, squat.name, [{ weightKg: 105, reps: 3 }]);

    const records = await loadPersonalRecords();
    expect(prValue(records, squat.id, 'weight')).toBe(105);
    const progression = records
      .find((row) => row.exerciseId === squat.id)
      ?.improvements.filter((entry) => entry.metric === 'weight')
      .map((entry) => entry.value);
    expect(progression).toEqual([100, 105]);
  });

  it('does not treat an equal performance as a new PR', async () => {
    const bench = await createExercise('Bench Press');
    await logSession('2026-11-01', bench.id, bench.name, [{ weightKg: 80, reps: 5 }]);
    await logSession('2026-11-05', bench.id, bench.name, [{ weightKg: 80, reps: 5 }]);

    const records = await loadPersonalRecords();
    expect(prValue(records, bench.id, 'weight')).toBe(80);
    expect(improvementCount(records, bench.id, 'weight')).toBe(1);
    expect(improvementCount(records, bench.id, 'e1rm')).toBe(1);
  });

  it('does not treat a lower performance as a new PR', async () => {
    const bench = await createExercise('Bench Press');
    await logSession('2026-11-01', bench.id, bench.name, [{ weightKg: 80, reps: 5 }]);
    await logSession('2026-11-05', bench.id, bench.name, [{ weightKg: 70, reps: 5 }]);

    const records = await loadPersonalRecords();
    expect(prValue(records, bench.id, 'weight')).toBe(80);
    expect(improvementCount(records, bench.id, 'weight')).toBe(1);
  });

  it('treats equivalent values in different units as the same performance', async () => {
    const deadlift = await createExercise('Deadlift');
    await logSession('2026-11-01', deadlift.id, deadlift.name, [{ weightKg: 100, reps: 1 }]);

    // 220.46 lb is the same stored 100.00 kg, so it is not a new best.
    expect(toCanonicalKg(220.46, 'lb')).toBe(100);
    await logSession('2026-11-02', deadlift.id, deadlift.name, [
      { weightKg: toCanonicalKg(220.46, 'lb'), reps: 1 },
    ]);

    const records = await loadPersonalRecords();
    expect(prValue(records, deadlift.id, 'weight')).toBe(100);
    expect(improvementCount(records, deadlift.id, 'weight')).toBe(1);
    expect(improvementCount(records, deadlift.id, 'e1rm')).toBe(1);
  });

  it('compares stored kg values only, at the storage resolution', async () => {
    // Every value goes through the real input path: parseWeightInput -> roundKg.
    const stored = (raw: string, unit: 'kg' | 'lb') => parseWeightInput(raw, unit) as number;

    // 225 lb and 102.058 kg are the same stored weight.
    expect(stored('225', 'lb')).toBe(102.06);
    expect(stored('102.058', 'kg')).toBe(102.06);
    expect(isImprovement(stored('225', 'lb'), stored('102.058', 'kg'))).toBe(false);

    // 100 kg and 220.462 lb are the same stored weight.
    expect(stored('220.462', 'lb')).toBe(100);
    expect(isImprovement(stored('100', 'kg'), stored('220.462', 'lb'))).toBe(false);

    // 220.46 lb also stores as 100.00 kg, so it ties too (documented, not a claim
    // about exact arithmetic: 220.46 * 0.45359237 = 99.998974 kg).
    expect(stored('220.46', 'lb')).toBe(100);
    expect(isImprovement(stored('220.46', 'lb'), stored('100', 'kg'))).toBe(false);

    // A real 0.01 kg step up is still an improvement, in either direction.
    expect(isImprovement(stored('100.5', 'kg'), stored('220.462', 'lb'))).toBe(true);
    expect(isImprovement(stored('102.07', 'kg'), stored('102.06', 'kg'))).toBe(true);
  });

  it('does not create duplicate PRs for repeated identical sets', async () => {
    const row = await createExercise('Barbell Row');
    await logSession('2026-11-01', row.id, row.name, [
      { weightKg: 60, reps: 8 },
      { weightKg: 60, reps: 8 },
      { weightKg: 60, reps: 8 },
    ]);
    await logSession('2026-11-04', row.id, row.name, [{ weightKg: 60, reps: 8 }]);

    const records = await loadPersonalRecords();
    expect(records).toHaveLength(1);
    expect(improvementCount(records, row.id, 'weight')).toBe(1);
    expect(improvementCount(records, row.id, 'volume')).toBe(1);
  });

  it('supports the metrics the model can express and ignores unfilled sets', async () => {
    const press = await createExercise('Overhead Press');
    await logSession('2026-11-01', press.id, press.name, [
      { weightKg: 50, reps: 5 },
      { weightKg: 60, reps: 3, completed: false },
      { weightKg: null, reps: 12 },
      { weightKg: 40, reps: null },
    ]);

    const records = await loadPersonalRecords();
    expect(prValue(records, press.id, 'weight')).toBe(50); // the incomplete 60 kg set is not a performance
    expect(prValue(records, press.id, 'reps')).toBe(12); // bodyweight set still counts for reps
    expect(prValue(records, press.id, 'volume')).toBe(250);
    expect(prValue(records, press.id, 'e1rm')).toBe(estimateOneRepMax(50, 5));
    expect(metricValue('weight', null, 12)).toBeNull();
    expect(metricValue('reps', 40, null)).toBeNull();
  });
});

describe('PR recalculation after history changes', () => {
  it('lowers the PR when the record set is edited down', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100, reps: 5 }]);
    const recordSets = await logSession('2026-11-05', squat.id, squat.name, [{ weightKg: 110, reps: 3 }]);

    expect(prValue(await loadPersonalRecords(), squat.id, 'weight')).toBe(110);

    await updateSet(recordSets[0], { weightKg: 95 });
    const records = await recalculatePersonalRecords();
    expect(prValue(records, squat.id, 'weight')).toBe(100);
    expect(records.find((row) => row.exerciseId === squat.id)?.metrics.weight?.setId).not.toBe(
      recordSets[0],
    );
  });

  it('restores the correct previous best after deleting the record set', async () => {
    const squat = await createExercise('Squat');
    await logSession('2026-11-01', squat.id, squat.name, [{ weightKg: 100, reps: 5 }]);
    const midSets = await logSession('2026-11-03', squat.id, squat.name, [{ weightKg: 105, reps: 4 }]);
    const topSets = await logSession('2026-11-06', squat.id, squat.name, [{ weightKg: 110, reps: 2 }]);

    expect(prValue(await loadPersonalRecords(), squat.id, 'weight')).toBe(110);

    await deleteSet(topSets[0]);
    expect(prValue(await loadPersonalRecords(), squat.id, 'weight')).toBe(105);

    await deleteSet(midSets[0]);
    const records = await loadPersonalRecords();
    expect(prValue(records, squat.id, 'weight')).toBe(100);
    expect(improvementCount(records, squat.id, 'weight')).toBe(1);
    expect(await loadExercisePersonalRecords(squat.id)).toEqual(
      records.find((row) => row.exerciseId === squat.id),
    );
  });

  it('clears the PR when its only set is deleted and leaves nothing behind', async () => {
    const curl = await createExercise('Curl');
    const sets = await logSession('2026-11-02', curl.id, curl.name, [{ weightKg: 30, reps: 10 }]);

    await deleteSet(sets[0]);
    const records = await loadPersonalRecords();
    expect(records.find((row) => row.exerciseId === curl.id)?.metrics.weight).toBeUndefined();
    expect(await loadRecordHitsForDate('2026-11-02')).toEqual([]);
  });

  it('reports PR moments for a session day only when they were real PRs', async () => {
    const bench = await createExercise('Bench Press');
    await logSession('2026-11-01', bench.id, bench.name, [{ weightKg: 80, reps: 5 }]);
    await logSession('2026-11-08', bench.id, bench.name, [{ weightKg: 85, reps: 5 }]);

    const hits = await loadRecordHitsForDate('2026-11-08');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((entry) => entry.exerciseId === bench.id)).toBe(true);
    expect(hits.find((entry) => entry.metric === 'weight')?.value).toBe(85);
    expect(await loadRecordHitsForDate('2026-10-01')).toEqual([]);
  });
});

describe('PR engine edge cases', () => {
  const base = (overrides: Partial<SetPerformance>): SetPerformance => ({
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
    const records = computePersonalRecords([
      base({ date: '2026-11-05', weightKg: 110, reps: 2 }),
      base({ date: '2026-11-01', weightKg: 100, reps: 5 }),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].metrics.weight?.value).toBe(110);
    expect(records[0].improvements.filter((entry) => entry.metric === 'weight').map((entry) => entry.value)).toEqual([
      100, 110,
    ]);
    expect(records[0].exerciseName).toBe('Squat');
  });

  it('keeps exercises apart even when set value is identical', () => {
    const records = computePersonalRecords([
      base({ exerciseId: 'a', exerciseName: 'Squat' }),
      base({ exerciseId: 'b', exerciseName: 'Bench Press' }),
    ]);
    expect(records.map((row) => row.exerciseId).sort()).toEqual(['a', 'b']);
  });

  it('treats 0 and negative values as not recorded', () => {
    expect(metricValue('weight', 0, 10)).toBeNull();
    expect(metricValue('volume', -10, 5)).toBeNull();
    expect(metricValue('e1rm', 100, 0)).toBeNull();
    expect(metricValue('volume', 100, 10)).toBe(1000);
  });

  it('ignores rows with no exercise id and empty history', () => {
    expect(computePersonalRecords([])).toEqual([]);
    expect(computePersonalRecords([base({ exerciseId: '' })])).toEqual([]);
  });
});
