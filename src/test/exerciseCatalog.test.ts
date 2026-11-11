import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import {
  adoptCatalogExercise,
  catalogEntryToExercise,
  findExistingForCatalog,
  findNameCollisions,
} from '../db/exerciseCatalog';
import { createExercise, deleteExercise, loadExercises, renameExercise } from '../db/exercises';
import { addExerciseToDay, loadDay, updateSet } from '../db/workout';
import { getPRsForExercise } from '../db/personalRecords';
import {
  CATALOG,
  CATALOG_CATEGORIES,
  DROPPED_ENTRIES,
  LEVEL_LABELS,
  catalogCountsByLibrary,
  filterCatalog,
  findCatalogExercise,
  findCatalogMatchesByName,
  normalizeExerciseName,
} from '../lib/exerciseCatalog';

const DATE = '2026-11-11';

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

/**
 * Catalog integrity.
 *
 * The catalog is shipped data, so the risks are drift (a duplicated id, a typo in
 * a category, an entry silently changing shape) and source infidelity. These
 * assertions pin both.
 */
describe('catalog integrity', () => {
  it('holds the expected number of entries per library', () => {
    // 340 library rows in the source, minus 21 repeats across libraries and one
    // malformed combined row.
    expect(catalogCountsByLibrary()).toEqual({ gym: 168, home: 106, minimal: 44 });
    expect(CATALOG).toHaveLength(318);
    expect(DROPPED_ENTRIES).toHaveLength(22);
  });

  it('gives every entry a unique, stable, slug-shaped id', () => {
    const ids = CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of CATALOG) {
      expect(entry.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      // The id must be derived from the entry, not a counter, so it survives
      // reordering of the source document.
      expect(entry.id.startsWith(`${entry.library}-`)).toBe(true);
    }
  });

  it('never reuses a name inside one library', () => {
    for (const library of ['gym', 'home', 'minimal'] as const) {
      const names = CATALOG.filter((entry) => entry.library === library).map((entry) =>
        normalizeExerciseName(entry.name),
      );
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('only uses declared libraries, categories and levels', () => {
    for (const entry of CATALOG) {
      expect(['gym', 'home', 'minimal']).toContain(entry.library);
      expect(CATALOG_CATEGORIES[entry.library]).toContain(entry.category);
      if (entry.level !== undefined) expect(['B', 'I', 'A']).toContain(entry.level);
      // A name is always present and never blank.
      expect(entry.name.trim()).not.toBe('');
    }
  });

  it('leaves level absent only for the mobility section', () => {
    const ungraded = CATALOG.filter((entry) => entry.level === undefined);
    expect(ungraded).toHaveLength(12);
    for (const entry of ungraded) {
      expect(entry.category).toBe('Mobility and cool-down');
      // That section carries a prescription instead, and the source has no
      // "Level" column for it, so nothing was invented.
      expect(entry.holdOrReps).toBeDefined();
    }
  });

  it('labels all three levels', () => {
    expect(LEVEL_LABELS).toEqual({ B: 'Beginner', I: 'Intermediate', A: 'Advanced' });
  });

  it('does not import routines or influencer programs', () => {
    const routineNames = [
      'Full Body A/B/C',
      'PHUL',
      '5x5 Strength',
      'Bro Split',
      'Arnold Split',
      'PPL + Upper/Lower hybrid',
      'Jeff Nippard',
      'Chris Bumstead',
      'Sam Sulek',
      'Chloe Ting',
      'Pamela Reif',
    ];
    for (const entry of CATALOG) {
      for (const routine of routineNames) {
        expect(entry.name).not.toContain(routine);
      }
    }
    // Every entry is a movement with a category from a library section.
    expect(CATALOG.every((entry) => entry.category !== 'Gym routines')).toBe(true);
  });
});

describe('source fidelity', () => {
  it('reproduces names verbatim', () => {
    const expected = [
      'Flat barbell bench press',
      'Conventional deadlift',
      'Pendlay row',
      "Farmer's carry",
      'Sissy squat',
      'Nordic hamstring curl',
      'Wall push-up',
      'Pseudo-planche push-up',
      'Ring push-up',
      "World's greatest stretch",
      'Skin the cat',
    ];
    const names = new Set(CATALOG.map((entry) => entry.name));
    for (const name of expected) expect(names.has(name)).toBe(true);
  });

  it('keeps meaningful variations as separate entries', () => {
    const pairs: [string, string][] = [
      ['Cable crossover (high to low)', 'Cable crossover (low to high)'],
      ['Cable pushdown (rope)', 'Cable pushdown (straight bar)'],
      ['Leg press (feet low)', 'Leg press (feet high and wide)'],
      ['Single-leg calf raise (deficit)', 'Single-leg calf raise (stairs)'],
      ['Parallel-bar dip (chest lean)', 'Triceps dip (upright torso)'],
      ['High-bar back squat', 'Low-bar back squat'],
    ];
    const names = new Set(CATALOG.map((entry) => entry.name));
    for (const [a, b] of pairs) {
      expect(names.has(a)).toBe(true);
      expect(names.has(b)).toBe(true);
    }
    // ...and they are distinct rows, not collapsed into one.
    expect(new Set(CATALOG.map((entry) => entry.id)).size).toBe(CATALOG.length);
  });

  it('drops the malformed combined row instead of inventing an entry', () => {
    const combined = 'Pull-up, chin-up, neutral-grip pull-up';
    expect(CATALOG.some((entry) => entry.name === combined)).toBe(false);
    expect(DROPPED_ENTRIES).toContainEqual({ name: combined, reason: 'malformed' });
    // The three movements it named are present individually.
    for (const name of ['Pull-up', 'Chin-up']) {
      expect(CATALOG.some((entry) => entry.name === name)).toBe(true);
    }
  });

  it('keeps only the first occurrence of a repeated movement', () => {
    // "Bulgarian split squat" appears under Quads (gym) and Legs and glutes (home).
    const occurrences = CATALOG.filter((entry) => entry.name === 'Bulgarian split squat');
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].library).toBe('gym');
    expect(DROPPED_ENTRIES).toContainEqual({
      name: 'Bulgarian split squat',
      reason: 'duplicate',
    });
  });

  it('preserves the source metadata where it exists and omits it where it does not', () => {
    const bench = CATALOG.find((entry) => entry.name === 'Flat barbell bench press');
    expect(bench).toMatchObject({
      equipment: 'Barbell, bench',
      targets: 'Mid chest, triceps, front delts',
      level: 'B',
      library: 'gym',
      category: 'Chest',
    });

    // The home push section has no equipment column.
    const wallPushUp = CATALOG.find((entry) => entry.name === 'Wall push-up');
    expect(wallPushUp?.equipment).toBeUndefined();
    expect(wallPushUp?.easier).toBeDefined();
    expect(wallPushUp?.harder).toBeDefined();

    // Cardio carries a "Type" rather than targets.
    const jumpingJack = CATALOG.find((entry) => entry.name === 'Jumping jack');
    expect(jumpingJack?.type).toBe('Low-impact cardio');
    expect(jumpingJack?.targets).toBeUndefined();
  });
});

describe('search and filters', () => {
  it('returns the whole catalog for an empty query', () => {
    expect(filterCatalog()).toHaveLength(CATALOG.length);
  });

  it('filters by library', () => {
    const gym = filterCatalog({ library: 'gym' });
    expect(gym).toHaveLength(168);
    expect(gym.every((entry) => entry.library === 'gym')).toBe(true);
  });

  it('filters by category and by level', () => {
    const chest = filterCatalog({ library: 'gym', category: 'Chest' });
    expect(chest.length).toBeGreaterThan(0);
    expect(chest.every((entry) => entry.category === 'Chest')).toBe(true);

    const advanced = filterCatalog({ level: 'A' });
    expect(advanced.length).toBeGreaterThan(0);
    expect(advanced.every((entry) => entry.level === 'A')).toBe(true);
  });

  it('matches names, targets and categories case-insensitively', () => {
    expect(filterCatalog({ search: 'DEADLIFT' }).length).toBeGreaterThan(0);

    const byTarget = filterCatalog({ search: 'glutes', library: 'gym' });
    expect(byTarget.length).toBeGreaterThan(0);
    expect(
      byTarget.every((entry) =>
        `${entry.targets ?? ''}${entry.name}${entry.category}`.toLowerCase().includes('glute'),
      ),
    ).toBe(true);

    const byCategory = filterCatalog({ search: 'calves', library: 'gym' });
    expect(byCategory.length).toBeGreaterThan(0);
  });

  it('requires every search term to match', () => {
    const both = filterCatalog({ search: 'incline barbell' });
    expect(both.length).toBeGreaterThan(0);
    for (const entry of both) {
      const haystack = normalizeExerciseName(
        [entry.name, entry.targets ?? '', entry.category].join(' '),
      );
      expect(haystack).toContain('incline');
      expect(haystack).toContain('barbell');
    }

    // Nonsense combinations match nothing rather than falling back to everything.
    expect(filterCatalog({ search: 'incline zercher sledge' })).toHaveLength(0);
  });

  it('normalises DB/BB/KB abbreviations for comparison', () => {
    expect(normalizeExerciseName('DB curl')).toBe(normalizeExerciseName('Dumbbell curl'));
    expect(normalizeExerciseName('BB row')).toBe(normalizeExerciseName('Barbell row'));
    expect(filterCatalog({ search: 'db curl' }).length).toBeGreaterThan(0);
  });

  it('looks entries up by id and by name', () => {
    const entry = CATALOG[0];
    expect(findCatalogExercise(entry.id)).toBe(entry);
    expect(findCatalogExercise('does-not-exist')).toBeUndefined();
    expect(findCatalogMatchesByName('flat barbell bench press')).toHaveLength(1);
    expect(findCatalogMatchesByName('   ')).toHaveLength(0);
  });
});

describe('adoption', () => {
  it('adopts an entry into the library with provenance', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    const outcome = await adoptCatalogExercise(entry.id);

    expect(outcome.status).toBe('adopted');
    const rows = await loadExercises();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Goblet squat',
      muscleGroup: 'Quads',
      catalogId: entry.id,
    });
    // The row id is generated, never the catalog id, so a rename stays safe.
    expect(rows[0].id).not.toBe(entry.id);
  });

  it('prevents duplicate adoption', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    const first = await adoptCatalogExercise(entry.id);
    const second = await adoptCatalogExercise(entry.id);

    expect(first.status).toBe('adopted');
    expect(second.status).toBe('already-adopted');
    expect(await loadExercises()).toHaveLength(1);
  });

  it('refuses to duplicate a hand-typed exercise with the same name', async () => {
    await createExercise('Goblet squat', 'legs');
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;

    const outcome = await adoptCatalogExercise(entry.id);
    expect(outcome.status).toBe('name-taken');
    // Nothing was overwritten and nothing was added.
    const rows = await loadExercises();
    expect(rows).toHaveLength(1);
    expect(rows[0].muscleGroup).toBe('legs');
    expect(rows[0].catalogId).toBeUndefined();
  });

  it('adopts despite a name clash only when the caller confirms', async () => {
    await createExercise('Goblet squat', 'legs');
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;

    const outcome = await adoptCatalogExercise(entry.id, {
      confirmNameCollision: () => true,
    });

    expect(outcome.status).toBe('adopted');
    const rows = await loadExercises();
    expect(rows).toHaveLength(2);
    // The user's original row is untouched.
    expect(rows.find((row) => row.catalogId === undefined)?.muscleGroup).toBe('legs');
  });

  it('finds an adopted row by catalog id even after a rename', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    const adopted = await adoptCatalogExercise(entry.id);
    if (adopted.status !== 'adopted') throw new Error('expected adoption');

    await renameExercise(adopted.exercise.id, 'Goblet squat (tempo)');

    const found = await findExistingForCatalog(entry.id);
    expect(found?.id).toBe(adopted.exercise.id);
    expect(found?.name).toBe('Goblet squat (tempo)');
    expect(found?.catalogId).toBe(entry.id);

    // Re-adopting after a rename must not create a second row.
    expect((await adoptCatalogExercise(entry.id)).status).toBe('already-adopted');
    expect(await loadExercises()).toHaveLength(1);
  });

  it('lets a deleted entry reappear as a suggestion, with no tombstone', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    const adopted = await adoptCatalogExercise(entry.id);
    if (adopted.status !== 'adopted') throw new Error('expected adoption');

    await deleteExercise(adopted.exercise.id);
    expect(await loadExercises()).toHaveLength(0);
    expect(await findExistingForCatalog(entry.id)).toBeUndefined();

    // Adoption works again, and no bookkeeping row was written.
    expect((await adoptCatalogExercise(entry.id)).status).toBe('adopted');
    expect(await loadExercises()).toHaveLength(1);
    expect(await db.settings.count()).toBe(0);
  });

  it('rejects an unknown catalog id', async () => {
    await expect(adoptCatalogExercise('nope-nope-nope')).rejects.toThrow(/Unknown catalog/);
  });
});

