import { shortWeekday, weekDates } from '../lib/month';
import type { PlannedDay } from '../types';
import PlannedChip from './PlannedChip';

interface Props {
  weekStartKey: string;
  planned: ReadonlyMap<string, PlannedDay>;
  logged: ReadonlySet<string>;
  /** Open the program picker for one date. Used by empty days too. */
  onAssign: (date: string) => void;
  onRemove: (date: string) => void;
}

/**
 * Read-mostly overview of the selected Monday-first week.
 *
 * There is deliberately no "apply a routine to this week" control: a routine is
 * an optional template for a *single* day, never a recurring schedule. Empty
 * days stay empty until the user assigns one of them, and skipping a day has no
 * effect on any other day.
 */
export default function WeekPlanner({ weekStartKey, planned, logged, onAssign, onRemove }: Props) {
  const days = weekDates(weekStartKey);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          This week
        </h3>
        <p className="text-[11px] text-slate-500">Each day is independent — skip any day.</p>
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
                  <button
                    type="button"
                    aria-label={`Change ${date}`}
                    onClick={() => onAssign(date)}
                    className="rounded-md px-2 py-1 text-[11px] text-slate-400 ring-1 ring-slate-800 hover:text-emerald-300 hover:ring-emerald-500/40"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${date}`}
                    onClick={() => onRemove(date)}
                    className="rounded-md px-1 text-xs text-slate-500 hover:text-rose-300"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[11px] text-slate-500">
                    {isLogged ? 'Logged workout — untouched' : 'Rest'}
                  </span>
                  <button
                    type="button"
                    aria-label={`Assign ${date}`}
                    onClick={() => onAssign(date)}
                    className="rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/10"
                  >
                    + Assign
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
