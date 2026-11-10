import { useEffect, useState } from 'react';
import SetRow from './SetRow';
import { findIntensity, intensityFromNote } from '../lib/intensity';
import type { IntensityId } from '../lib/intensity';
import type { SessionExercise } from '../db/workout';

interface Props {
  session: SessionExercise;
  index: number;
  total: number;
  unit: 'kg' | 'lb';
  intensity: IntensityId;
  onMove: (direction: -1 | 1) => void;
  /** Renames this day's row only; the library row is left alone. */
  onRename: (name: string) => void;
  onDeleteExercise: () => void;
  onAddSet: () => void;
  onChangeSet: (setId: string, patch: { weightKg?: number | null; reps?: number | null }) => void;
  onToggleSet: (setId: string) => void;
  onDeleteSet: (setId: string) => void;
}

export default function ExerciseBlock({
  session,
  index,
  total,
  unit,
  intensity,
  onMove,
  onRename,
  onDeleteExercise,
  onAddSet,
  onChangeSet,
  onToggleSet,
  onDeleteSet,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.exerciseName);

  useEffect(() => setDraft(session.exerciseName), [session.exerciseName]);

  const createdUnder = intensityFromNote(session.note);
  const shown = intensity ?? createdUnder;
  const preset = findIntensity(shown);
  const done = session.sets.filter((set) => set.completed).length;

  function commit(): void {
    if (draft.trim() !== '' && draft.trim() !== session.exerciseName) onRename(draft.trim());
    setRenaming(false);
  }

  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-slate-900/70 p-3 ring-1 ring-inset ring-slate-800">
      <header className="flex items-start gap-1">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={`Move ${session.exerciseName} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="h-9 w-7 rounded text-[10px] text-slate-500 enabled:hover:text-emerald-300 disabled:opacity-30"
          >
            ▲
          </button>
          <button
            type="button"
            aria-label={`Move ${session.exerciseName} down`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="h-9 w-7 rounded text-[10px] text-slate-500 enabled:hover:text-emerald-300 disabled:opacity-30"
          >
            ▼
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              value={draft}
              autoFocus
              aria-label={`Rename ${session.exerciseName}`}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') {
                  setDraft(session.exerciseName);
                  setRenaming(false);
                }
              }}
              className="min-h-[44px] w-full rounded-lg bg-slate-950 px-2 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-emerald-400 focus:outline-none"
            />
          ) : (
            <h3 className="truncate text-sm font-semibold text-slate-100">{session.exerciseName}</h3>
          )}
          <p className="mt-0.5 text-[11px] text-slate-500">
            {preset.name} · {preset.repMin}–{preset.repMax} reps ·{' '}
            <span className="text-emerald-400/80">{done}/{session.sets.length} done</span>
          </p>
        </div>

        <button
          type="button"
          aria-label={`Rename ${session.exerciseName} in workout`}
          onClick={() => setRenaming(true)}
          className="h-11 px-2 text-[11px] font-semibold uppercase text-slate-500 hover:text-emerald-300"
        >
          rename
        </button>
        <button
          type="button"
          aria-label={`Delete ${session.exerciseName} from workout`}
          onClick={onDeleteExercise}
          className="h-11 px-2 text-[11px] font-semibold uppercase text-slate-500 hover:text-rose-300"
        >
          delete
        </button>
      </header>

      <ul className="flex flex-col gap-1.5">
        {session.sets.map((set) => (
          <SetRow
            key={set.id}
            set={set}
            unit={unit}
            onChange={(patch) => onChangeSet(set.id, patch)}
            onToggle={() => onToggleSet(set.id)}
            onDelete={() => onDeleteSet(set.id)}
          />
        ))}
      </ul>

      <button
        type="button"
        onClick={onAddSet}
        className="min-h-[40px] rounded-xl text-xs font-semibold text-slate-400 ring-1 ring-inset ring-slate-700 hover:text-emerald-300 hover:ring-emerald-500/40"
      >
        + set
      </button>
    </article>
  );
}
