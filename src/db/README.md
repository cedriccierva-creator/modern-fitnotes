IndexedDB layer.

- `db.ts` — the Dexie schema only. Version 1 is frozen once shipped; later
  changes are added as `this.version(2).stores({...}).upgrade(...)`, never as
  edits to an existing version.
- Query helpers, cascades and JSON import/export arrive in later phases. They
  belong here, not in screens.
- `exerciseCatalog.ts` adopts entries from the static catalog in
  `lib/exerciseCatalog.ts`. Nothing here seeds or bulk-inserts: the catalog is
  shipped code, and a library row exists only once the user adopts an entry or
  logs it. Provenance lives in `Exercise.catalogId`, which is metadata, not a key,
  so building the schema stays at version 2.
- `planned.ts` is the planning layer. `setPlannedTemplate(date, presetId,
  category)` is the one write the calendar uses: it upserts exactly one row for
  exactly one date, so nothing here can populate, repeat or shift a week.
  `applyPreset` / `clearPreset` are the older whole-week helpers kept for the
  bulk path and its tests; the calendar no longer calls them.
- `WorkoutCategory` gained `arms`. It is a *value* in an existing string field,
  so stored rows need no migration and old records stay valid. Every map keyed by
  the union (labels, chip styles, persisted order) must gain the member too;
  `routines.test.ts` asserts that.
