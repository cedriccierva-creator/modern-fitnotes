import { Suspense, lazy, useState } from 'react';
import AppShell from './components/AppShell';
import CalendarScreen from './screens/CalendarScreen';
import { todayKey } from './lib/month';

/**
 * The logging screen is split out of the initial bundle: it pulls in the
 * exercise catalog, the PR engine and every workout write path, none of which
 * the calendar landing view needs. The calendar stays eager so first paint
 * never waits on it; the chunk loads on first day-open.
 */
const WorkoutScreen = lazy(() => import('./screens/WorkoutScreen'));

/** Shown while the workout chunk loads. Matches the AppShell wordmark. */
function WorkoutLoading() {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-10">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 animate-pulse rotate-45 rounded-sm bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.45)]"
      />
      <span className="text-sm text-slate-400">Loading workout…</span>
    </div>
  );
}

/** Calendar and logging views. The selected local date is the only shared state. */
export default function App() {
  const [date, setDate] = useState(todayKey());
  const [logging, setLogging] = useState(false);

  return (
    <AppShell>
      {logging ? (
        <Suspense fallback={<WorkoutLoading />}>
          <WorkoutScreen date={date} onBack={() => setLogging(false)} />
        </Suspense>
      ) : (
        <CalendarScreen
          selected={date}
          onSelect={setDate}
          onOpenDay={(next) => {
            setDate(next);
            setLogging(true);
          }}
        />
      )}
    </AppShell>
  );
}
