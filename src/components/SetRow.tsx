import { useEffect, useState } from 'react';
import { formatWeight, parseRepInput, parseWeightInput } from '../lib/units';
import type { WorkoutSet } from '../types';

const NUMBER_INPUT =
  'min-h-[44px] w-full rounded-lg bg-slate-950 px-2 py-1 text-center text-sm text-slate-100 ring-1 ring-inset ring-slate-700 focus:ring-emerald-400 focus:outline-none';

interface Props {
  set: WorkoutSet;
  unit: 'kg' | 'lb';
  onChange: (patch: { weightKg?: number | null; reps?: number | null }) => void;
  onToggle: () => void;
  onDelete: () => void;
}

/**
 * One editable set row. Weight is typed in the display unit but converted to
 * kilograms on parse, so nothing is ever stored in pounds.
 */
export default function SetRow({ set, unit, onChange, onToggle, onDelete }: Props) {
  const [weight, setWeight] = useState(() => formatWeight(set.weightKg, unit));
  const [reps, setReps] = useState(() => (set.reps === null ? '' : String(set.reps)));

  // Re-sync when the underlying row is replaced, e.g. unit or day changes.
  useEffect(() => {
    setWeight(formatWeight(set.weightKg, unit));
  }, [set.weightKg, unit]);

  useEffect(() => {
    setReps(set.reps === null ? '' : String(set.reps));
  }, [set.reps]);

  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-2 py-2 transition-colors ${
        set.completed
          ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/40'
          : 'bg-slate-800/50 ring-1 ring-inset ring-slate-700/70'
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={set.completed}
        aria-label={`Set ${set.setNumber} complete`}
        onClick={onToggle}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors ${
          set.completed
            ? 'bg-emerald-500 text-slate-950'
            : 'bg-slate-900 text-slate-500 ring-1 ring-inset ring-slate-600 hover:text-emerald-300'
        }`}
      >
        {set.setNumber}
      </button>

      <label className="flex-1">
        <span className="sr-only">Weight for set {set.setNumber}</span>
        <input
          inputMode="decimal"
          placeholder={unit}
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          onBlur={() => onChange({ weightKg: parseWeightInput(weight, unit) })}
          className={NUMBER_INPUT}
        />
      </label>

      <label className="w-16">
        <span className="sr-only">Repetitions for set {set.setNumber}</span>
        <input
          inputMode="numeric"
          placeholder="reps"
          value={reps}
          onChange={(event) => setReps(event.target.value)}
          onBlur={() => onChange({ reps: parseRepInput(reps) })}
          className={NUMBER_INPUT}
        />
      </label>

      <button
        type="button"
        aria-label={`Delete set ${set.setNumber}`}
        onClick={onDelete}
        className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-300"
      >
        ✕
      </button>
    </li>
  );
}
