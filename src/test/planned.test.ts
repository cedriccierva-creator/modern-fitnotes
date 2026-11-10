import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import {
  applyPreset,
  clearPreset,
  loadPlannedDays,
  removePlannedDay,
  setPlannedTemplate,
} from '../db/planned';
import { newId } from '../lib/id';
import type { WorkoutDay, WorkoutExercise, WorkoutSet } from '../types';

const WEEK = '2026-11-09';
const NOW = 1_700_000_000_000;

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

/** Log a day with one exercise and one set, so overwrite attempts are visible. */
async function logDay(date: string) {
  const day: WorkoutDay = { id: newId(), date, note: 'keep me', createdAt: NOW, updatedAt: NOW };
  const row: WorkoutExercise = {
    id: newId(),
    workoutDayId: day.id,
    exerciseId: newId(),
    exerciseName: 'Back Squat',
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const set: WorkoutSet = {
    id: newId(),
    workoutExerciseId: row.id,
    workoutDayId: day.id,
    setNumber: 1,
    weightKg: 140,
    reps: 5,
    completed: true,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await db.workoutDays.add(day);
  await db.workoutExercises.add(row);
  await db.workoutSets.add(set);
  return { day, row, set };
}

describe('applyPreset', () => {
  it('writes one planned row per template', async () => {
    await applyPreset('ppl-flow', WEEK);

    const rows = (await loadPlannedDays()).sort((a, b) => a.date.localeCompare(b.date));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.category)).toEqual(['push', 'pull', 'legs', 'upper', 'lower']);
    expect(rows[0]).toMatchObject({ date: '2026-11-09', presetId: 'ppl-flow', label: 'Push' });
    expect(rows.every((row) => row.id.length > 0)).toBe(true);
  });

  it('is idempotent on repeated activation', async () => {
    await applyPreset('ppl-flow', WEEK);
    await applyPreset('ppl-flow', WEEK);
    await applyPreset('ppl-flow', WEEK);

    expect(await loadPlannedDays()).toHaveLength(5);
  });

  it('never places a plan on a logged date and never changes the log', async () => {
    const { day, row, set } = await logDay('2026-11-09');

    await applyPreset('ppl-flow', WEEK);

    expect(await db.workoutDays.get(day.id)).toEqual(day);
    expect(await db.workoutExercises.get(row.id)).toEqual(row);
    expect(await db.workoutSets.get(set.id)).toEqual(set);

    const planned = await loadPlannedDays();
    expect(planned.some((entry) => entry.date === '2026-11-09')).toBe(false);
    expect(planned).toHaveLength(5);
  });

  it('fills nothing at all when the week is fully logged', async () => {
    for (let index = 0; index < 7; index += 1) {
      await logDay(`2026-11-${`${9 + index}`.padStart(2, '0')}`);
    }

    await applyPreset('ulul', WEEK);
    expect(await loadPlannedDays()).toEqual([]);
  });

  it('rejects an unknown preset', async () => {
    await expect(applyPreset('nope', WEEK)).rejects.toThrow(/Unknown routine preset/);
  });
});

describe('editing plans', () => {
  it('changes a single planned day without a duplicate row', async () => {
    await applyPreset('ppl-flow', WEEK);
    const before = await loadPlannedDays();

    await setPlannedTemplate('2026-11-09', 'ppl-flow', 'legs');

    const after = await loadPlannedDays();
    expect(after).toHaveLength(5);
    expect(after.find((row) => row.date === '2026-11-09')).toMatchObject({
      category: 'legs',
      label: 'Legs',
      createdAt: before[0].createdAt,
    });
  });

  it('removes one plan and leaves the others', async () => {
    await applyPreset('ppl-flow', WEEK);
    await removePlannedDay('2026-11-12');
    expect(await loadPlannedDays()).toHaveLength(4);
  });

  it('clears only the applied preset', async () => {
    await applyPreset('ppl-flow', WEEK);
    await clearPreset('ulul', WEEK);
    expect(await loadPlannedDays()).toHaveLength(5);

    await clearPreset('ppl-flow', WEEK);
    expect(await loadPlannedDays()).toEqual([]);
  });
});
