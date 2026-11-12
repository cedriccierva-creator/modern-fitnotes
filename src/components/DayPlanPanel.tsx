import { findPreset } from '../lib/routines';
import { formatDateLabel } from '../lib/month';
import type { PlannedDay } from '../types';
import PlannedChip from './PlannedChip';

interface Props {
  date: string;
  plan: PlannedDay | undefined;
  /** Whether this date already holds a logged workout. Never changed by planning. */
  isLogged: boolean;
  onOpenPicker: (date: string) => void;
  onRemove: (date: string) => void;
}

/** What the selected date is planned for, with assign / change / remove. */
export default function DayPlanPanel({ date, plan, isLogged, onOpenPicker, onRemove }: Props) {
  const programName = plan ? (findPreset(plan.presetId)?.name ?? 'Custom') : null;

  return (
    <section
      aria-label="Selected day plan"
      className="flex flex-col gap-3 rounded-2xl bg-slate-900/70 p-4 ring-1 ring-inset ring-slate-800"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-slate-100">This day</h2>
          <p className="text-[11px] text-slate-500">{formatDateLabel(date)}</p>
        </div>
        {isLogged ? (
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            Logged
          </span>
        ) : null}
      </header>

      {plan ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <PlannedChip category={plan.category} label={plan.label} />
            <span className="text-[11px] text-slate-500">{programName}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenPicker(date)}
              className="min-h-[44px] flex-1 rounded-xl bg-slate-800/70 text-xs font-semibold text-slate-200 ring-1 ring-inset ring-slate-700 transition-colors hover:ring-emerald-500/40"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => onRemove(date)}
              className="min-h-[44px] flex-1 rounded-xl bg-slate-900/60 text-xs font-semibold text-slate-400 ring-1 ring-inset ring-slate-800 transition-colors hover:text-rose-300 hover:ring-rose-500/40"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-slate-500">
            {isLogged ? 'Logged workout — no plan for this day.' : 'Rest — no workout planned.'}
          </p>
          <button
            type="button"
            onClick={() => onOpenPicker(date)}
            className="min-h-[44px] rounded-xl bg-emerald-500/15 text-xs font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-500/40 transition-colors hover:bg-emerald-500/25"
          >
            Assign plan
          </button>
        </div>
      )}

      {isLogged ? (
        <p className="text-[11px] text-slate-500">
          Changing the plan never changes the logged workout.
        </p>
      ) : null}
    </section>
  );
}
