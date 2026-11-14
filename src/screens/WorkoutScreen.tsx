import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AddExercise from '../components/AddExercise';
import ExerciseBlock from '../components/ExerciseBlock';
import IntensityPicker from '../components/IntensityPicker';
import {
  addExerciseToDay,
  addSetsToExercise,
  updateSessionName,
  deleteSet,
  loadDay,
  removeExerciseFromDay,
  reorderExercises,
  updateSet,
} from '../db/workout';
import type { SessionExercise } from '../db/workout';
import type { TogglePatch } from '../components/SetRow';
import { createExercise, deleteExercise, loadExercises, renameExercise } from '../db/exercises';
import {
  adoptCatalogExercise,
  catalogEntryToExercise,
  findNameCollisions,
} from '../db/exerciseCatalog';
import { CATALOG, type CatalogExercise } from '../lib/exerciseCatalog';
import { getPRsForExercises } from '../db/personalRecords';
import { loadWeightUnit, setWeightUnit } from '../db/settings';
import { findIntensity } from '../lib/intensity';
import type { IntensityId } from '../lib/intensity';
import { normalizeExerciseName } from '../lib/exerciseCatalog';
import { formatDateLabel } from '../lib/month';
import type { ExercisePR } from '../lib/pr';
import type { Exercise, WorkoutSet } from '../types';

/**
 * Merge a *whole-day* records read into the map.
 *
 * `getPRsForExercises` rebuilds its result on every read, so without this each
 * refresh produced an entirely new map of new objects and every memoised block
 * re-rendered even though no record had changed. Unchanged exercises keep their
 * previous identity, so their blocks compare equal and skip rendering. When
 * nothing at all changed the previous map itself is returned, which makes the
 * whole update a no-op.
 *
 * A whole-day read answers for every exercise in the day, so its map is the
 * day's key set: an exercise it no longer holds is dropped. The one exception is
 * an exercise a *newer* read spoke about -- a targeted read that was issued after
 * this one. That entry is left exactly as it is, because this read's answer for
 * it is the older one and must not overwrite it.
 */
function mergeFullPrs(
  previous: ReadonlyMap<string, ExercisePR>,
  next: ReadonlyMap<string, ExercisePR>,
  isSuperseded: (exerciseId: string) => boolean,
): ReadonlyMap<string, ExercisePR> {
  let changed = false;
  const merged = new Map<string, ExercisePR>();

  for (const [exerciseId, pr] of next) {
    const prior = previous.get(exerciseId);
    if (isSuperseded(exerciseId)) {
      if (prior !== undefined) merged.set(exerciseId, prior);
      continue;
    }
    if (prior !== undefined && samePr(prior, pr)) {
      merged.set(exerciseId, prior);
      continue;
    }
    merged.set(exerciseId, pr);
    changed = true;
  }

  for (const [exerciseId, pr] of previous) {
    if (merged.has(exerciseId)) continue;
    if (isSuperseded(exerciseId)) {
      merged.set(exerciseId, pr);
      continue;
    }
    // Absent from a whole-day read means the exercise left the day, or its lookup
    // failed: either way the map stays the day's key set, as before.
    changed = true;
  }

  return changed ? merged : previous;
}

/**
 * The map without the entries a failed whole-day read covers.
 *
 * A failed whole-day read answers "show nothing" for the day, exactly as before.
 * The exception is again an exercise a newer read spoke about: that read owns the
 * entry, so this failure must not take it away.
 */
function dropFullPrs(
  previous: ReadonlyMap<string, ExercisePR>,
  isSuperseded: (exerciseId: string) => boolean,
): ReadonlyMap<string, ExercisePR> {
  let changed = false;
  const merged = new Map<string, ExercisePR>();

  for (const [exerciseId, pr] of previous) {
    if (isSuperseded(exerciseId)) {
      merged.set(exerciseId, pr);
      continue;
    }
    changed = true;
  }

  return changed ? merged : previous;
}

/**
 * Merge a *targeted* records read into the map.
 *
 * The read answered for a single exercise, so every other entry is carried over
 * exactly as it was -- same object, same position. That is what keeps the blocks
 * for the untouched exercises comparing equal, and it is what a full refresh
 * cannot offer on its own, because a full read's map only contains the exercises
 * it happened to ask about.
 *
 * When the affected exercise's record did not actually move, its previous object
 * is kept too, so an edit that changes no record is a no-op render. As with
 * `mergeFullPrs`, the previous map itself is returned when nothing changed at all.
 */
