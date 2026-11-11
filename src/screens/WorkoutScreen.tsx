import { useCallback, useEffect, useRef, useState } from 'react';
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
import { getPRsForExercise } from '../db/personalRecords';
import { loadWeightUnit, setWeightUnit } from '../db/settings';
import { findIntensity } from '../lib/intensity';
import type { IntensityId } from '../lib/intensity';
import { formatDateLabel } from '../lib/month';
import type { ExercisePR } from '../lib/pr';
import type { Exercise, WorkoutSet } from '../types';

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

  const refresh = useCallback(() => {
    const ticket = ++generation.current;

    void loadDay(date).then((details) => {
      if (ticket !== generation.current) return;
      setDayId(details.day?.id ?? null);
      setSessions(details.exercises);

      // One PR read per distinct exercise, not per session row.
      const exerciseIds = [...new Set(details.exercises.map((session) => session.exerciseId))];

      void Promise.allSettled(exerciseIds.map((id) => getPRsForExercise(id))).then((results) => {
        if (ticket !== generation.current) return;

        const next = new Map<string, ExercisePR>();
        results.forEach((result, index) => {
          // A failed lookup is left out of the map, so the UI shows no PR rather
          // than a stale one. Logging keeps working either way.
          if (result.status === 'fulfilled') next.set(exerciseIds[index], result.value);
        });
        setPrs(next);
      });
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

  async function move(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (!dayId || target < 0 || target >= sessions.length) return;

    const order = sessions.map((session) => session.id);
    [order[index], order[target]] = [order[target], order[index]];
    await reorderExercises(dayId, order);
    refresh();
  }

  async function attach(exercise: Exercise): Promise<void> {
    await addExerciseToDay(date, exercise, intensity);
    refresh();
  }

  async function create(name: string, muscleGroup: string): Promise<void> {
    await attach(await createExercise(name, muscleGroup));
  }

  /**
   * Flip completion, recording any unsaved weight draft in the same write.
   *
   * Exactly one `updateSet` and one `refresh`: the weight is in the database
   * before the row is re-rendered, so a typed value is never dropped by the
   * refresh that follows a toggle. The promise rejects if the write fails, which
   * is how `SetRow` knows not to treat the draft as saved.
   */
  async function toggle(setId: string, completed: boolean, patch?: TogglePatch): Promise<void> {
    const next = { completed: !completed, ...patch };
    try {
      await updateSet(setId, next);
    } catch (error) {
      // Logging must keep working even if this row could not be written.
      console.error('Could not update set', setId, error);
      return;
    }
    refresh();
  }

  /**
   * Persist a non-toggle patch (blur commits, reps). Resolves only after the
   * write and the refresh, and rejects when the write fails so the caller can
   * keep the value pending instead of pretending it was saved.
   */
  async function patchSet(setId: string, patch: { weightKg?: number | null; reps?: number | null }): Promise<void> {
    try {
      await updateSet(setId, patch);
    } catch (error) {
      console.error('Could not save set weight', setId, error);
      throw error;
    }
    refresh();
  }

  async function addSet(session: SessionExercise): Promise<void> {
    const reps =
      session.note === undefined
        ? preset.repMin
        : (session.sets[0]?.reps ?? preset.repMin);
    await addSetsToExercise(session.id, 1, reps);
    refresh();
  }

  async function removeExercise(session: SessionExercise): Promise<void> {
    await removeExerciseFromDay(session.id);
    refresh();
  }

  function changeUnit(next: 'kg' | 'lb'): void {
    setUnit(next);
    void setWeightUnit(next);
  }

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

      {sessions.map((session, index) => (
        <ExerciseBlock
          key={session.id}
          session={session}
          index={index}
          total={sessions.length}
          unit={unit}
          intensity={intensity}
          pr={prs.get(session.exerciseId) ?? null}
          onMove={(direction) => void move(index, direction)}
          onRename={(name) => void updateSessionName(session.id, name).then(refresh)}
          onDeleteExercise={() => void removeExercise(session)}
          onAddSet={() => void addSet(session)}
          onChangeSet={(setId, patch) => patchSet(setId, patch)}
          onToggleSet={(setId, patch) => {
            const set = session.sets.find((row) => row.id === setId);
            return set === undefined ? Promise.resolve() : toggle(setId, set.completed, patch);
          }}
          onDeleteSet={(setId) => {
            void deleteSet(setId).then(refresh);
          }}
        />
      ))}

      {sessions.length === 0 ? (
        <p className="rounded-2xl bg-slate-900/50 p-4 text-xs text-slate-500 ring-1 ring-inset ring-slate-800">
          No exercises logged yet. Pick an intensity, then add an exercise below.
        </p>
      ) : null}

      <AddExercise library={library} onAdd={(exercise) => void attach(exercise)} onCreate={create} />

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