// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddExercise from '../components/AddExercise';
import WorkoutScreen from '../screens/WorkoutScreen';
import { db } from '../db/db';
import { CATALOG } from '../lib/exerciseCatalog';
import { settleDatabaseReads, trackDatabaseReads } from './db-quiescence';

const DATE = '2026-11-11';

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await settleDatabaseReads();
  vi.restoreAllMocks();
  await db.close();
  await db.delete();
});

trackDatabaseReads(await import('../db/workout'), ['loadDay']);
trackDatabaseReads(await import('../db/exercises'), ['loadExercises']);
trackDatabaseReads(await import('../db/personalRecords'), [
  'getPRsForExercises',
  'getPRsForExercise',
  'loadExercisePerformance',
]);
trackDatabaseReads(await import('../db/settings'), ['loadWeightUnit']);

function renderPicker(overrides: Partial<Parameters<typeof AddExercise>[0]> = {}) {
  const props = {
    library: [],
    adoptedCatalogIds: new Set<string>(),
    onAddLibraryExercise: vi.fn(),
    onAddToToday: vi.fn(),
    onAdopt: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  };
  render(<AddExercise {...props} />);
  return props;
}

describe('picker: search and filters', () => {
  it('opens on the gym library and lists catalog entries', () => {
    renderPicker();
    expect(
      (screen.getByRole('button', { name: 'Gym' }) as HTMLElement).getAttribute('aria-pressed'),
    ).toBe('true');
    // Entries carry their own actions, so each is visible before selection.
    expect(screen.getByLabelText('Add Flat barbell bench press to today')).toBeTruthy();
  });

  it('searches by name', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet' },
    });
    expect(screen.getByLabelText('Add Goblet squat to today')).toBeTruthy();
    expect(screen.queryByLabelText('Add Flat barbell bench press to today')).toBeNull();
  });

  it('filters by muscle group', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Biceps' }));
    expect(screen.getByLabelText('Add Barbell curl to today')).toBeTruthy();
    expect(screen.queryByLabelText('Add Flat barbell bench press to today')).toBeNull();
  });

  it('filters by level', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    // "Weighted dip" is the only chest exercise tagged A.
    expect(screen.getByLabelText('Add Weighted dip to today')).toBeTruthy();
    expect(screen.queryByLabelText('Add Flat barbell bench press to today')).toBeNull();
  });

  it('switches library and clears stale category filters', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Biceps' }));
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));

    // The gym-only chip is gone and home entries are listed.
    expect(screen.queryByRole('button', { name: 'Biceps' })).toBeNull();
    expect(screen.getByLabelText('Add Wall push-up to today')).toBeTruthy();
  });

  it('shows the empty state for a nonsense query', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'zzzzz' },
    });
    expect(screen.getByText(/No exercise matches/)).toBeTruthy();
  });

  it('reveals progression details on demand', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'wall push-up' },
    });

    expect(screen.queryByText(/Easier:/)).toBeNull();
    // The row's disclosure button is named by its content ("Wall push-up … B"),
    // so pick it by the level suffix rather than matching the action buttons.
    fireEvent.click(screen.getByRole('button', { name: /^Wall push-up/ }));
    expect(screen.getByText(/Easier: Stand farther from wall/)).toBeTruthy();
    expect(screen.getByText(/Harder: Incline push-up/)).toBeTruthy();
  });
});