function mergeTargetedPrs(
  previous: ReadonlyMap<string, ExercisePR>,
  next: ReadonlyMap<string, ExercisePR>,
): ReadonlyMap<string, ExercisePR> {
  let changed = false;
  const merged = new Map(previous);

  for (const [exerciseId, pr] of next) {
    const prior = previous.get(exerciseId);
    if (prior !== undefined && samePr(prior, pr)) continue;
    merged.set(exerciseId, pr);
    changed = true;
  }

  return changed ? merged : previous;
}

/**
 * The map without one exercise's record.
 *
 * A targeted read that fails is answered with "no record" for the exercise it
 * asked about -- the same answer a failed lookup gave before the split, because
 * absence from the map is how the UI shows nothing rather than something stale.
 * Every unrelated entry is left untouched.
 */
function withoutPr(
  previous: ReadonlyMap<string, ExercisePR>,
  exerciseId: string,
): ReadonlyMap<string, ExercisePR> {
  if (!previous.has(exerciseId)) return previous;

  const merged = new Map(previous);
  merged.delete(exerciseId);
  return merged;
}

/**
 * One PR value is unchanged when the same sets hold the same records.
 *
 * Compared field by field rather than by reference, because the engine returns
 * fresh objects every read. Only what the UI can display is compared: the
 * current PR, the trophy set ids, and the achievement holders behind the badges
 * and the record summary.
 */
function samePr(a: ExercisePR, b: ExercisePR): boolean {
  if (a === b) return true;
  if (a.exerciseName !== b.exerciseName) return false;
  if (a.current?.setId !== b.current?.setId) return false;
  if (a.current?.weightKg !== b.current?.weightKg) return false;
  if (a.history.length !== b.history.length) return false;
  if (a.trophySetIds.length !== b.trophySetIds.length) return false;
  for (let index = 0; index < a.trophySetIds.length; index += 1) {
    if (a.trophySetIds[index] !== b.trophySetIds[index]) return false;
  }

  const left = a.achievements;
  const right = b.achievements;
  if (left === undefined || right === undefined) return left === right;
  return (
    left.weight?.setId === right.weight?.setId &&
    left.weight?.weightKg === right.weight?.weightKg &&
    left.estimatedOneRepMax?.setId === right.estimatedOneRepMax?.setId &&
    left.maxReps?.setId === right.maxReps?.setId &&
    left.volume?.workoutExerciseId === right.volume?.workoutExerciseId &&
    left.volume?.volumeKg === right.volume?.volumeKg &&
    left.setCount === right.setCount
  );
}

/**
 * The PR map of a visit that has not read any records yet. Shared and never
 * mutated: `merge*`/`drop*`/`withoutPr` all return a new map, so this one stays
 * empty and every visit that has read nothing shares it.
 */
const NO_PRS: ReadonlyMap<string, ExercisePR> = new Map();

/**
 * The records state: a PR map *stamped* with the date and visit it was read for.
 *
 * The stamp is what makes staleness a property of the value rather than a property
 * of when some effect happened to run. A render shows the map only when the stamp
 * matches the date and visit that render is displaying, so a transition can never
 * show records read for another date -- not in the commit that switches dates, not
 * before a passive effect has fired, not ever -- and returning to a date later
 * cannot resurrect the map of an earlier visit of it.
 */
interface PrLayer {
  date: string;
  visit: number;
  prs: ReadonlyMap<string, ExercisePR>;
}

/**
 * Logging screen for one local date.
 *
 * Everything is written straight through Dexie; the exercise *library* and the
 * *session* rows are updated separately so a rename here only rewrites the
 * library, while this workout keeps the name it was performed under.
 */
