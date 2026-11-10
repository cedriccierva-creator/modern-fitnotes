import AppShell from './components/AppShell';
import CalendarScreen from './screens/CalendarScreen';

/** Phase 3: the calendar and routine planner are the whole screen. */
export default function App() {
  return (
    <AppShell>
      <CalendarScreen />
    </AppShell>
  );
}
