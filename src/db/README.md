IndexedDB layer.

- `db.ts` — the Dexie schema only. Version 1 is frozen once shipped; later
  changes are added as `this.version(2).stores({...}).upgrade(...)`, never as
  edits to an existing version. Version 2 adds `plannedDays`; Phase 6A adds
  no schema version or persisted personal-record table.
- `workout.ts` — workout-day, exercise-session and set queries/mutations.
  Removing an exercise from a logged day explicitly deletes its sets and
  exercise row in a Dexie transaction; there are no database-level foreign-key
  cascades.
- `personalRecords.ts` — derives personal records from stored workout
  history. `loadExercisePerformance(exerciseId)` loads the selected
  exercise's session rows and sets; `getPRsForExercise(exerciseId)` computes
  the existing heaviest-weight PR and Phase 6A achievements from that same
  in-memory history. PRs and achievements are not persisted, and planned days
  are never included in the calculation.
- `exerciseCatalog.ts` adopts entries from the static catalog in
  `lib/exerciseCatalog.ts`. Nothing here seeds or bulk-inserts: the catalog is
  shipped code, and a library row exists only once the user adopts an entry or
  logs it. Provenance lives in `Exercise.catalogId`, which is metadata, not a
  key, so building the schema stays at version 2.
- `planned.ts` is the planning layer. `setPlannedTemplate(date, presetId,
  category)` is the one write the calendar uses: it upserts exactly one row for
  exactly one date, so nothing here can populate, repeat or shift a week.
  `applyPreset` / `clearPreset` are the older whole-week helpers kept for the
  bulk path and its tests; the calendar no longer calls them.
- `WorkoutCategory` gained `arms`. It is a *value* in an existing string
  field, so stored rows need no migration and old records stay valid. Every
  map keyed by the union (labels, chip styles, persisted order) must gain the
  member too; `routines.test.ts` asserts that.

JSON import/export is not currently implemented.
