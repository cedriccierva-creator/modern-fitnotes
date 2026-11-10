import { MONTH_NAMES, formatDateLabel, isSameMonth, monthGrid, weekdayIndex } from '../lib/month';
import type { PlannedDay } from '../types';
import PlannedChip from './PlannedChip';

interface Props {
  year: number;
  /** 1-based. */
  month: number;
  selected: string;
  today: string;
  planned: ReadonlyMap<string, PlannedDay>;
  onSelect: (date: string) => void;
  onNavigate: (delta: number) => void;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** Presentational only: all state lives in CalendarScreen. */
export default function MonthCalendar({
  year,
  month,
  selected,
  today,
  planned,
  onSelect,
  onNavigate,
}: Props) {
  const cells = monthGrid(year, month);

  return (
    <section className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-inset ring-slate-800">
      <header className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onNavigate(-1)}
          className="rounded-lg px-2 py-1 text-sm text-slate-400 ring-1 ring-slate-800 transition-colors hover:text-emerald-300 hover:ring-emerald-500/40"
        >
          ‹
        </button>

        <h2 className="text-sm font-semibold text-slate-100">
          {MONTH_NAMES[month - 1]} {year}
        </h2>

        <button
          type="button"
          aria-label="Next month"
          onClick={() => onNavigate(1)}
          className="rounded-lg px-2 py-1 text-sm text-slate-400 ring-1 ring-slate-800 transition-colors hover:text-emerald-300 hover:ring-emerald-500/40"
        >
          ›
        </button>
      </header>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((name, index) => (
          <div
            key={`${name}${index}`}
            className="pb-1 text-center text-[10px] font-semibold uppercase text-slate-500"
          >
            {name}
          </div>
        ))}

        {cells.map((date) => {
          const outside = !isSameMonth(date, year, month);
          const plan = planned.get(date);
          const isSelected = date === selected;
          const isToday = date === today;

          return (
            <button
              key={date}
              type="button"
              aria-label={formatDateLabel(date)}
              aria-pressed={isSelected}
              onClick={() => onSelect(date)}
              className={[
                'flex h-11 flex-col items-center justify-start rounded-lg px-0.5 pt-1 transition-colors',
                outside ? 'text-slate-600' : 'text-slate-300',
                isSelected
                  ? 'bg-emerald-500/20 ring-1 ring-inset ring-emerald-400'
                  : isToday
                    ? 'bg-slate-800 ring-1 ring-inset ring-slate-600'
                    : 'hover:bg-slate-800',
              ].join(' ')}
            >
              <span className={`text-xs ${isToday ? 'font-bold text-emerald-300' : ''}`}>
                {Number(date.slice(8))}
              </span>
              {plan ? <span className="mt-0.5 w-full px-0.5"><PlannedChip category={plan.category} label={plan.label} /></span> : null}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        Row starts {weekdayIndex(cells[0]) === 0 ? 'on Monday' : 'mid-week'} · showing 6 weeks
      </p>
    </section>
  );
}