describe('library versus today', () => {
  it('adds to today without adopting', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    const transient = catalogEntryToExercise(entry);

    await addExerciseToDay(DATE, transient, 'universal');

    // The day has it...
    const day = await loadDay(DATE);
    expect(day.exercises).toHaveLength(1);
    expect(day.exercises[0].exerciseName).toBe('Goblet squat');

    // ...but the personal library is still empty: separate actions.
    expect(await loadExercises()).toHaveLength(0);
  });

  it('adopts into the library without touching today', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    await adoptCatalogExercise(entry.id);

    const day = await loadDay(DATE);
    expect(day.day).toBeNull();
    expect(day.exercises).toHaveLength(0);
    expect(await loadExercises()).toHaveLength(1);
  });

  it('never writes to the database while browsing', async () => {
    // Opening the picker and filtering is pure module work.
    filterCatalog({ search: 'squat', library: 'gym', category: 'Quads', level: 'B' });
    filterCatalog({ library: 'home' });
    findCatalogExercise(CATALOG[0].id);

    expect(await db.exercises.count()).toBe(0);
    expect(await db.workoutExercises.count()).toBe(0);
    expect(await db.workoutDays.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
  });
});

describe('custom name collisions', () => {
  it('reports a library collision and a catalog match separately', async () => {
    await createExercise('Flat barbell bench press', 'chest');

    const collisions = await findNameCollisions('flat barbell bench press');
    expect(collisions.library?.name).toBe('Flat barbell bench press');
    expect(collisions.catalog.map((entry) => entry.name)).toEqual(['Flat barbell bench press']);
  });

  it('detects a catalog collision for a name the user has not created yet', async () => {
    const collisions = await findNameCollisions('Conventional deadlift');
    expect(collisions.library).toBeUndefined();
    expect(collisions.catalog).toHaveLength(1);
    expect(collisions.catalog[0].library).toBe('gym');
  });

  it('says nothing for an empty or unique name', async () => {
    expect(await findNameCollisions('   ')).toEqual({ library: undefined, catalog: [] });
    const collisions = await findNameCollisions('My Very Own Lift');
    expect(collisions.library).toBeUndefined();
    expect(collisions.catalog).toHaveLength(0);
  });
});

