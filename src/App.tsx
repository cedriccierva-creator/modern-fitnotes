import { useState } from 'react';
import AppShell from './components/AppShell';
import CalendarScreen from './screens/CalendarScreen';
import WorkoutScreen from './screens/WorkoutScreen';
import { todayKey } from './lib/month';

/** Calendar and logging views. The selected local date is the only shared state. */
export default function App() {
  const [date, setDate] = useState(todayKey());
  const [logging, setLogging] = useState(false);

  return (
    <AppShell>
      {logging ? (
        <WorkoutScreen date={date} onBack={() => setLogging(false)} />
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
