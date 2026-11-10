import Dexie, { type Table } from 'dexie';
import type {
  Exercise,
  Settings,
  WorkoutDay,
  WorkoutExercise,
  WorkoutSet,
} from '../types';

/**
 * IndexedDB schema.
 *
 * `&date` on workoutDays is a *unique* index: the database itself refuses a
 * second session on the same local calendar day, so the one-workout-a-day rule
 * cannot be bypassed by a stray code path.
 *
 * Indexes are declared only for fields actually filtered or sorted on, and
 * never for booleans — IndexedDB cannot index boolean values.
 *
 * Migrations: only ever *add* a version. Version 1 is frozen once this ships;
 * a later change becomes `this.version(2).stores({...}).upgrade(tx => ...)`.
 */
export class FitNotesDB extends Dexie {
  workoutDays!: Table<WorkoutDay, string>;
  exercises!: Table<Exercise, string>;
  workoutExercises!: Table<WorkoutExercise, string>;
  workoutSets!: Table<WorkoutSet, string>;
  settings!: Table<Settings, 'app'>;

  constructor(name = 'fitnotes') {
    super(name);

    this.version(1).stores({
      workoutDays: 'id, &date',
      exercises: 'id, name, muscleGroup',
      workoutExercises: 'id, workoutDayId, exerciseId, [workoutDayId+order]',
      workoutSets: 'id, workoutExerciseId, workoutDayId, [workoutExerciseId+setNumber]',
      settings: 'id',
    });
  }
}

/** The one database the app uses. Tests instantiate FitNotesDB with another name. */
export const db = new FitNotesDB();
