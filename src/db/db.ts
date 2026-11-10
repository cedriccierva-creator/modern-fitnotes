import Dexie, { type Table } from 'dexie';
import type {
  Exercise,
  PlannedDay,
  Settings,
  WorkoutDay,
  WorkoutExercise,
  WorkoutSet,
} from '../types';

/**
 * IndexedDB schema.
 *
 * `&date` on workoutDays and plannedDays are *unique* indexes: the database
 * itself refuses two records for the same local calendar day, so neither
 * "one workout a day" nor "one plan a day" depends on a code path remembering.
 *
 * Indexes are declared only for fields actually filtered or sorted on, and
 * never for booleans — IndexedDB cannot index boolean values.
 *
 * Migrations only ever *add* a version, with an `upgrade()` to move old data.
 * Version 1 is frozen once shipped; version 2 below adds plannedDays without
 * touching the existing tables.
 */
export class FitNotesDB extends Dexie {
  workoutDays!: Table<WorkoutDay, string>;
  exercises!: Table<Exercise, string>;
  workoutExercises!: Table<WorkoutExercise, string>;
  workoutSets!: Table<WorkoutSet, string>;
  plannedDays!: Table<PlannedDay, string>;
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

    // Planned days are a separate table: routine presets must never be able to
    // overwrite a logged workout. Nothing here alters version 1's stores.
    this.version(2).stores({
      plannedDays: 'id, &date, presetId',
    });
  }
}

/** The one database the app uses. Tests instantiate FitNotesDB with another name. */
export const db = new FitNotesDB();
