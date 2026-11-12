import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import {
  applyPreset,
  clearPreset,
  isLoggedDate,
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

/**
 * The planner is day-scoped: every write here targets exactly one local
 * calendar day, so a skipped day can never shift, reschedule or "overdue"
 * another. These tests pin that down directly, without any UI involved.
 */
describe('independent day assignment', () => {
  it('assigns one empty date and leaves the rest of the week empty', async () => {
    await setPlannedTemplate('2026-11-12', 'custom', 'arms');

    const rows = await loadPlannedDays();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-11-12',
      presetId: 'custom',
      category: 'arms',
      label: 'Arms',
    });
  });

  it('persists an arbitrary day-by-day pattern, empty Wednesday included', async () => {
    // Mon push, Tue legs, Wed rest, Thu upper, Fri pull. No routine, no spread.
    await setPlannedTemplate('2026-11-09', 'custom', 'push');
    await setPlannedTemplate('2026-11-10', 'custom', 'legs');
    await setPlannedTemplate('2026-11-12', 'custom', 'upper');
    await setPlannedTemplate('2026-11-13', 'custom', 'pull');

    const rows = (await loadPlannedDays()).sort((a, b) => a.date.localeCompare(b.date));
    expect(rows.map((row) => [row.date, row.category])).toEqual([
      ['2026-11-09', 'push'],
      ['2026-11-10', 'legs'],
      ['2026-11-12', 'upper'],
      ['2026-11-13', 'pull'],
    ]);
    expect(rows.some((row) => row.date === '2026-11-11')).toBe(false);
  });

  it('never writes a sibling date when one date changes', async () => {
    await setPlannedTemplate('2026-11-09', 'custom', 'push');
    await setPlannedTemplate('2026-11-10', 'custom', 'pull');
    const before = await loadPlannedDays();

    await setPlannedTemplate('2026-11-09', 'custom', 'arms');

    const after = await loadPlannedDays();
    expect(after).toHaveLength(2);
    expect(after.find((row) => row.date === '2026-11-10')).toEqual(
      before.find((row) => row.date === '2026-11-10'),
    );
  });

  it('repeats the same template on different dates as separate rows', async () => {
    await setPlannedTemplate('2026-11-09', 'full-body-3', 'fullBody');
    await setPlannedTemplate('2026-11-12', 'full-body-3', 'fullBody');

    const rows = (await loadPlannedDays()).sort((a, b) => a.date.localeCompare(b.date));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.date)).toEqual(['2026-11-09', '2026-11-12']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows.every((row) => row.category === 'fullBody')).toBe(true);
  });

  it('changes a date in place without a duplicate row and keeps createdAt', async () => {
    await setPlannedTemplate('2026-11-11', 'custom', 'push');
    const before = (await loadPlannedDays())[0];

    await setPlannedTemplate('2026-11-11', 'custom', 'arms');

    const after = await loadPlannedDays();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ category: 'arms', label: 'Arms', createdAt: before.createdAt });
    expect(after[0].id).toBe(before.id);
  });

  it('removes the plan for one date and leaves every other date alone', async () => {
    await applyPreset('ppl-flow', WEEK);
    const before = await loadPlannedDays();
    const removed = before.find((row) => row.date === '2026-11-11')!;

    await removePlannedDay('2026-11-11');

    const after = await loadPlannedDays();
    expect(after).toHaveLength(4);
    expect(after.some((row) => row.date === '2026-11-11')).toBe(false);
    for (const row of before.filter((entry) => entry.date !== removed.date)) {
      expect(after.find((entry) => entry.date === row.date)).toEqual(row);
    }
  });

  it('removing a skipped day does not shift later plans forward', async () => {
    await setPlannedTemplate('2026-11-09', 'custom', 'push');
    await setPlannedTemplate('2026-11-10', 'custom', 'pull');
    await setPlannedTemplate('2026-11-11', 'custom', 'legs');

    // "Skip" Wednesday by deleting it: nothing may move into Tuesday or Thursday.
    await removePlannedDay('2026-11-11');

    const rows = (await loadPlannedDays()).sort((a, b) => a.date.localeCompare(b.date));
    expect(rows.map((row) => [row.date, row.category])).toEqual([
      ['2026-11-09', 'push'],
      ['2026-11-10', 'pull'],
    ]);
    expect(rows.some((row) => row.date === '2026-11-12')).toBe(false);
  });
});

describe('planning never touches a logged workout', () => {
  it('assigns onto an already-logged date and leaves the log byte-identical', async () => {
    const { day, row, set } = await logDay('2026-11-10');

    await setPlannedTemplate('2026-11-10', 'custom', 'arms');

    expect(await db.workoutDays.get(day.id)).toEqual(day);
    expect(await db.workoutExercises.get(row.id)).toEqual(row);
    expect(await db.workoutSets.get(set.id)).toEqual(set);

    const planned = await loadPlannedDays();
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ date: '2026-11-10', category: 'arms' });
  });

  it('removes a plan from a logged date and leaves the log alone', async () => {
    const { day, row, set } = await logDay('2026-11-10');
    await setPlannedTemplate('2026-11-10', 'custom', 'push');

    await removePlannedDay('2026-11-10');

    expect(await loadPlannedDays()).toEqual([]);
    expect(await db.workoutDays.get(day.id)).toEqual(day);
    expect(await db.workoutExercises.get(row.id)).toEqual(row);
    expect(await db.workoutSets.get(set.id)).toEqual(set);
  });

  it('reports whether a single date is logged', async () => {
    expect(await isLoggedDate('2026-11-10')).toBe(false);

    await logDay('2026-11-10');

    expect(await isLoggedDate('2026-11-10')).toBe(true);
    expect(await isLoggedDate('2026-11-11')).toBe(false);
  });
});

describe('arms category', () => {
  it('persists arms with its label and reads back after a fresh query', async () => {
    await setPlannedTemplate('2026-11-11', 'custom', 'arms');

    const rows = await loadPlannedDays();
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('arms');
    expect(rows[0].label).toBe('Arms');
    expect(typeof rows[0].id).toBe('string');
  });
});
