import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { loadExercisePersonalRecords } from '../db/personalRecords';
import { newId } from '../lib/id';
import type { WorkoutSet } from '../types';

/**
 * Ordering contract: the PR engine never relies on Dexie cursor order.
 *
 * IndexedDB returns an index scan in [indexKey, primaryKey] order, so a
 * `where('workoutExerciseId')` scan hands back rows ordered by random uuid —
 * not by setNumber and not by insertion. These tests feed the same history in
 * hostile orders (ids reversed against setNumber, shuffled inserts) and require
 * byte-identical PR output.
 */

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

interface Row {
  setId: string;
  setNumber: number;
  weightKg: number;
  exerciseOrder?: number;
}

/** Write one day/session and insert the given sets in the given order. */
async function seed(
  date: string,
  exerciseId: string,
  rows: readonly Row[],
  insertOrder: readonly string[],
): Promise<void> {
  const now = 1_700_000_000_000;
  const dayId = newId();
  await db.workoutDays.add({ id: dayId, date, createdAt: now, updatedAt: now });

  const byOrder = new Map<number, string>();
  for (const row of rows) byOrder.set(row.exerciseOrder ?? 0, newId());

  for (const [order, sessionId] of byOrder) {
    await db.workoutExercises.add({
      id: sessionId,
      workoutDayId: dayId,
      exerciseId,
      exerciseName: 'Squat',
      order,
      createdAt: now,
      updatedAt: now,
    });
  }

  const byId = new Map(rows.map((row) => [row.setId, row]));
  const pending: WorkoutSet[] = [];
  for (const setId of insertOrder) {
    const row = byId.get(setId);
    if (row === undefined) continue;
    pending.push({
      id: row.setId,
      workoutExerciseId: byOrder.get(row.exerciseOrder ?? 0) as string,
      workoutDayId: dayId,
      setNumber: row.setNumber,
      weightKg: row.weightKg,
      reps: 5,
      completed: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.workoutSets.bulkAdd(pending);
}

async function weightProgression(exerciseId: string) {
  const record = await loadExercisePersonalRecords(exerciseId);
  return record?.improvements
    .filter((entry) => entry.metric === 'weight')
    .map((entry) => entry.value);
}

describe('PR ordering is explicit, not cursor order', () => {
  it('is unchanged when ids run reverse to setNumber and inserts are shuffled', async () => {
    const exerciseId = newId();
    const rows: Row[] = [
      { setId: 'zzzz-set-1', setNumber: 1, weightKg: 60 },
      { setId: 'yyyy-set-2', setNumber: 2, weightKg: 80 },
      { setId: 'xxxx-set-3', setNumber: 3, weightKg: 70 },
      { setId: 'wwww-set-4', setNumber: 4, weightKg: 90 },
    ];

    // Ascending ids, ascending sets, sequential inserts.
    await seed('2026-11-01', exerciseId, rows, rows.map((row) => row.setId));
    const ascending = await weightProgression(exerciseId);
    expect(ascending).toEqual([60, 80, 90]);

    await db.delete();
    await db.open();

    // Reverse ids, shuffled inserts: same history, so same PRs.
    await seed('2026-11-01', exerciseId, rows, ['xxxx-set-3', 'zzzz-set-1', 'wwww-set-4', 'yyyy-set-2']);
    expect(await weightProgression(exerciseId)).toEqual(ascending);
  });

  it('orders an exercise that appears twice in one day by session position', async () => {
    const exerciseId = newId();
    const rows: Row[] = [
      { setId: 'b-first-slot', setNumber: 1, weightKg: 100, exerciseOrder: 0 },
      { setId: 'a-second-slot', setNumber: 1, weightKg: 100, exerciseOrder: 1 },
    ];

    // Reverse of the intended order, and ids that sort the other way.
    await seed('2026-11-01', exerciseId, rows, ['a-second-slot', 'b-first-slot']);
    const record = await loadExercisePersonalRecords(exerciseId);

    // Identical weight in one day is one trophy, owned by the earlier position.
    expect(record?.improvements.filter((entry) => entry.metric === 'weight')).toHaveLength(1);
    expect(record?.metrics.weight?.setId).toBe('b-first-slot');
  });
});
