import type { WorkoutCategory } from '../types';

/** Emerald stays the primary accent; categories get their own hue for at-a-glance reading. */
export const CATEGORY_CHIP: Record<WorkoutCategory, string> = {
  push: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30',
  pull: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/30',
  legs: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  upper: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  lower: 'bg-teal-500/15 text-teal-300 ring-1 ring-inset ring-teal-500/30',
  fullBody: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30',
};
