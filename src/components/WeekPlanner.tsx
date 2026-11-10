import { CATEGORY_LABELS, ROUTINE_PRESETS } from '../lib/routines';
import { shortWeekday, weekDates } from '../lib/month';
import type { PlannedDay, WorkoutCategory } from '../types';
import PlannedChip from './PlannedChip';

interface Props {
  weekStartKey: string;
  planned: ReadonlyMap<string, PlannedDay>;
  logged: ReadonlySet<string>;
  onApply: (presetId: string) => void;
  onClear: (presetId: string) => void;
  onChange: (date: string, category: WorkoutCategory) => void;
  onRemove: (date: string) => void;
}

const CATEGORIES: readonly WorkoutCategory[] = [
  'push',
  'pull',
  'legs',
  'upper',
  'lower',
  'fullBody',
];

/** Planner for one Monday-first week: presets on top, the resolved week below. */
export default function WeekPlanner({
  weekStartKey,
  planned,
  logged,
  onApply,
  onClear,
  onChange,
  onRemove,
}: Props) {
  const days = weekDates(weekStartKey);
  const appliedIds = new Set(
    days.map((date) => planned.get(date)?.presetId).filter((id): id is string => Boolean(id)),
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Routine presets
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {ROUTINE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => (appliedIds.has(preset.id) ? onClear(preset.id) : onApply(preset.id))}
              className={`rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors ${
                appliedIds.has(preset.id)
                  ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-400'
                  : 'bg-slate-900/70 text-slate-300 ring-1 ring-inset ring-slate-800 hover:ring-emerald-500/40'
              }`}
            >
              {preset.name}
              <span className="block text-[11px] font-normal text-slate-500">
                {appliedIds.has(preset.id) ? 'Applied · tap to clear' : `${preset.templates.length} days`}
              </span>
            </button>
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {days.map((date) => {
          const plan = planned.get(date);
          const isLogged = logged.has(date);

          return (
            <li
              key={date}
              className="flex items-center gap-2 rounded-xl bg-slate-900/60 px-3 py-2 ring-1 ring-inset ring-slate-800"
            >
              <span className="w-10 shrink-0 text-[11px] font-semibold uppercase text-slate-400">
                {shortWeekday(date)}
              </span>

              {plan ? (
                <>
                  <span className="flex-1">
                    <PlannedChip category={plan.category} label={plan.label} />
                  </span>
                  {isLogged ? null : (
                    <>
                      <select
                        aria-label={`Template for ${date}`}
                        value={plan.category}
                        onChange={(event) => onChange(date, event.target.value as WorkoutCategory)}
                        className="rounded-md bg-slate-800 py-0.5 text-[11px] text-slate-300 ring-1 ring-slate-700"
                      >
                        {CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {CATEGORY_LABELS[category]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`Remove ${date}`}
                        onClick={() => onRemove(date)}
                        className="rounded-md px-1 text-xs text-slate-500 hover:text-rose-300"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </>
              ) : (
                <span className="flex-1 text-[11px] text-slate-500">
                  {isLogged ? 'Logged workout — untouched' : 'Rest'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