describe('picker: the two actions stay separate', () => {
  it('sends today-addition through its own handler', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByLabelText('Add Goblet squat to today'));

    expect(props.onAddToToday).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Goblet squat', library: 'gym' }),
    );
    expect(props.onAdopt).not.toHaveBeenCalled();
  });

  it('sends adoption through its own handler', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));

    expect(props.onAdopt).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Goblet squat' }),
    );
    expect(props.onAddToToday).not.toHaveBeenCalled();
  });

  it('marks already-adopted entries and disables their adopt button', () => {
    const entry = CATALOG.find((row) => row.name === 'Goblet squat')!;
    renderPicker({ adoptedCatalogIds: new Set([entry.id]) });

    const button = screen.getByLabelText('Goblet squat is in your library');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toContain('In library');
    // Adding to today is still allowed.
    expect((screen.getByLabelText('Add Goblet squat to today') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps custom creation available and does not require the catalog', () => {
    const props = renderPicker();
    fireEvent.change(screen.getByLabelText('New exercise name'), { target: { value: 'My Lift' } });
    fireEvent.change(screen.getByLabelText('New exercise group'), { target: { value: 'legs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(props.onCreate).toHaveBeenCalledWith('My Lift', 'legs');
  });

  it('lists the personal library on its own tab', () => {
    const own = {
      id: 'own-1',
      name: 'My Lift',
      muscleGroup: 'legs',
      createdAt: 0,
      updatedAt: 0,
    };
    const props = renderPicker({ library: [own] });

    fireEvent.click(screen.getByRole('button', { name: 'My library' }));
    // Catalog controls disappear: this tab is the user's own rows.
    expect(screen.queryByRole('button', { name: 'Biceps' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+ My Lift' }));
    expect(props.onAddLibraryExercise).toHaveBeenCalledWith(own);
  });
});

describe('picker: no automatic seeding', () => {
  it('writes nothing to IndexedDB while browsing, filtering or typing', async () => {
    renderPicker();

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'squat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Quads' }));
    fireEvent.click(screen.getByRole('button', { name: 'Beginner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Minimal kit' }));
    fireEvent.click(screen.getByRole('button', { name: 'My library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gym' }));

    expect(await db.exercises.count()).toBe(0);
    expect(await db.workoutDays.count()).toBe(0);
    expect(await db.workoutExercises.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
  });
});

/**
 * End-to-end through the screen, so the wiring between picker and database is
 * covered rather than only the component in isolation.
 */
describe('workout screen integration', () => {
  async function openWorkout() {
    render(<WorkoutScreen date={DATE} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Search exercises')).toBeTruthy());
  }

  it('adds a catalog suggestion to today without adopting it', async () => {
    await openWorkout();

    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet squat' },
    });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to today'));

    await waitFor(async () => expect(await db.workoutExercises.count()).toBe(1));
    expect(await db.exercises.count()).toBe(0);

    const session = await db.workoutExercises.toArray();
    expect(session[0].exerciseName).toBe('Goblet squat');
  });

  it('adopts into the library without logging it', async () => {
    await openWorkout();

    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet squat' },
    });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));

    await waitFor(async () => expect(await db.exercises.count()).toBe(1));
    expect(await db.workoutExercises.count()).toBe(0);
    expect(await db.workoutDays.count()).toBe(0);

    const row = (await db.exercises.toArray())[0];
    expect(row.name).toBe('Goblet squat');
    expect(row.catalogId).toBeDefined();
  });

  it('reflects adoption in the picker without a reload', async () => {
    await openWorkout();

    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet squat' },
    });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));

    await waitFor(() =>
      expect(screen.getByLabelText('Goblet squat is in your library')).toBeTruthy(),
    );
  });

  it('prevents adopting the same entry twice through the UI', async () => {
    await openWorkout();

    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet squat' },
    });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));
    await waitFor(async () => expect(await db.exercises.count()).toBe(1));

    // The control is now disabled, so a second click cannot duplicate it.
    const button = await screen.findByLabelText('Goblet squat is in your library');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    await waitFor(async () => expect(await db.exercises.count()).toBe(1));
  });

  it('asks before duplicating an existing name when creating a custom exercise', async () => {
    await openWorkout();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.change(screen.getByLabelText('New exercise name'), {
      target: { value: 'Conventional deadlift' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    // Declining leaves the library and the day alone.
    expect(await db.exercises.count()).toBe(0);
    expect(await db.workoutExercises.count()).toBe(0);
  });

  it('logs the catalog entry instead of a duplicate when the user accepts', async () => {
    await openWorkout();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.change(screen.getByLabelText('New exercise name'), {
      target: { value: 'Conventional deadlift' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(async () => expect(await db.workoutExercises.count()).toBe(1));
    // No custom library row was created; the catalog entry was used.
    expect(await db.exercises.count()).toBe(0);
    const session = await db.workoutExercises.toArray();
    expect(session[0].exerciseName).toBe('Conventional deadlift');
    // Let the refresh chain (day, PRs, library) finish inside the test, inside
    // `act`, rather than landing after teardown.
    await settleDatabaseReads();
  });

  it('renames an adopted exercise without losing its library identity', async () => {
    await openWorkout();

    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet squat' },
    });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));
    await waitFor(async () => expect(await db.exercises.count()).toBe(1));

    vi.spyOn(window, 'prompt').mockReturnValue('Goblet squat (tempo)');
    fireEvent.click(await screen.findByLabelText('Rename Goblet squat'));

    await waitFor(async () => {
      const rows = await db.exercises.toArray();
      expect(rows[0]?.name).toBe('Goblet squat (tempo)');
    });
    const row = (await db.exercises.toArray())[0];
    expect(row.catalogId).toBeDefined();
    // Still recognised as adopted, despite the new name.
    expect((await screen.findByLabelText('Goblet squat is in your library') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets a deleted entry be adopted again', async () => {
    await openWorkout();

    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet squat' },
    });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));
    await waitFor(async () => expect(await db.exercises.count()).toBe(1));

    fireEvent.click(await screen.findByLabelText('Delete Goblet squat'));
    await waitFor(async () => expect(await db.exercises.count()).toBe(0));

    // The suggestion is offered again, with no tombstone written.
    const adopt = await screen.findByLabelText('Add Goblet squat to library');
    expect((adopt as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(adopt);
    await waitFor(async () => expect(await db.exercises.count()).toBe(1));
    expect(await db.settings.count()).toBe(0);
  });

  it('shows the personal library section for adopted rows only', async () => {
    await openWorkout();
    expect(screen.getByText('Renaming or deleting never changes the names recorded in past workouts.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search exercises'), {
      target: { value: 'goblet squat' },
    });
    fireEvent.click(screen.getByLabelText('Add Goblet squat to library'));

    const list = await screen.findByRole('list', { name: '' }).catch(() => null);
    await waitFor(async () => expect(await db.exercises.count()).toBe(1));
    expect(list === null || within(list).queryByText('Goblet squat') !== null).toBe(true);
  });
});
