// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseBlock from '../components/ExerciseBlock';
import SetRow from '../components/SetRow';
import WorkoutScreen from '../screens/WorkoutScreen';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import { addExerciseToDay } from '../db/workout';
import { computeExercisePr } from '../lib/pr';
import type { ExercisePR, SetPerformance } from '../lib/pr';
import { getPRsForExercises } from '../db/personalRecords';
import type { SessionExercise } from '../db/workout';
import type { WorkoutSet } from '../types';

/**
 * Phase 5b UI: current-PR line and trophy marker.
 *
 * Every PR shown here comes from the Phase 5a engine (`computeExercisePr`) or the
 * real PR read (`getPRsForExercises`). No PR arithmetic is written in this file -- it
 * asserts presentation and freshness only.
 *
 * Note on interaction: a set only qualifies for a PR once it is *completed*
 * (Phase 5a rule), so the logging helpers tick the row's checkbox. Weight is
 * committed on blur, which is why the draft test types without leaving the field.
 */

vi.mock('../db/personalRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/personalRecords')>();
  return { ...actual, getPRsForExercises: vi.fn(actual.getPRsForExercises) };
});

const actualRecords = await vi.importActual<typeof import('../db/personalRecords')>(
  '../db/personalRecords',
);
const realGetPRsForExercises = actualRecords.getPRsForExercises;

beforeEach(async () => {
  vi.mocked(getPRsForExercises).mockClear();
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  vi.mocked(getPRsForExercises).mockReset();
  vi.mocked(getPRsForExercises).mockImplementation(realGetPRsForExercises);
  await db.delete();
});

const DATE = '2026-11-10';

const baseSet = (overrides: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id: 'set-1',
  workoutExerciseId: 'session-1',
  workoutDayId: 'day-1',
  setNumber: 1,
  weightKg: 100,
  reps: 5,
  completed: true,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const baseSession = (overrides: Partial<SessionExercise> = {}): SessionExercise => ({
  id: 'session-1',
  workoutDayId: 'day-1',
  exerciseId: 'exercise-1',
  exerciseName: 'Squat',
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  sets: [baseSet()],
  ...overrides,
});

/** Build an ExercisePR through the real engine, so no PR maths lives in tests. */
function prFrom(sets: Partial<SetPerformance>[]): ExercisePR {
  return computeExercisePr(
    'exercise-1',
    sets.map((set, index) => ({
      setId: `perf-${index}`,
      workoutExerciseId: 'session-1',
      workoutDayId: 'day-1',
      exerciseId: 'exercise-1',
      exerciseName: 'Squat',
      date: DATE,
      exerciseOrder: 0,
      setNumber: index + 1,
      weightKg: 100,
      reps: 5,
      completed: true,
      createdAt: index,
      ...set,
    })),
  );
}

/** The committed weight shown in a row, read from its input. */
function rowWeight(li: HTMLElement): string {
  return (within(li).getByPlaceholderText(/^(kg|lb)$/) as HTMLInputElement).value;
}

function renderBlock(options: { pr?: ExercisePR | null; unit?: 'kg' | 'lb'; sets?: WorkoutSet[] } = {}) {
  render(
    <ExerciseBlock
      session={baseSession({ sets: options.sets ?? [baseSet()] })}
      index={0}
      total={1}
      unit={options.unit ?? 'kg'}
      intensity="universal"
      pr={options.pr ?? null}
      onMove={() => {}}
      onRename={() => {}}
      onDeleteExercise={() => {}}
      onAddSet={() => {}}
      onChangeSet={() => {}}
      onToggleSet={() => {}}
      onDeleteSet={() => {}}
    />,
  );
}

async function seedExercise(name = 'Squat') {
  const exercise = await createExercise(name);
  const session = await addExerciseToDay(DATE, exercise, 'universal');
  return { exercise, session };
}

async function renderWorkout() {
  const result = render(<WorkoutScreen date={DATE} onBack={() => {}} />);
  await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));
  return result;
}

function weightInput(setNumber: number, index = 0): HTMLInputElement {
  return (screen.getAllByLabelText(`Weight for set ${setNumber}`) as HTMLInputElement[])[index];
}

