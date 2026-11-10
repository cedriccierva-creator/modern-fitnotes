import AppShell from './components/AppShell';
import HomeScreen from './screens/HomeScreen';

/** Phase 1: one shell, one placeholder screen. Routing arrives with the calendar. */
export default function App() {
  return (
    <AppShell>
      <HomeScreen />
    </AppShell>
  );
}
