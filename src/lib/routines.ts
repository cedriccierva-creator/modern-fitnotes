import { weekDates } from './month';
import type { WorkoutCategory } from '../types';

export interface RoutinePreset {
  /** Stable id: it is persisted on PlannedDay, so it must never be renamed. */
  id: string;
  name: string;
  /** In cycle order. Repeats (PPLPPL) list every training day explicitly. */
  templates: readonly WorkoutCategory[];
}

export const ROUTINE_PRESETS: readonly RoutinePreset[] = [
  { id: 'ppl-flow', name: 'PPLUL', templates: ['push', 'pull', 'legs', 'upper', 'lower'] },
  { id: 'ulul', name: 'ULUL', templates: ['upper', 'lower', 'upper', 'lower'] },
  { id: 'pplppl', name: 'PPLPPL', templates: ['push', 'pull', 'legs', 'push', 'pull', 'legs'] },
  {
    id: 'full-body-3',
    name: 'Full Body ×3',
    templates: ['fullBody', 'fullBody', 'fullBody'],
  },
];

export const CATEGORY_LABELS: Record<WorkoutCategory, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper',
  lower: 'Lower',
  arms: 'Arms',
  fullBody: 'Full Body',
};

/**
 * Every category, in picker order.
 *
 * This is the list the planner offers for a category-only assignment. Routine
 * presets are a separate, optional layer on top of it: a preset never has to be
 * used for a day to have a category.
 */
export const ALL_CATEGORIES: readonly WorkoutCategory[] = [
  'push',
  'pull',
  'legs',
  'upper',
  'lower',
  'arms',
  'fullBody',
];

/**
 * Indexes spread evenly across `total` slots. Full Body ×3 therefore lands on
 * three evenly spaced days rather than three consecutive ones.
 */
export function evenSpread(count: number, total: number): number[] {
  if (total <= 0 || count <= 0) return [];
  if (count === 1) return [Math.floor((total - 1) / 2)];
  if (count >= total) return Array.from({ length: total }, (_, index) => index);
  const last = total - 1;
  return Array.from({ length: count }, (_, index) => Math.round((index * last) / (count - 1)));
}

export interface PlannedAssignment {
  date: string;
  category: WorkoutCategory;
}

/**
 * Resolve a preset against one Monday-first week. `blocked` is the set of dates
 * that must stay empty — dates that already hold a logged workout — so planning
 * never lands on top of a log. Days that already hold a plan are filtered by
 * the caller before writing.
 */
export function planWeek(
  preset: RoutinePreset,
  weekStartKey: string,
  blocked?: ReadonlySet<string>,
): PlannedAssignment[] {
  const open = weekDates(weekStartKey).filter((date) => !blocked?.has(date));
  if (open.length === 0) return [];

  return evenSpread(preset.templates.length, open.length)
    .map((position, index) => ({ date: open[position], category: preset.templates[index] }))
    .filter((assignment): assignment is PlannedAssignment => Boolean(assignment.date && assignment.category));
}

export function findPreset(id: string): RoutinePreset | undefined {
  return ROUTINE_PRESETS.find((preset) => preset.id === id);
}