/**
 * The catalog must not disturb what already worked. These pin the Phase 4/5
 * behaviours the new code sits next to: history durability and PR derivation.
 */
describe('history and PR behaviour are unchanged', () => {
  it('keeps a logged catalog exercise in history after the library row is deleted', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    const adopted = await adoptCatalogExercise(entry.id);
    if (adopted.status !== 'adopted') throw new Error('expected adoption');

    await addExerciseToDay(DATE, adopted.exercise, 'universal');
    const logged = await loadDay(DATE);

    await deleteExercise(adopted.exercise.id);

    const after = await loadDay(DATE);
    expect(after.exercises).toHaveLength(1);
    expect(after.exercises[0]).toMatchObject({
      exerciseId: adopted.exercise.id,
      exerciseName: 'Goblet squat',
      sets: logged.exercises[0].sets,
    });
  });

  it('still derives a PR from sets logged for an adopted catalog exercise', async () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    const adopted = await adoptCatalogExercise(entry.id);
    if (adopted.status !== 'adopted') throw new Error('expected adoption');

    const session = await addExerciseToDay(DATE, adopted.exercise, 'universal');
    await updateSet(session.sets[0].id, { weightKg: 40, completed: true });

    const pr = await getPRsForExercise(adopted.exercise.id);
    expect(pr.current?.weightKg).toBe(40);
    expect(pr.trophySetIds).toContain(session.sets[0].id);
  });

  it('does not create catalog rows when a workout is logged from the library', async () => {
    const own = await createExercise('My Lift');
    await addExerciseToDay(DATE, own, 'universal');

    const rows = await loadExercises();
    expect(rows).toHaveLength(1);
    expect(rows[0].catalogId).toBeUndefined();
  });
});
