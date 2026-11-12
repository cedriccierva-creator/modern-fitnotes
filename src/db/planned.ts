import { db } from './db';
import { newId } from '../lib/id';
import { weekDates } from '../lib/month';
import { CATEGORY_LABELS, findPreset, planWeek } from '../lib/routines';
import type { PlannedDay, WorkoutCategory } from '../types';

/**
 * Planning helpers.
 *
 * Every function here writes to `plannedDays` and to nothing else. A plan is an
 * intention for a single local calendar day: there is no week, cycle or
 * recurrence in the data, so skipping, removing or ignoring a planned day
 * cannot shift, reschedule or "overdue" any other day.
 *
 * Logged workouts (`workoutDays` and its children) are a separate table and are
 * never read for planning purposes beyond the read-only "is this date already
 * logged?" check used to warn the user.
 */

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

/** Whether one local calendar day already holds a logged workout. */
export async function isLoggedDate(date: string): Promise<boolean> {
  await db.open();
  return (await db.workoutDays.where('date').equals(date).count()) > 0;
}

/** Remove every row this preset created inside a week. Logs are untouched. */
export async function clearPreset(presetId: string, weekStartKey: string): Promise<void> {
  const dates = weekDates(weekStartKey);
  const rows = await db.plannedDays.where('date').anyOf(dates).toArray();
  await db.plannedDays.bulkDelete(rows.filter((row) => row.presetId === presetId).map((row) => row.id));
}

/**
 * Assign, change or remove the plan for exactly one local calendar day.
 *
 * This is the single primitive the calendar UI uses, and it is deliberately
 * day-scoped: the `&date` unique index means at most one row can exist per day,
 * and no sibling date is ever read or written. Assigning a category that does
 * not come from a routine keeps `presetId: 'custom'` as provenance.
 *
 * `category: null` removes the plan. Neither branch reads or writes a logged
 * workout, so planning can never modify one.
 */
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
