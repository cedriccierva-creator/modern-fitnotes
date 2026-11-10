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
export default function CalendarScreen() {
  const today = todayKey();
  const [selected, setSelected] = useState(today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [planned, setPlanned] = useState<readonly PlannedDay[]>([]);
  const [logged, setLogged] = useState<ReadonlySet<string>>(new Set());

  function refresh(): void {
    void loadPlannedDays().then(setPlanned);
    void loadLoggedDates(monthGrid(year, month)).then(setLogged);
  }

  useEffect(refresh, [year, month]);

  const plannedByDate = useMemo(() => new Map(planned.map((row) => [row.date, row])), [planned]);

  const visiblePlanned = useMemo(() => {
    const map = new Map<string, PlannedDay>();
    for (const row of planned) {
      if (Number(row.date.slice(5, 7)) === month && Number(row.date.slice(0, 4)) === year) {
        map.set(row.date, row);
      }
    }
    return map;
  }, [planned, year, month]);

  function navigate(delta: number): void {
    const next = month + delta;
    if (next < 1) {
      setMonth(12);
      setYear((current) => current - 1);
    } else if (next > 12) {
      setMonth(1);
      setYear((current) => current + 1);
    } else {
      setMonth(next);
    }
  }

  const week = weekStart(selected);

  async function change(date: string, category: WorkoutCategory): Promise<void> {
    await setPlannedTemplate(date, plannedByDate.get(date)?.presetId ?? 'custom', category);
    refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
          Phase 3 · Calendar
        </p>
        <h1 className="text-2xl font-bold leading-tight text-slate-50">
          Plan the <span className="text-emerald-400">week</span>.
        </h1>
      </div>

      <MonthCalendar
        year={year}
        month={month}
        selected={selected}
        today={today}
        planned={visiblePlanned}
        onSelect={setSelected}
        onNavigate={navigate}
      />

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
