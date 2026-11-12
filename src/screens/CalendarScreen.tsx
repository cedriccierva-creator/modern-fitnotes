import { useEffect, useMemo, useState } from 'react';
import DayPlanPanel from '../components/DayPlanPanel';
import MonthCalendar from '../components/MonthCalendar';
import ProgramPicker from '../components/ProgramPicker';
import WeekPlanner from '../components/WeekPlanner';
import {
  isLoggedDate,
  loadLoggedDates,
  loadPlannedDays,
  removePlannedDay,
  setPlannedTemplate,
} from '../db/planned';
import { monthGrid, todayKey, weekStart } from '../lib/month';
import type { PlannedDay, WorkoutCategory } from '../types';

/**
 * Calendar screen: the month grid, the selected day's plan, and a read-mostly
 * week overview.
 *
 * Planning is day-scoped throughout. Nothing here fills a week, repeats a
 * routine, or moves a skipped day: every write targets exactly one date via
 * `setPlannedTemplate`, and only the `plannedDays` table is written. Opening a
 * workout (`onOpenDay`) is a separate, explicit action.
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
  /** The date whose program picker is open, if any. At most one at a time. */
  const [picking, setPicking] = useState<string | null>(null);

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

  /**
   * True when `date` already holds a logged workout. The document lookup is
   * authoritative here (the `logged` set only covers the visible month), and it
   * is a read: the log itself is never written by any planning action.
   */
  async function warnIfLogged(date: string): Promise<void> {
    const alreadyLogged = await isLoggedDate(date);
    if (!alreadyLogged) return;

    // A warning, not a block: the assignment proceeds and the log is untouched.
    window.alert(
      'This day already has a logged workout. The plan will be saved, and your logged workout will not be changed.',
    );
  }

  async function applyPlan(date: string, presetId: string, category: WorkoutCategory): Promise<void> {
    await warnIfLogged(date);
    await setPlannedTemplate(date, presetId, category);
    setPicking(null);
    refresh();
  }

  async function removePlan(date: string): Promise<void> {
    await warnIfLogged(date);
    await removePlannedDay(date);
    setPicking(null);
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
          Phase 4 · Calendar
        </p>
        <h1 className="text-2xl font-bold leading-tight text-slate-50">
          Plan your <span className="text-emerald-400">days</span>.
        </h1>
      </div>

      <MonthCalendar
        year={cursor.year}
        month={cursor.month}
        selected={selected}
        today={today}
        planned={visiblePlanned}
        logged={logged}
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

      <DayPlanPanel
        date={selected}
        plan={plannedByDate.get(selected)}
        isLogged={logged.has(selected)}
        onOpenPicker={setPicking}
        onRemove={(date) => void removePlan(date)}
      />

      {picking === null ? null : (
        <ProgramPicker
          date={picking}
          onPick={(presetId, category) => void applyPlan(picking, presetId, category)}
          onClose={() => setPicking(null)}
        />
      )}

      <WeekPlanner
        weekStartKey={week}
        planned={plannedByDate}
        logged={logged}
        onAssign={setPicking}
        onRemove={(date) => void removePlan(date)}
      />
    </div>
  );
}
