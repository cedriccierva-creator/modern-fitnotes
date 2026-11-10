import { useEffect, useMemo, useState } from 'react';
import MonthCalendar from '../components/MonthCalendar';
import WeekPlanner from '../components/WeekPlanner';
import {
  applyPreset,
  clearPreset,
  loadLoggedDates,
  loadPlannedDays,
  removePlannedDay,
  setPlannedTemplate,
} from '../db/planned';
import { monthGrid, todayKey, weekStart } from '../lib/month';
import type { PlannedDay, WorkoutCategory } from '../types';

/**
 * Phase 3 screen: month calendar plus the weekly routine planner. The calendar
 * is local state; everything persistent lives in the plannedDays table, which
 * is re-read after each write.
 */
export default function CalendarScreen({
  selected,
  onSelect,
  onOpenDay,
}: {
  selected: string;
  onSelect: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const today = todayKey();
  const [cursor, setCursor] = useState(() => ({
    year: Number(selected.slice(0, 4)),
    month: Number(selected.slice(5, 7)),
  }));
  const [planned, setPlanned] = useState<readonly PlannedDay[]>([]);
  const [logged, setLogged] = useState<ReadonlySet<string>>(new Set());

  const visibleDates = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  function refresh(): void {
    void loadPlannedDays().then(setPlanned);
    void loadLoggedDates(visibleDates).then(setLogged);
  }

  useEffect(refresh, [visibleDates]);

  const plannedByDate = useMemo(() => new Map(planned.map((row) => [row.date, row])), [planned]);

  const visiblePlanned = useMemo(() => {
    const map = new Map<string, PlannedDay>();
    for (const row of planned) {
      if (row.date.startsWith(`${cursor.year}-${`${cursor.month}`.padStart(2, '0')}`)) {
        map.set(row.date, row);
      }
    }
    return map;
  }, [planned, cursor]);

  function navigate(delta: number): void {
    const next = cursor.month + delta;
    if (next < 1) setCursor({ year: cursor.year - 1, month: 12 });
    else if (next > 12) setCursor({ year: cursor.year + 1, month: 1 });
    else setCursor({ year: cursor.year, month: next });
  }

  const week = weekStart(selected);

  async function change(date: string, category: WorkoutCategory): Promise<void> {
    await setPlannedTemplate(date, plannedByDate.get(date)?.presetId ?? 'custom', category);
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
          Phase 4 · Calendar
        </p>
        <h1 className="text-2xl font-bold leading-tight text-slate-50">
          Plan the <span className="text-emerald-400">week</span>.
        </h1>
      </div>

      <MonthCalendar
        year={cursor.year}
        month={cursor.month}
        selected={selected}
        today={today}
        planned={visiblePlanned}
        onSelect={onSelect}
        onNavigate={navigate}
      />

      <button
        type="button"
        onClick={() => onOpenDay(selected)}
        className="min-h-[48px] rounded-2xl bg-emerald-500 text-sm font-bold text-slate-950"
      >
        Open workout
      </button>

      <WeekPlanner
        weekStartKey={week}
        planned={plannedByDate}
        logged={logged}
        onApply={(presetId) => void applyPreset(presetId, week).then(refresh)}
        onClear={(presetId) => void clearPreset(presetId, week).then(refresh)}
        onChange={(date, category) => void change(date, category)}
        onRemove={(date) => void removePlannedDay(date).then(refresh)}
      />
    </div>
  );
}
