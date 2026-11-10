import { useState } from 'react';
import type { Exercise } from '../types';

interface Props {
  library: readonly Exercise[];
  onAdd: (exercise: Exercise) => void;
  onCreate: (name: string, muscleGroup: string) => void;
}

/** Library list plus an inline "new exercise" field. */
export default function AddExercise({ library, onAdd, onCreate }: Props) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState('');

  const matches = library
    .filter((exercise) => !exercise.archived)
    .filter((exercise) => exercise.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 6);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Add exercise</h3>

      <input
        value={query}
        placeholder="Search exercises"
        aria-label="Search exercises"
        onChange={(event) => setQuery(event.target.value)}
        className="min-h-[44px] rounded-xl bg-slate-900/70 px-3 text-sm text-slate-100 ring-1 ring-inset ring-slate-800 focus:ring-emerald-400 focus:outline-none"
      />

      {matches.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {matches.map((exercise) => (
            <li key={exercise.id}>
              <button
                type="button"
                onClick={() => onAdd(exercise)}
                className="min-h-[44px] rounded-full bg-slate-800/70 px-3 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700 hover:text-emerald-200 hover:ring-emerald-500/40"
              >
                + {exercise.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-500">No library exercise matches — create one below.</p>
      )}

      <div className="flex gap-2">
        <input
          value={name}
          placeholder="New exercise"
          aria-label="New exercise name"
          onChange={(event) => setName(event.target.value)}
          className="min-h-[44px] flex-1 rounded-xl bg-slate-900/70 px-3 text-sm text-slate-100 ring-1 ring-inset ring-slate-800 focus:ring-emerald-400 focus:outline-none"
        />
        <input
          value={muscleGroup}
          placeholder="Group"
          aria-label="New exercise group"
          onChange={(event) => setMuscleGroup(event.target.value)}
          className="min-h-[44px] w-24 rounded-xl bg-slate-900/70 px-3 text-sm text-slate-100 ring-1 ring-inset ring-slate-800 focus:ring-emerald-400 focus:outline-none"
        />
        <button
          type="button"
          disabled={name.trim() === ''}
          onClick={() => {
            onCreate(name.trim(), muscleGroup.trim());
            setName('');
            setMuscleGroup('');
          }}
          className="min-h-[44px] rounded-xl bg-emerald-500 px-3 text-xs font-bold text-slate-950 disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </section>
  );
}
