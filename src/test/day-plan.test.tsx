// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarScreen from '../screens/CalendarScreen';
import { db } from '../db/db';
import { loadPlannedDays, setPlannedTemplate } from '../db/planned';
import { newId } from '../lib/id';
import { settleDatabaseReads, trackDatabaseReads } from './db-quiescence';
import type { WorkoutDay, WorkoutExercise, WorkoutSet } from '../types';

/**
 * The screen starts its loads and writes without awaiting them, so every helper
 * it can call is counted and drained before teardown. The writes are included
 * deliberately: a write resolving after the drain would issue a follow-up
 * `refresh()` read that races the next test's database delete. See
 * `db-quiescence.ts`.
 */
trackDatabaseReads(await import('../db/planned'), [
  'loadPlannedDays',
  'loadLoggedDates',
  'isLoggedDate',
  'setPlannedTemplate',
  'removePlannedDay',
]);

const NOW = 1_700_000_000_000;
const SELECTED = '2026-11-10';

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  // Drain before restoring: the tracking itself is implemented with spies.
  await settleDatabaseReads();
  vi.restoreAllMocks();
});

/** Keeps `selected` in real state, so clicking the grid behaves like the app. */
function Harness({ initial = SELECTED }: { initial?: string }) {
  const [date, setDate] = useState(initial);
  return <CalendarScreen selected={date} onSelect={setDate} onOpenDay={() => {}} />;
}

function renderScreen(initial = SELECTED) {
  const user = userEvent.setup();
  render(<Harness initial={initial} />);
  return { user };
}

/** Log one day with one exercise and one set, the way the log screen would. */
async function logDay(date: string) {
  const day: WorkoutDay = { id: newId(), date, note: 'logged before planning', createdAt: NOW, updatedAt: NOW };
  const row: WorkoutExercise = {
    id: newId(),
    workoutDayId: day.id,
    exerciseId: newId(),
    exerciseName: 'Back Squat',
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const set: WorkoutSet = {
    id: newId(),
    workoutExerciseId: row.id,
    workoutDayId: day.id,
    setNumber: 1,
    weightKg: 140,
    reps: 5,
    completed: true,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await db.workoutDays.add(day);
  await db.workoutExercises.add(row);
  await db.workoutSets.add(set);
  return { day, row, set };
}

/** The calendar cell for a date, by its accessible name. */
function cell(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/**
 * The selected-day panel. A plan's chip can legitimately appear three times at
 * once (month cell, day panel, week row), so text assertions are scoped here.
 */
function panel(): HTMLElement {
  return screen.getByLabelText('Selected day plan');
}

describe('selected day panel', () => {
  it('starts a day with no plan as Rest, with an assign action', async () => {
    renderScreen();

    expect(screen.getByText('Rest — no workout planned.')).toBeTruthy();
    expect(cell('Assign plan')).toBeTruthy();
    await settleDatabaseReads();
  });

  it('assigns a category to one date only', async () => {
    const { user } = renderScreen();

    await user.click(cell('Assign plan'));
    await user.click(cell('Any category: Push'));

    await waitFor(() => expect(panel().textContent).toContain('Push'));

    const rows = await loadPlannedDays();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: SELECTED, category: 'push', presetId: 'custom', label: 'Push' });

    // Every other day of the week is still rest: nothing was filled in.
    for (const date of ['2026-11-09', '2026-11-11', '2026-11-12', '2026-11-13']) {
      expect(cell(`Assign ${date}`)).toBeTruthy();
    }
  });

  it('assigns a routine template as a single date-specific plan', async () => {
    const { user } = renderScreen();

    await user.click(cell('Assign plan'));
    await user.click(cell('PPLUL: Push'));

    await waitFor(async () => expect(await loadPlannedDays()).toHaveLength(1));

    const rows = await loadPlannedDays();
    expect(rows[0]).toMatchObject({ date: SELECTED, presetId: 'ppl-flow', category: 'push' });
  });

  it('changes an existing plan in place', async () => {
    await setPlannedTemplate(SELECTED, 'custom', 'push');
    const { user } = renderScreen();

    await waitFor(() => expect(panel().textContent).toContain('Push'));

    await user.click(cell('Change'));
    await user.click(cell('Any category: Arms'));

    await waitFor(() => expect(panel().textContent).toContain('Arms'));

    const rows = await loadPlannedDays();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: SELECTED, category: 'arms', label: 'Arms' });
  });

  it('removes a plan and returns the day to rest', async () => {
    await setPlannedTemplate(SELECTED, 'custom', 'legs');
    const { user } = renderScreen();

    await waitFor(() => expect(panel().textContent).toContain('Legs'));

    await user.click(cell('Remove'));

    await waitFor(() => expect(screen.getByText('Rest — no workout planned.')).toBeTruthy());
    expect(await loadPlannedDays()).toEqual([]);
  });

  it('repeats the same program on two dates independently', async () => {
    const { user } = renderScreen();

    await user.click(cell('Assign plan'));
    await user.click(cell('Any category: Full Body'));
    await waitFor(async () => expect(await loadPlannedDays()).toHaveLength(1));

    await user.click(cell('Assign 2026-11-12'));
    await user.click(cell('Any category: Full Body'));
    await waitFor(async () => expect(await loadPlannedDays()).toHaveLength(2));

    const rows = (await loadPlannedDays()).sort((a, b) => a.date.localeCompare(b.date));
    expect(rows.map((row) => row.date)).toEqual([SELECTED, '2026-11-12']);
    expect(rows.every((row) => row.category === 'fullBody')).toBe(true);
  });
});

