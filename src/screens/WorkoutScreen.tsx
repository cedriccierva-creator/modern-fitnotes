import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 * Reuse the previous PR value for every exercise whose records did not change.
 *
 * `getPRsForExercises` rebuilds its result on every read, so without this each
 * refresh produced an entirely new map of new objects and every memoised block
 * re-rendered even though no record had changed. Unchanged exercises keep their
 * previous identity, so their blocks compare equal and skip rendering. When
 * nothing at all changed the previous map itself is returned, which makes the
 * whole update a no-op.
 */
function mergePrs(
  previous: ReadonlyMap<string, ExercisePR>,
  next: ReadonlyMap<string, ExercisePR>,
): ReadonlyMap<string, ExercisePR> {
  let changed = previous.size !== next.size;
  const merged = new Map<string, ExercisePR>();

  for (const [exerciseId, pr] of next) {
    const prior = previous.get(exerciseId);
    if (prior !== undefined && samePr(prior, pr)) {
      merged.set(exerciseId, prior);
      continue;
    }
    merged.set(exerciseId, pr);
    changed = true;
  }

  return changed ? merged : previous;
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
   * appear twice in a day, and both blocks then show the same current PR.
   */
  const [prs, setPrs] = useState<ReadonlyMap<string, ExercisePR>>(() => new Map());

  /**
   * Monotonic ticket for the newest refresh. A slower, older refresh must never
   * write over a newer one, which is why every async result checks this before
   * touching state.
   */
  const generation = useRef(0);

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

  const refresh = useCallback(() => {
    const ticket = ++generation.current;

    void loadDay(date).then((details) => {
      if (ticket !== generation.current) return;
      // Committed as soon as the day read lands, exactly as before: the exercise
      // list must never wait on the PR reads.
      setDayId(details.day?.id ?? null);
      setSessions(details.exercises);

      // One PR read for the whole day, keyed by distinct exercise rather than by
      // session row: the batch answers every exercise from three shared queries
      // and isolates failures per exercise internally.
      const exerciseIds = [...new Set(details.exercises.map((session) => session.exerciseId))];

      /*
       * A failed exercise is absent from the map, so the UI shows no PR rather
       * than a stale one, and logging keeps working either way. The read is not
       * expected to reject -- it falls back to per-exercise reads first -- but a
       * rejection is handled rather than left floating: every record is dropped,
       * which is the same "show nothing" answer a failed lookup gives today.
       *
       * The second argument is a later commit than the day read above. Keeping
       * the previous map when nothing actually changed means it is a no-op
       * render, and the memoised blocks below then skip in one comparison
       * instead of re-rendering the whole tree for identical data.
       */
      void getPRsForExercises(exerciseIds).then(
        (next) => {
          if (ticket !== generation.current) return;
          setPrs((previous) => mergePrs(previous, next));
        },
        () => {
          if (ticket !== generation.current) return;
          setPrs((previous) => mergePrs(previous, new Map()));
        },
      );
    });

    void loadExercises().then((rows) => {
      if (ticket !== generation.current) return;
      setLibrary(rows);
    });
  }, [date]);

  // Switching dates drops the previous day's records immediately, so a slow
  // first load on the new date cannot show the old date's trophies.
  useEffect(() => {
    setPrs(new Map());
  }, [date]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    void loadWeightUnit().then(setUnit);
  }, []);

  const preset = findIntensity(intensity);

  async function attach(exercise: Exercise): Promise<void> {
    await addExerciseToDay(date, exercise, intensity);
    refresh();
  }

  /**
   * Create a custom exercise, refusing to silently duplicate one that already
   * exists. A name clash with the library or with a built-in catalog entry asks
   * first; declining returns to the form with the name kept in place.
   */
  async function create(name: string, muscleGroup: string): Promise<void> {
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
  }

  /** Library-only: adopt a catalog suggestion without touching today's workout. */
  async function adoptFromCatalog(entry: CatalogExercise): Promise<void> {
    const outcome = await adoptCatalogExercise(entry.id, {
      confirmNameCollision: (existing) =>
        window.confirm(
          `"${existing.name}" already exists in your library. Save this catalog exercise as a separate entry anyway?`,
        ),
    });

    if (outcome.status === 'name-taken') {
      console.warn('Adoption cancelled: name already taken', entry.name);
    }
    refresh();
  }

  /** Today-only: log a catalog suggestion without adopting it into the library. */
  async function addCatalogToToday(entry: CatalogExercise): Promise<void> {
    await attach(catalogEntryToExercise(entry));
  }

  /**
   * Flip completion, recording any unsaved weight draft in the same write.
   *
   * Exactly one `updateSet` and one `refresh`: the weight is in the database
   * before the row is re-rendered, so a typed value is never dropped by the
   * refresh that follows a toggle. The promise rejects if the write fails, which
   * is how `SetRow` knows not to treat the draft as saved.
   */
  const toggle = useCallback(async (setId: string, completed: boolean, patch?: TogglePatch): Promise<void> => {
    const next = { completed: !completed, ...patch };
    try {
      await updateSet(setId, next);
    } catch (error) {
      // Logging must keep working even if this row could not be written.
      console.error('Could not update set', setId, error);
      return;
    }
    refresh();
  }, [refresh]);

  /**
   * Persist a non-toggle patch (blur commits, reps). Resolves only after the
   * write and the refresh, and rejects when the write fails so the caller can
   * keep the value pending instead of pretending it was saved.
   */
  const patchSet = useCallback(async (setId: string, patch: { weightKg?: number | null; reps?: number | null }): Promise<void> => {
    try {
      await updateSet(setId, patch);
    } catch (error) {
      console.error('Could not save set weight', setId, error);
      throw error;
    }
    refresh();
  }, [refresh]);

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

    return {
      move(sessionId: string, direction: -1 | 1): void {
        const { sessions: current, dayId: currentDayId } = live.current;
        const index = current.findIndex((session) => session.id === sessionId);
        const target = index + direction;
        if (index === -1 || !currentDayId || target < 0 || target >= current.length) return;

        const order = current.map((session) => session.id);
        [order[index], order[target]] = [order[target], order[index]];
        void reorderExercises(currentDayId, order).then(refresh);
      },

      rename(sessionId: string, name: string): void {
        void updateSessionName(sessionId, name).then(refresh);
      },

      remove(sessionId: string): void {
        void removeExerciseFromDay(sessionId).then(refresh);
      },

      addSet(sessionId: string): void {
        const session = findSession(sessionId);
        if (session === undefined) return;
        // Read through the ref: this handler outlives the preset it was built
        // with, so `preset.repMin` here would be the value from that render.
        const { current: repMin } = liveRepMin;
        const reps = session.note === undefined ? repMin : (session.sets[0]?.reps ?? repMin);
        void addSetsToExercise(session.id, 1, reps).then(refresh);
      },

      changeSet(setId: string, patch: { weightKg?: number | null; reps?: number | null }): Promise<void> {
        return patchSet(setId, patch);
      },

      toggleSet(setId: string, patch?: TogglePatch): Promise<void> {
        for (const session of live.current.sessions) {
          const set = session.sets.find((row) => row.id === setId);
          if (set !== undefined) return toggle(setId, set.completed, patch);
        }
        return Promise.resolve();
      },

      deleteSet(setId: string): void {
        void deleteSet(setId).then(refresh);
      },
    };
  }, [refresh, patchSet, toggle]);

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
        onAddLibraryExercise={(exercise) => void attach(exercise)}
        onAddToToday={(entry) => void addCatalogToToday(entry)}
        onAdopt={(entry) => void adoptFromCatalog(entry)}
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
                onClick={() => void renameExercise(exercise.id, prompt('New name', exercise.name) ?? exercise.name).then(refresh)}
                className="min-h-[44px] px-2 text-slate-500 hover:text-emerald-300"
              >
                rename
              </button>
              <button
                type="button"
                aria-label={`Delete ${exercise.name}`}
                onClick={() => void deleteExercise(exercise.id).then(refresh)}
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