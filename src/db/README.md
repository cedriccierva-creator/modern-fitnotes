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