describe('arms', () => {
  it('is offered as a category and persists', async () => {
    const { user } = renderScreen();

    await user.click(cell('Assign plan'));
    await user.click(cell('Any category: Arms'));

    await waitFor(async () => expect(await loadPlannedDays()).toHaveLength(1));

    const rows = await loadPlannedDays();
    expect(rows[0]).toMatchObject({ category: 'arms', label: 'Arms' });
    expect(panel().textContent).toContain('Arms');
  });
});

describe('week overview', () => {
  it('offers Assign on empty days and no week-wide preset application', async () => {
    renderScreen();

    expect(screen.getByText('This week')).toBeTruthy();
    expect(cell('Assign 2026-11-09')).toBeTruthy();

    // The old "Routine presets" block is gone for good.
    expect(screen.queryByText('Routine presets')).toBeNull();
    expect(screen.queryByText('Applied · tap to clear')).toBeNull();
    await settleDatabaseReads();
  });

  it('assigns from the week row for a different date', async () => {
    const { user } = renderScreen();

    await user.click(cell('Assign 2026-11-13'));
    await user.click(cell('Any category: Pull'));

    await waitFor(async () => expect(await loadPlannedDays()).toHaveLength(1));

    const rows = await loadPlannedDays();
    expect(rows[0]).toMatchObject({ date: '2026-11-13', category: 'pull' });
  });

  it('never fills the week when a day is skipped', async () => {
    // Wednesday planned, then skipped (removed). No other day may appear.
    await setPlannedTemplate('2026-11-11', 'custom', 'legs');
    const { user } = renderScreen();

    await waitFor(() => expect(cell('Remove 2026-11-11')).toBeTruthy());
    await user.click(cell('Remove 2026-11-11'));

    await waitFor(async () => expect(await loadPlannedDays()).toEqual([]));
  });
});

describe('logging stays separate from planning', () => {
  it('marks a logged date on the grid independently of a plan', async () => {
    await logDay('2026-11-13');
    renderScreen();

    await waitFor(() =>
      expect(cell('Friday, November 13, 2026').getAttribute('data-logged')).toBe('true'),
    );
    expect(cell('Friday, November 13, 2026').getAttribute('data-planned')).toBeNull();
    expect(cell('Thursday, November 12, 2026').getAttribute('data-logged')).toBeNull();

    await settleDatabaseReads();
  });

  it('shows logged and planned indicators together on the same date', async () => {
    await logDay('2026-11-13');
    await setPlannedTemplate('2026-11-13', 'custom', 'arms');
    renderScreen();

    await waitFor(() => {
      expect(cell('Friday, November 13, 2026').getAttribute('data-planned')).toBe('true');
      expect(cell('Friday, November 13, 2026').getAttribute('data-logged')).toBe('true');
    });
    expect(cell('Friday, November 13, 2026').textContent).toContain('Arms');

    await settleDatabaseReads();
  });

  it('warns before planning a logged date, then proceeds without changing the log', async () => {
    const { day, row, set } = await logDay(SELECTED);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { user } = renderScreen();

    await waitFor(() => expect(screen.getByText('Logged workout — no plan for this day.')).toBeTruthy());

    await user.click(cell('Assign plan'));
    await user.click(cell('Any category: Arms'));

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0][0]).toMatch(/already has a logged workout/i);
    expect(alert.mock.calls[0][0]).toMatch(/will not be changed/i);

    // The assignment went through anyway: warning, not a block.
    await waitFor(async () => {
      const rows = await loadPlannedDays();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ date: SELECTED, category: 'arms' });
    });

    // And the log is byte-identical.
    expect(await db.workoutDays.get(day.id)).toEqual(day);
    expect(await db.workoutExercises.get(row.id)).toEqual(row);
    expect(await db.workoutSets.get(set.id)).toEqual(set);
  });

  it('warns before removing a plan from a logged date', async () => {
    await logDay(SELECTED);
    await setPlannedTemplate(SELECTED, 'custom', 'push');
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { user } = renderScreen();

    await waitFor(() => expect(panel().textContent).toContain('Push'));
    await user.click(cell('Remove'));

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await loadPlannedDays()).toEqual([]));
    expect(await db.workoutDays.count()).toBe(1);
  });

  it('does not warn when the date has no logged workout', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { user } = renderScreen();

    await user.click(cell('Assign plan'));
    await user.click(cell('Any category: Legs'));

    await waitFor(async () => expect(await loadPlannedDays()).toHaveLength(1));
    expect(alert).not.toHaveBeenCalled();
  });

  it('never writes a logged workout through any planning action', async () => {
    const { day, row, set } = await logDay('2026-11-12');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { user } = renderScreen();

    await user.click(cell('Assign 2026-11-12'));
    await user.click(cell('Any category: Pull'));
    await waitFor(async () => expect(await loadPlannedDays()).toHaveLength(1));

    await user.click(cell('Remove 2026-11-12'));
    await waitFor(async () => expect(await loadPlannedDays()).toEqual([]));

    expect(await db.workoutDays.get(day.id)).toEqual(day);
    expect(await db.workoutExercises.get(row.id)).toEqual(row);
    expect(await db.workoutSets.get(set.id)).toEqual(set);
    expect(await db.workoutDays.count()).toBe(1);
    expect(await db.workoutExercises.count()).toBe(1);
    expect(await db.workoutSets.count()).toBe(1);
  });
});

describe('copy', () => {
  it('says "Plan your days" rather than "Plan the week"', async () => {
    renderScreen();

    expect(screen.getByText(/plan your/i)).toBeTruthy();
    expect(screen.queryByText(/plan the week/i)).toBeNull();
    await settleDatabaseReads();
  });
});
