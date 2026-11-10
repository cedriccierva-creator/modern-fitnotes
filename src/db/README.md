IndexedDB layer.

- `db.ts` — the Dexie schema only. Version 1 is frozen once shipped; later
  changes are added as `this.version(2).stores({...}).upgrade(...)`, never as
  edits to an existing version.
- Query helpers, cascades and JSON import/export arrive in later phases. They
  belong here, not in screens.
