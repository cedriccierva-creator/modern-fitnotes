import { db } from './db';
import { newId } from '../lib/id';
import { weekDates } from '../lib/month';
import { CATEGORY_LABELS, findPreset, planWeek } from '../lib/routines';
import type { PlannedDay, WorkoutCategory } from '../types';

function createPlannedDay(date: string, presetId: string, category: WorkoutCategory): PlannedDay {
  const now = Date.now();
  return {
    id: newId(),
    date,
    presetId,
    label: CATEGORY_LABELS[category],
    category,
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadPlannedDays(): Promise<PlannedDay[]> {
  await db.open();
  return db.plannedDays.toArray();
}

/** Dates inside a week that already carry a logged workout. Plans skip these. */
/**
 * Apply a preset to the current Monday-first week.
 *
 * Idempotent: a week that already carries this preset is left exactly as it
 * is, so repeated activation never adds duplicate rows. Existing plans and
 * existing logs are never overwritten — only missing days are filled.
 */
export async function applyPreset(presetId: string, weekStartKey: string): Promise<void> {
  const preset = findPreset(presetId);
  if (!preset) throw new Error(`Unknown routine preset: ${presetId}`);

  const dates = weekDates(weekStartKey);
  const existing = await db.plannedDays.where('date').anyOf(dates).toArray();
  if (existing.some((row) => row.presetId === presetId)) return;

  const blocked = await loadLoggedDates(dates);
  const taken = new Set(existing.map((row) => row.date));
  const assignments = planWeek(preset, weekStartKey, blocked).filter(
    (assignment) => !taken.has(assignment.date),
  );

  if (assignments.length > 0) {
    await db.plannedDays.bulkAdd(
      assignments.map((assignment) => createPlannedDay(assignment.date, preset.id, assignment.category)),
    );
  }
}

/** Remove one planned day. A logged workout on that date is untouched. */
export async function removePlannedDay(date: string): Promise<void> {
  await db.plannedDays.where('date').equals(date).delete();
}

/** Dates in `dates` that already hold a logged workout. */
export async function loadLoggedDates(dates: readonly string[]): Promise<Set<string>> {
  const logged = new Set<string>();
  for (const date of dates) {
    if ((await db.workoutDays.where('date').equals(date).count()) > 0) logged.add(date);
  }
  return logged;
}

/** Remove every row this preset created inside a week. Logs are untouched. */
export async function clearPreset(presetId: string, weekStartKey: string): Promise<void> {
  const dates = weekDates(weekStartKey);
  const rows = await db.plannedDays.where('date').anyOf(dates).toArray();
  await db.plannedDays.bulkDelete(rows.filter((row) => row.presetId === presetId).map((row) => row.id));
}

/** Change one planned day. `null` removes the plan and never touches the log. */
export async function setPlannedTemplate(
  date: string,
  presetId: string,
  category: WorkoutCategory | null,
): Promise<void> {
  const existing = await db.plannedDays.where('date').equals(date).first();

  if (category === null) {
    if (existing) await db.plannedDays.delete(existing.id);
    return;
  }

  if (existing) {
    await db.plannedDays.update(existing.id, {
      presetId,
      category,
      label: CATEGORY_LABELS[category],
      updatedAt: Date.now(),
    });
    return;
  }

  await db.plannedDays.add(createPlannedDay(date, presetId, category));
}