/** Type a weight and commit it by leaving the field, the way a user does. */
async function typeWeight(setNumber: number, value: string, index = 0) {
  const user = userEvent.setup();
  const input = weightInput(setNumber, index);
  await user.click(input);
  await user.clear(input);
  await user.type(input, value);
  await user.tab();
  await waitFor(() => expect(weightInput(setNumber, index).value).toBe(value));
}

/** Weight plus completion: only a completed set can hold a PR. */
async function logSet(setNumber: number, value: string, index = 0) {
  const user = userEvent.setup();
  await typeWeight(setNumber, value, index);
  const box = screen.getAllByLabelText(`Set ${setNumber} complete`)[index];
  if (box.getAttribute('aria-checked') === 'false') await user.click(box);
  await waitFor(() =>
    expect(screen.getAllByLabelText(`Set ${setNumber} complete`)[index].getAttribute('aria-checked')).toBe('true'),
  );
}

async function toggleComplete(setNumber: number, index = 0) {
  await userEvent.setup().click(screen.getAllByLabelText(`Set ${setNumber} complete`)[index]);
}

describe('trophy marker', () => {
  it('appears only on the PR set and carries an accessible label', () => {
    const sets = [
      baseSet({ id: 'set-1', setNumber: 1, weightKg: 90 }),
      baseSet({ id: 'set-2', setNumber: 2, weightKg: 110 }),
    ];
    const pr = prFrom([
      { setId: 'set-1', setNumber: 1, weightKg: 90 },
      { setId: 'set-2', setNumber: 2, weightKg: 110 },
    ]);

    renderBlock({ pr, sets });

    const marks = screen.getAllByLabelText('Personal record set');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('★');
    expect(rowWeight(marks[0].closest('li') as HTMLElement)).toBe('110');
  });

  it('renders no trophy when there is no PR', () => {
    renderBlock({ pr: null });
    expect(screen.queryByLabelText('Personal record set')).toBeNull();
  });

  it('keeps the row controls and touch targets intact', () => {
    renderBlock({ pr: prFrom([{ setId: 'set-1', setNumber: 1 }]), sets: [baseSet({ id: 'set-1' })] });

    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByLabelText('Delete set 1').className).toContain('h-11');
    expect(screen.getByPlaceholderText('kg')).toBeTruthy();
  });

  it('shows the trophy through SetRow directly (prop is opt-in)', () => {
    const { rerender } = render(
      <SetRow set={baseSet()} unit="kg" onChange={() => {}} onToggle={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByLabelText('Personal record set')).toBeNull();

    rerender(<SetRow set={baseSet()} unit="kg" isPr onChange={() => {}} onToggle={() => {}} onDelete={() => {}} />);
    expect(screen.getByLabelText('Personal record set')).toBeTruthy();
  });
});

describe('current PR display', () => {
  it('shows the current PR in kilograms', () => {
    renderBlock({ pr: prFrom([{ weightKg: 102.058 }]) });
    expect(screen.getByText('PR 102.058 kg')).toBeTruthy();
  });

  it('shows the current PR in pounds when the unit is lb', () => {
    renderBlock({ pr: prFrom([{ weightKg: 102.058 }]), unit: 'lb' });
    expect(screen.getByText('PR 224.999 lb')).toBeTruthy();
    expect(screen.queryByText('PR 102.058 kg')).toBeNull();
  });

  it('omits the line entirely when there is no current PR', () => {
    renderBlock({ pr: null });
    expect(screen.queryByText(/^PR /)).toBeNull();

    renderBlock({ pr: prFrom([{ weightKg: null }]) });
    expect(screen.queryByText(/^PR /)).toBeNull();
  });

  it('does not show a PR for blank or zero weights', () => {
    const pr = prFrom([{ weightKg: null }, { weightKg: 0 }]);
    expect(pr.current).toBeNull();
    renderBlock({ pr });
    expect(screen.queryByLabelText('Personal record set')).toBeNull();
    expect(screen.queryByText(/^PR /)).toBeNull();
  });
});