export default function WorkoutScreen({ date, onBack }: { date: string; onBack: () => void }) {
  const [dayId, setDayId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<readonly SessionExercise[]>([]);
  const [library, setLibrary] = useState<readonly Exercise[]>([]);
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [intensity, setIntensity] = useState<IntensityId>('universal');
  /**
   * Personal records keyed by exercise id, never by session id: one exercise can
   * appear twice in a day, and both blocks then show the same current PR -- and
   * stamped with the visit that read them, so a map can be recognised as stale
   * without consulting anything but itself (see `PrLayer`).
   */
  const [prLayer, setPrLayer] = useState<PrLayer>(() => ({ date, visit: 0, prs: NO_PRS }));

  /**
   * Monotonic tickets, one per independently refreshed slice. A slower, older
   * refresh must never write over a newer one, which is why every async result
   * checks its own ticket before touching state.
   *
   * The two slices are separate on purpose. A set write only changes the day, and
   * an adoption only changes the library, so their refreshes are independent: with
   * one shared counter, a library refresh that landed mid-flight would bump the
   * ticket of a day read that is still loading and discard its result, and the
   * reverse. Two counters keep each slice's stale-result protection strict
   * without letting the slices invalidate each other.
   */
  const dayGeneration = useRef(0);
  const libraryGeneration = useRef(0);

  /**
   * Per-exercise tickets for the records slice: the sequence number of the newest
   * read that asked about that exercise, in `prGeneration`, and the counter behind
   * them.
   *
   * One day-wide ticket cannot police the records map any more. A set write only
   * re-reads the exercise it moved, so a refresh no longer speaks for the whole
   * day: discarding a superseded refresh wholesale would throw away a valid answer
   * that nothing else re-read, and a just-set record would never show its trophy
   * because an unrelated exercise's write happened to start in the meantime.
   *
   * So each records read registers itself for exactly the exercises it asks
   * about, and may only write those whose newest ticket is still its own. A
   * whole-day read registers for every exercise in the day, which is what lets it
   * invalidate older targeted results; a targeted read registers for one, which is
   * why it cannot invalidate a different exercise's answer. The newest read for an
   * exercise still wins, so a slow older answer can never overwrite a newer one.
   *
   * Tickets are taken when the records read is issued rather than when the refresh
   * starts, because the day read decides which exercises that read covers.
   */
  const prGeneration = useRef(new Map<string, number>());
  const prSequence = useRef(0);

  /**
   * The monotonically increasing visit token: one per date transition, including a
   * return to a date that was shown before.
   *
   * The per-exercise tickets above order reads *within* a visit. They cannot order
   * them across one, because the new visit never registers the exercises the old
   * one had: a targeted read for an exercise the new day does not hold would never
   * be superseded, and would insert its record into a day that does not contain
   * that exercise.
   *
   * A date string cannot stand in for this either. Visiting A, then B, then A again
   * puts the same string back in state, so a read issued during the *first* visit
   * of A would look current again during the third -- and while that visit's own
   * records read is still in flight, nothing has registered the exercise yet, so no
   * ticket would reject it. Every date transition therefore starts a new visit.
   *
   * The token is bumped in the layout effect below, never during render: a render
   * React discards must not invalidate a visit that is still on screen. Because a
   * layout effect runs inside the commit that first shows the new date -- before
   * paint and before the load effect can issue this visit's reads -- the bump is
   * atomic with that commit, so there is no window in which an old answer is
   * applied under a token that is already out of date.
   */
  const prVisit = useRef(0);

  /**
   * The records this render may display.
   *
   * Derived, not stored: the layer is accepted only while it is stamped with the
   * date on screen *and* the visit that is current now. This is a comparison, not a
   * mutation, so it is safe in any render -- and it is what guarantees that the
   * commit which switches dates already shows no records from the previous one,
   * independent of when (or whether) any effect has run. An effect can only ever
   * make the state agree with what this line already shows.
   */
  const prs = prLayer.date === date && prLayer.visit === prVisit.current ? prLayer.prs : NO_PRS;

  /**
   * Catalog entries the library already covers, for the picker's "In library"
   * state. Derived from the loaded rows on every render rather than stored, so
   * it needs no extra state and cannot drift: adopting or deleting refreshes the
   * library and the badges follow.
   */
  const adoptedCatalogIds = useMemo(() => {
    const byName = new Map(library.map((row) => [normalizeExerciseName(row.name), row]));
    const ids = new Set<string>();

    for (const row of library) {
      if (row.catalogId !== undefined) ids.add(row.catalogId);
    }
    // A row typed by hand before the catalog existed still covers the entry.
    for (const entry of CATALOG) {
      if (byName.has(normalizeExerciseName(entry.name))) ids.add(entry.id);
    }
    return ids;
  }, [library]);

  /**
   * Day data and records: the sessions of `date` and the PRs for the exercises
   * they use. This is everything a set write can change.
   *
   * `affectedExerciseId` names the one exercise a set write can have moved. PRs
   * are per exercise -- `computeExercisePrView` reads nothing but that exercise's
   * own history -- so when the caller knows which exercise changed, only that
   * exercise's records are re-read, and the batch still answers from the same
   * three shared queries, just over one history instead of every history in the
   * day.
   *
   * Nothing is passed for a change that can move more than one exercise's
   * records: mount, a date change, attaching or removing an exercise, reordering
   * a day, or renaming a session row. An id that is no longer part of the day
   * also falls back to the full read rather than answering for an exercise the
   * day does not have.
   */
  const refreshDay = useCallback((affectedExerciseId?: string) => {
    const ticket = ++dayGeneration.current;

    void loadDay(date).then((details) => {
      if (ticket !== dayGeneration.current) return;
      // Committed as soon as the day read lands, exactly as before: the exercise
      // list must never wait on the PR reads.
      setDayId(details.day?.id ?? null);
      setSessions(details.exercises);

      /*
       * One PR read, keyed by distinct exercise rather than by session row: the
       * batch answers every exercise it is given from three shared queries and
       * isolates failures per exercise internally.
       */
      const exerciseIds = [...new Set(details.exercises.map((session) => session.exerciseId))];

      /*
       * The targeted case is decided from the freshly read day, so a stale id
       * cannot narrow the read to an exercise that is gone: the day read above is
       * the authority on what the day holds right now.
       */
      const targetedId =
        affectedExerciseId !== undefined && exerciseIds.includes(affectedExerciseId)
          ? affectedExerciseId
          : undefined;
      const requested = targetedId === undefined ? exerciseIds : [targetedId];

      /*
       * Register this read for the exercises it asks about. Only the newest read
       * for an exercise may write its entry, which is the per-exercise equivalent
       * of the day ticket above: a newer read for the *same* exercise still wins,
       * while a newer read for a *different* exercise leaves this one alone.
       *
       * A whole-day read registers for every exercise in the day, so it
       * invalidates older targeted results for all of them; a targeted read
       * registers for one, so it can never invalidate another exercise's answer.
       */
      const prTicket = ++prSequence.current;
      for (const exerciseId of requested) prGeneration.current.set(exerciseId, prTicket);
      const isSuperseded = (exerciseId: string): boolean =>
        (prGeneration.current.get(exerciseId) ?? 0) > prTicket;

      /*
       * The visit this read is issued under. It is captured here, at the point the
       * read starts, so it names the visit whose map the answer may write to --
       * not whichever visit happens to be on screen when the answer arrives.
       */
      const visit = prVisit.current;
      const isThisVisit = (): boolean => prVisit.current === visit;

      /*
       * A failed exercise is absent from the map, so the UI shows no PR rather
       * than a stale one, and logging keeps working either way. The read is not
       * expected to reject -- it falls back to per-exercise reads first -- but a
       * rejection is handled rather than left floating.
       *
       * A whole-day read's map *is* the day's key set, so a rejection there drops
       * every record it covers, which is the same "show nothing" answer a failed
       * lookup gives today. A targeted read only speaks for one exercise, so a
       * rejection drops that one record and leaves the rest of the map alone: one
       * failed lookup must never cost an unrelated exercise its PR.
       *
       * Every commit is gated twice by the visit. The outer check keeps an answer
       * that is already stale from queueing an update at all; the check inside the
       * updater is the authority, because the date can still change between the
       * two -- the updater is applied later, in a render React schedules, and by
       * then the map it is handed may belong to a different visit.
       *
       * A superseded answer is skipped rather than committed: its entry belongs to
       * the newer read now, and both helpers above keep the entries a newer read
       * spoke about. Keeping the previous map when nothing actually changed means
       * the commit is a no-op render, and the memoised blocks below then skip in
       * one comparison instead of re-rendering the whole tree for identical data.
       */
      void getPRsForExercises(requested).then(
        (next) => {
          if (!isThisVisit()) return;
          setPrLayer((layer) => {
            /*
             * Apply-time authority, checked against the *state*, not only against
             * the ref: an answer is merged into the layer of the visit that issued
             * the read, and nowhere else. `layer.visit !== visit` rejects an update
             * React applies after the visit was replaced (the layer has been
             * restamped by then); the token check rejects one whose visit the ref
             * has already left behind. A rejected update returns the layer itself,
             * so it stays a no-op render.
             */
            if (!isThisVisit() || layer.visit !== visit) return layer;
            const merged =
              targetedId === undefined
                ? mergeFullPrs(layer.prs, next, isSuperseded)
                : isSuperseded(targetedId)
                  ? layer.prs
                  : mergeTargetedPrs(layer.prs, next);
            return merged === layer.prs ? layer : { ...layer, prs: merged };
          });
        },
        () => {
          if (!isThisVisit()) return;
          setPrLayer((layer) => {
            if (!isThisVisit() || layer.visit !== visit) return layer;
            const next =
              targetedId === undefined
                ? dropFullPrs(layer.prs, isSuperseded)
                : isSuperseded(targetedId)
                  ? layer.prs
                  : withoutPr(layer.prs, targetedId);
            return next === layer.prs ? layer : { ...layer, prs: next };
          });
        },
      );
    });
  }, [date]);

  /**
   * The exercise library, and nothing else.
   *
   * Only a library mutation can change these rows: adopting, creating, renaming
   * or deleting an exercise. Set writes, session renames and day loads cannot, so
   * they no longer pay for this read, for the 318-entry adoption recompute above,
   * or for re-rendering the memoised `AddExercise` picker -- its props stay
   * identity-stable across a day-only refresh, which is what the `useCallback`s
   * further down provide.
   *
   * The Library list in this screen is deliberately *not* memoised, so it can
   * still re-render with `WorkoutScreen`; this split claims only the read, the
   * adoption recompute and the picker.
   */
  const refreshLibrary = useCallback(() => {
    const ticket = ++libraryGeneration.current;

    void loadExercises().then((rows) => {
      if (ticket !== libraryGeneration.current) return;
      setLibrary(rows);
    });
  }, []);

  /*
   * A date change starts a new visit: the token moves, and the layer is restamped
   * with the new date and token, empty. Every records read still in flight for the
   * previous visit -- including one issued during an earlier visit of this same
   * date -- is thereby invalid, before this visit's own read is issued below.
   *
   * This is a *layout* effect, so it runs inside the commit that first shows the
   * new date: before the browser paints and before the load effect can issue this
   * visit's reads. A passive effect would leave a window in which the token still
   * names the previous visit while the new date is already on screen.
   *
   * The window is closed twice over. The displayed map is derived per render from
   * the layer's stamp (`prs` above), so the commit showing the new date already
   * shows no records from the old one, whatever any effect has done. This effect
   * then brings the *state* in line with that render, so merges from the new
   * visit land in a layer stamped for it, and the previous visit's map -- possibly
   * polluted by an answer that arrived during the switch -- is dropped instead of
   * being retained.
   */
  useLayoutEffect(() => {
    prVisit.current += 1;
    setPrLayer((layer) =>
      layer.date === date && layer.visit === prVisit.current
        ? layer
        : { date, visit: prVisit.current, prs: NO_PRS },
    );
  }, [date]);

  // Mount and date changes load both slices: the day is `date`-scoped, and the
  // library is loaded for the screen. A date change re-reads both, as before.
  useEffect(() => {
    refreshDay();
    refreshLibrary();
  }, [refreshDay, refreshLibrary]);

  useEffect(() => {
    void loadWeightUnit().then(setUnit);
  }, []);

  const preset = findIntensity(intensity);

  /**
   * Attach an exercise to the day. This writes `workoutExercises` and
   * `workoutSets` only, so the day refresh is the whole refresh -- the library
   * cannot have changed here. `create` refreshes the library separately when it
   * is the path that actually added a library row.
   */
  const attach = useCallback(
    async (exercise: Exercise): Promise<void> => {
      await addExerciseToDay(date, exercise, intensity);
      refreshDay();
    },
    [date, intensity, refreshDay],
  );

  /**
   * Create a custom exercise, refusing to silently duplicate one that already
   * exists. A name clash with the library or with a built-in catalog entry asks
   * first; declining returns to the form with the name kept in place.
   *
   * `date` and `intensity` reach `addExerciseToDay` through `attach`, whose
   * identity already carries them, so this callback cannot attach to a stale day.
   */
  const create = useCallback(
    async (name: string, muscleGroup: string): Promise<void> => {
      const collisions = await findNameCollisions(name);

      if (collisions.library !== undefined) {
        const reuse = window.confirm(
          `"${collisions.library.name}" is already in your library. Add it to today instead of creating a duplicate?`,
        );
        if (!reuse) return;
        await attach(collisions.library);
        return;
      }

      const catalogMatch = collisions.catalog[0];
      if (catalogMatch !== undefined) {
        const adopt = window.confirm(
          `"${catalogMatch.name}" is already in the built-in catalog. Add that one to today instead of creating a custom copy?`,
        );
        if (!adopt) return;
        await attach(catalogEntryToExercise(catalogMatch));
        return;
      }

      await attach(await createExercise(name, muscleGroup));
      // This path did add a library row, so the Library list and the picker's
      // "In library" badges have to hear about it. The other two paths above
      // attach an existing or transient exercise and change no library row.
      refreshLibrary();
    },
    [attach, refreshLibrary],
  );

  /** Library-only: adopt a catalog suggestion without touching today's workout. */
  const adoptFromCatalog = useCallback(
    async (entry: CatalogExercise): Promise<void> => {
      const outcome = await adoptCatalogExercise(entry.id, {
        confirmNameCollision: (existing) =>
          window.confirm(
            `"${existing.name}" already exists in your library. Save this catalog exercise as a separate entry anyway?`,
          ),
      });

      if (outcome.status === 'name-taken') {
        console.warn('Adoption cancelled: name already taken', entry.name);
      }
      // Adoption writes `exercises` only, so the day is untouched.
      refreshLibrary();
    },
    [refreshLibrary],
  );

  /** Today-only: log a catalog suggestion without adopting it into the library. */
  const addCatalogToToday = useCallback(
    async (entry: CatalogExercise): Promise<void> => {
      // Deliberately no library refresh: logging a suggestion is not adopting it.
      await attach(catalogEntryToExercise(entry));
    },
    [attach],
  );

  /** The picker's "add an existing library row to today" action. */
  const addLibraryExercise = useCallback(
    (exercise: Exercise): void => {
      void attach(exercise);
    },
    [attach],
  );

  /**
   * Flip completion, recording any unsaved weight draft in the same write.
   *
   * Exactly one `updateSet` and one `refresh`: the weight is in the database
   * before the row is re-rendered, so a typed value is never dropped by the
   * refresh that follows a toggle. The promise rejects if the write fails, which
   * is how `SetRow` knows not to treat the draft as saved.
   *
   * `exerciseId` is the exercise that owns the row, so the refresh that follows
   * re-reads that one exercise's records instead of the whole day's.
   */
  const toggle = useCallback(async (setId: string, exerciseId: string, completed: boolean, patch?: TogglePatch): Promise<void> => {
    const next = { completed: !completed, ...patch };
    try {
      await updateSet(setId, next);
    } catch (error) {
      // Logging must keep working even if this row could not be written.
      console.error('Could not update set', setId, error);
      return;
    }
    refreshDay(exerciseId);
  }, [refreshDay]);

  /**
   * Persist a non-toggle patch (blur commits, reps). Resolves only after the
   * write and the refresh, and rejects when the write fails so the caller can
   * keep the value pending instead of pretending it was saved.
   *
   * `exerciseId` is `undefined` only when the row could not be traced back to a
   * session in the current day; the refresh then falls back to the whole day,
   * which is always correct even if it is not the cheapest answer.
   */
  const patchSet = useCallback(async (setId: string, exerciseId: string | undefined, patch: { weightKg?: number | null; reps?: number | null }): Promise<void> => {
    try {
      await updateSet(setId, patch);
    } catch (error) {
      console.error('Could not save set weight', setId, error);
      throw error;
    }
    refreshDay(exerciseId);
  }, [refreshDay]);

  function changeUnit(next: 'kg' | 'lb'): void {
    setUnit(next);
    void setWeightUnit(next);
  }

  /*
   * Identity-stable handlers for the memoised children.
   *
   * A refresh replaces `sessions` and `prs`. If the block and row callbacks were
   * rebuilt when that happened, `memo` could never bail out and the whole tree
   * would re-render on every data update. So the callbacks here are created once
   * and read the live data from `live` at call time; the per-session handler
   * objects are then cached by session id and never change.
   *
   * `live` is assigned during render so a handler always sees the newest values;
   * it is only ever read inside event handlers, never during render.
   */
  const live = useRef({ sessions, dayId });
  live.current = { sessions, dayId };

  /*
   * The current intensity's minimum reps, read through a ref for the same reason
   * as `live`.
   *
   * `actions` is memoised and the per-session handler bundles are cached by
   * session id, so a handler never closes over a later render. `addSet` needs the
   * preset that applies *now*, not the one in force when the bundle was created:
   * a row with no note falls back to `repMin`, and switching intensity after the
   * bundle was cached must still write the new rep count.
   */
  const liveRepMin = useRef(preset.repMin);
  liveRepMin.current = preset.repMin;

  const actions = useMemo(() => {
    const findSession = (sessionId: string): SessionExercise | undefined =>
      live.current.sessions.find((session) => session.id === sessionId);

    /**
     * The exercise that owns a set row, read from the live day.
     *
     * A set write moves the records of exactly one exercise, and this is how the
     * set-id-only handlers below name it without closing over a render: the
     * bundles are cached by session id and outlive the render they were built in,
     * which is why `live` exists at all.
     */
    const exerciseIdForSet = (setId: string): string | undefined => {
      for (const session of live.current.sessions) {
        if (session.sets.some((row) => row.id === setId)) return session.exerciseId;
      }
      return undefined;
    };

    return {
      move(sessionId: string, direction: -1 | 1): void {
        const { sessions: current, dayId: currentDayId } = live.current;
        const index = current.findIndex((session) => session.id === sessionId);
        const target = index + direction;
        if (index === -1 || !currentDayId || target < 0 || target >= current.length) return;

        const order = current.map((session) => session.id);
        [order[index], order[target]] = [order[target], order[index]];
        /*
         * A move rewrites `order` on two session rows, and that position is part
         * of the PR ordering, so both exercises' records are re-read: no
         * affected-exercise id is passed.
         */
        void reorderExercises(currentDayId, order).then(() => refreshDay());
      },

      rename(sessionId: string, name: string): void {
        // The record's name comes from the session snapshot, so a whole-day
        // refresh is the honest answer here as well.
        void updateSessionName(sessionId, name).then(() => refreshDay());
      },

      remove(sessionId: string): void {
        // Removing a session drops an exercise from the day: every remaining
        // exercise's entry has to be reconciled.
        void removeExerciseFromDay(sessionId).then(() => refreshDay());
      },

      addSet(sessionId: string): void {
        const session = findSession(sessionId);
        if (session === undefined) return;
        // Read through the ref: this handler outlives the preset it was built
        // with, so `preset.repMin` here would be the value from that render.
        const { current: repMin } = liveRepMin;
        const reps = session.note === undefined ? repMin : (session.sets[0]?.reps ?? repMin);
        void addSetsToExercise(session.id, 1, reps).then(() => refreshDay(session.exerciseId));
      },

      changeSet(setId: string, patch: { weightKg?: number | null; reps?: number | null }): Promise<void> {
        return patchSet(setId, exerciseIdForSet(setId), patch);
      },

      toggleSet(setId: string, patch?: TogglePatch): Promise<void> {
        for (const session of live.current.sessions) {
          const set = session.sets.find((row) => row.id === setId);
          if (set !== undefined) return toggle(setId, session.exerciseId, set.completed, patch);
        }
        return Promise.resolve();
      },

      deleteSet(setId: string): void {
        /*
         * Resolved before the write: once the row is deleted the live day no
         * longer holds it, and the refresh would have nothing to name.
         */
        const exerciseId = exerciseIdForSet(setId);
        void deleteSet(setId).then(() => refreshDay(exerciseId));
      },
    };
  }, [refreshDay, patchSet, toggle]);

  /**
   * The handler bundle for one session, created once per session id.
   *
   * Cached rather than rebuilt so an unchanged block receives identical props on
   * every refresh, which is what the memo comparison needs to skip it.
   */
  const handlerCache = useRef(
    new Map<
      string,
      {
        move: (direction: -1 | 1) => void;
        rename: (name: string) => void;
        remove: () => void;
        addSet: () => void;
        changeSet: (setId: string, patch: { weightKg?: number | null; reps?: number | null }) => Promise<void>;
        toggleSet: (setId: string, patch?: TogglePatch) => Promise<void>;
        deleteSet: (setId: string) => void;
      }
    >(),
  );

  const handlersFor = useCallback(
    (sessionId: string) => {
      const cached = handlerCache.current.get(sessionId);
      if (cached !== undefined) return cached;

      const created = {
        move: (direction: -1 | 1) => actions.move(sessionId, direction),
        rename: (name: string) => actions.rename(sessionId, name),
        remove: () => actions.remove(sessionId),
        addSet: () => actions.addSet(sessionId),
        changeSet: actions.changeSet,
        toggleSet: actions.toggleSet,
        deleteSet: actions.deleteSet,
      };
      handlerCache.current.set(sessionId, created);
      return created;
    },
    [actions],
  );

  const totalSets = sessions.reduce((sum, session) => sum + session.sets.length, 0);
  const completedSets = sessions.reduce(
    (sum, session) => sum + session.sets.filter((set: WorkoutSet) => set.completed).length,
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] rounded-xl px-2 text-sm text-slate-400 ring-1 ring-inset ring-slate-800 hover:text-emerald-300 hover:ring-emerald-500/40"
        >
          ‹ Calendar
        </button>

        <div className="flex rounded-xl ring-1 ring-inset ring-slate-800">
          {(['kg', 'lb'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={unit === value}
              onClick={() => changeUnit(value)}
              className={`min-h-[44px] px-3 text-xs font-semibold first:rounded-l-xl last:rounded-r-xl ${
                unit === value ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-500'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </header>

      <div>
        <h1 className="text-lg font-bold text-slate-50">{formatDateLabel(date)}</h1>
        <p className="text-[11px] text-slate-500">
          {sessions.length} exercises · <span className="text-emerald-400/80">{completedSets}/{totalSets} sets done</span>
        </p>
      </div>

      <IntensityPicker value={intensity} onChange={setIntensity} />

      {sessions.map((session, index) => {
        const handlers = handlersFor(session.id);
        const pr = prs.get(session.exerciseId) ?? null;

        return (
          <ExerciseBlock
            key={session.id}
            session={session}
            index={index}
            total={sessions.length}
            unit={unit}
            intensity={intensity}
            pr={pr}
            /* Hoisted from the block, so this prop is a primitive and the block
               never compares ids while rendering. */
            isVolumeRecordHere={pr?.achievements?.volume?.workoutExerciseId === session.id}
            onMove={handlers.move}
            onRename={handlers.rename}
            onDeleteExercise={handlers.remove}
            onAddSet={handlers.addSet}
            onChangeSet={handlers.changeSet}
            onToggleSet={handlers.toggleSet}
            onDeleteSet={handlers.deleteSet}
          />
        );
      })}

      {sessions.length === 0 ? (
        <p className="rounded-2xl bg-slate-900/50 p-4 text-xs text-slate-500 ring-1 ring-inset ring-slate-800">
          No exercises logged yet. Pick an intensity, then add an exercise below.
        </p>
      ) : null}

      <AddExercise
        library={library}
        adoptedCatalogIds={adoptedCatalogIds}
        onAddLibraryExercise={addLibraryExercise}
        onAddToToday={addCatalogToToday}
        onAdopt={adoptFromCatalog}
        onCreate={create}
      />

      <section className="flex flex-col gap-2 rounded-2xl bg-slate-900/50 p-3 ring-1 ring-inset ring-slate-800">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Library</h3>
        <ul className="flex flex-col gap-1">
          {library.map((exercise) => (
            <li key={exercise.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate text-slate-300">{exercise.name}</span>
              <button
                type="button"
                aria-label={`Rename ${exercise.name}`}
                onClick={() => void renameExercise(exercise.id, prompt('New name', exercise.name) ?? exercise.name).then(refreshLibrary)}
                className="min-h-[44px] px-2 text-slate-500 hover:text-emerald-300"
              >
                rename
              </button>
              <button
                type="button"
                aria-label={`Delete ${exercise.name}`}
                onClick={() => void deleteExercise(exercise.id).then(refreshLibrary)}
                className="min-h-[44px] px-2 text-slate-500 hover:text-rose-300"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-slate-500">
          Renaming or deleting never changes the names recorded in past workouts.
        </p>
      </section>
    </div>
  );
}