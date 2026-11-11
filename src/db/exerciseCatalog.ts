/**
 * Adopting built-in catalog entries into the personal library.
 *
 * The catalog itself is static data (see `lib/exerciseCatalog.ts`) and is never
 * inserted automatically: nothing here runs on startup, and browsing the picker
 * touches only that module. A row reaches Dexie only when the user explicitly
 * adopts an entry (or logs it against a day, which goes through the existing
 * `addExerciseToDay` path).
 *
 * Provenance is the `catalogId` field on the library row. It is deliberately not
 * the primary key — adopted rows get their own generated id — so renaming a row
 * keeps its link to the catalog and re-adopting can never overwrite the user's
 * copy.
 *
 * There are no deletion tombstones: deleting an adopted exercise removes the row,
 * and the catalog then offers that entry for adoption again. That is the intended
 * behaviour, and it keeps the schema free of bookkeeping state.
 */
import { db } from './db';
import { newId } from '../lib/id';
import {
  findCatalogExercise,
  findCatalogMatchesByName,
  normalizeExerciseName,
  type CatalogExercise,
} from '../lib/exerciseCatalog';
import type { Exercise } from '../types';

/** Why an adoption did not create a row. */
export type AdoptOutcome =
  | { status: 'adopted'; exercise: Exercise }
  | { status: 'already-adopted'; exercise: Exercise }
  | { status: 'name-taken'; existing: Exercise };

/**
 * The library row that already represents this catalog entry, if any.
 *
 * Matched by `catalogId` first so a renamed row is still found, then by name so
 * an entry the user typed by hand before adopting is recognised instead of being
 * duplicated.
 */
export async function findExistingForCatalog(
  catalogId: string,
): Promise<Exercise | undefined> {
  await db.open();

  const rows = await db.exercises.toArray();
  const linked = rows.find((row) => row.catalogId === catalogId);
  if (linked !== undefined) return linked;

  const entry = findCatalogExercise(catalogId);
  if (entry === undefined) return undefined;

  // Same-name fallback. Archive state is ignored: a hidden row still owns the
  // name, and silently creating a second one would split the user's history.
  const wanted = normalizeExerciseName(entry.name);
  return rows.find((row) => normalizeExerciseName(row.name) === wanted);
}

/**
 * Add one catalog entry to the personal library.
 *
 * Duplicate prevention happens here rather than in the UI so it holds no matter
 * which caller asks. `confirmNameCollision` is consulted when a *different*
 * exercise already owns the name, and the default is to refuse: never overwrite
 * or merge user data without an explicit yes.
 */
export async function adoptCatalogExercise(
  catalogId: string,
  options: { confirmNameCollision?: (existing: Exercise) => boolean } = {},
): Promise<AdoptOutcome> {
  const entry = findCatalogExercise(catalogId);
  if (entry === undefined) {
    throw new Error(`Unknown catalog exercise: ${catalogId}`);
  }

  await db.open();

  const existing = await findExistingForCatalog(catalogId);
  if (existing !== undefined) {
    // Linked rows are already adopted; name-only matches are a collision the
    // caller may still choose to accept.
    if (existing.catalogId === catalogId) {
      return { status: 'already-adopted', exercise: existing };
    }
    const accepted = options.confirmNameCollision?.(existing) ?? false;
    if (!accepted) return { status: 'name-taken', existing };
  }

  const now = Date.now();
  const exercise: Exercise = {
    id: newId(),
    name: entry.name,
    muscleGroup: entry.category,
    catalogId: entry.id,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.exercises.add(exercise);
  return { status: 'adopted', exercise };
}

/**
 * A library row for a catalog entry *without* persisting it.
 *
 * Used by "add to today": logging a suggestion must not quietly populate the
 * library, because library and day are separate actions. The returned object is
 * transient and only supplies `addExerciseToDay` with an id and a name.
 */
export function catalogEntryToExercise(entry: CatalogExercise): Exercise {
  const now = Date.now();
  return {
    id: newId(),
    name: entry.name,
    muscleGroup: entry.category,
    catalogId: entry.id,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Whether a typed name collides with something already present — a library row
 * or a catalog entry. Returns the clashing names so a caller can explain itself.
 */
export async function findNameCollisions(name: string): Promise<{
  library: Exercise | undefined;
  catalog: readonly CatalogExercise[];
}> {
  const wanted = normalizeExerciseName(name);
  if (wanted === '') return { library: undefined, catalog: [] };

  await db.open();
  const rows = await db.exercises.toArray();

  return {
    library: rows.find((row) => normalizeExerciseName(row.name) === wanted),
    catalog: findCatalogMatchesByName(name),
  };
}