describe('workout screen PR flow', () => {
  it('creates a PR when a set is logged, and moves it when a heavier set is logged', async () => {
    await seedExercise();
    await renderWorkout();

    expect(screen.queryByText(/^PR /)).toBeNull();

    await logSet(1, '100');
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    expect(screen.getAllByLabelText('Personal record set')).toHaveLength(1);

    await logSet(2, '120');
    await waitFor(() => expect(screen.getByText('PR 120 kg')).toBeTruthy());

    const marks = screen.getAllByLabelText('Personal record set');
    expect(marks).toHaveLength(1);
    expect(rowWeight(marks[0].closest('li') as HTMLElement)).toBe('120');
  });

  it('restores the previous best when the PR set is deleted', async () => {
    await seedExercise();
    await renderWorkout();

    await logSet(1, '100');
    await logSet(2, '120');
    await waitFor(() => expect(screen.getByText('PR 120 kg')).toBeTruthy());

    await userEvent.setup().click(screen.getByLabelText('Delete set 2'));

    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    expect(screen.queryByText('PR 120 kg')).toBeNull();
    const marks = screen.getAllByLabelText('Personal record set');
    expect(marks).toHaveLength(1);
    expect(rowWeight(marks[0].closest('li') as HTMLElement)).toBe('100');
  });

  it('demotes the PR when the record set is unchecked', async () => {
    await seedExercise();
    await renderWorkout();

    await logSet(1, '100');
    await logSet(2, '120');
    await waitFor(() => expect(screen.getByText('PR 120 kg')).toBeTruthy());

    await toggleComplete(2);

    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());
    expect(screen.queryByText('PR 120 kg')).toBeNull();
  });

  it('ignores a typed weight that has not been committed', async () => {
    await seedExercise();
    await renderWorkout();

    await logSet(1, '100');
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());

    // Type into another row but never leave the field: no write, so no PR move.
    await userEvent.setup().type(weightInput(2), '150');
    expect(screen.getByText('PR 100 kg')).toBeTruthy();
    expect(screen.queryByText('PR 150 kg')).toBeNull();
  });

  it('shows the same PR on both blocks when an exercise appears twice in a day', async () => {
    const exercise = await createExercise('Squat');
    await addExerciseToDay(DATE, exercise, 'universal');
    await addExerciseToDay(DATE, exercise, 'universal');
    await renderWorkout();

    await logSet(1, '100', 0);

    await waitFor(() => expect(screen.getAllByText('PR 100 kg')).toHaveLength(2));
    expect(screen.getAllByLabelText('Personal record set')).toHaveLength(1);
  });

  it('reformats the existing PR on a unit switch without re-fetching', async () => {
    await seedExercise();
    await renderWorkout();

    await logSet(1, '100');
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());

    const callsBefore = vi.mocked(getPRsForExercises).mock.calls.length;
    await userEvent.setup().click(screen.getByRole('button', { name: 'lb' }));

    await waitFor(() => expect(screen.getByText('PR 220.462 lb')).toBeTruthy());
    expect(screen.queryByText('PR 100 kg')).toBeNull();
    expect(vi.mocked(getPRsForExercises).mock.calls.length).toBe(callsBefore);
  });
});

describe('freshness guarantees', () => {
  it('cannot display stale PR data when refreshes complete out of order', async () => {
    const { exercise } = await seedExercise();

    // The first PR read is slow and resolves with an old best; later reads are
    // immediate. Without the generation guard the slow answer would win.
    const stale = prFrom([{ setId: 'stale', weightKg: 100 }]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    vi.mocked(getPRsForExercises).mockImplementationOnce(async () => {
      await gate;
      return new Map([[exercise.id, stale]]);
    });

    await renderWorkout();
    await logSet(1, '120');

    await waitFor(() => expect(screen.getByText('PR 120 kg')).toBeTruthy());

    release();
    await act(async () => {
      await gate;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText('PR 120 kg')).toBeTruthy();
    expect(screen.queryByText('PR 100 kg')).toBeNull();
  });

  it('drops PR state instead of showing a stale one when a lookup fails', async () => {
    await seedExercise();
    await renderWorkout();

    await logSet(1, '100');
    await waitFor(() => expect(screen.getByText('PR 100 kg')).toBeTruthy());

    // Next lookup fails: the indicator must disappear, not linger as "current".
    vi.mocked(getPRsForExercises).mockRejectedValueOnce(new Error('read failed'));
    await userEvent.setup().click(screen.getByLabelText('Delete set 2'));

    await waitFor(() => expect(screen.queryByText('PR 100 kg')).toBeNull());
    expect(screen.queryByLabelText('Personal record set')).toBeNull();
    // Logging still works after the failed read: the rows are still there.
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.getByText(/exercises ·/)).toBeTruthy();
  });
});
