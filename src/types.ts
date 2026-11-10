/**
 * Shared types for the whole app. This file stays the single source of truth
 * for stored shapes.
 *
 * Conventions that the rest of the app must respect:
 * - `id` is a stable string from `newId()`, never a numeric auto-increment.
 * - `date` is a *local* calendar day as "YYYY-MM-DD"; never a UTC instant.
 * - `weightKg` is always kilograms. Pounds are a display concern only, which
 *   keeps any future unit switch lossless.
 * - `reps` is an integer.
 * - `exerciseName` is a historical snapshot on the session row, so renaming or
 *   archiving an Exercise never rewrites what was actually performed.
 * - `createdAt` / `updatedAt` are epoch milliseconds.
 */

/** The unit the user prefers to *see*. Storage is always kg. */
export type WeightUnit = 'kg' | 'lb';

/** One training session. At most one per local calendar day. */
export interface WorkoutDay {
  id: string;
  /** Local calendar day, "YYYY-MM-DD". Unique across the table. */
  date: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** A reusable exercise definition — the user's library. */
export interface Exercise {
  id: string;
  name: string;
  /** Free-form grouping such as "chest" or "quads"; not an enum yet. */
  muscleGroup?: string;
  notes?: string;
  /**
   * Archived exercises stay referenced by history but are hidden from pickers.
   * IndexedDB cannot index booleans, so this is filtered in memory.
   */
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** An Exercise as it appears inside one WorkoutDay. */
export interface WorkoutExercise {
  id: string;
  workoutDayId: string;
  /** The library exercise this came from. May later be renamed or archived. */
  exerciseId: string;
  /** Historical snapshot: what the exercise was called on this day. */
  exerciseName: string;
  /** Position within the session, ascending from 0. */
  order: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** One set. Incomplete sets are real rows, just with `completed: false`. */
export interface WorkoutSet {
  id: string;
  workoutExerciseId: string;
  /** Denormalised so a whole day's sets load with a single index scan. */
  workoutDayId: string;
  setNumber: number;
  /** Kilograms. `null` means bodyweight or not recorded. */
  weightKg: number | null;
  /** Integer reps. `null` means not filled in yet. */
  reps: number | null;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Key for the single-row settings table. */
export const SETTINGS_ID = 'app' as const;

export interface Settings {
  id: typeof SETTINGS_ID;
  /** Display preference only; stored weights stay in kg. */
  weightUnit: WeightUnit;
  createdAt: number;
  updatedAt: number;
}
