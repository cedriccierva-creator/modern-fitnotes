// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkoutScreen from '../screens/WorkoutScreen';
import SetRow from '../components/SetRow';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import { addExerciseToDay } from '../db/workout';
import { settleDatabaseReads, trackDatabaseReads } from './db-quiescence';

/**
 * Logging fixes: weight drafts and completion toggles.
 *
 * A set's weight is only in the database once it is committed, and a toggle
 * re-renders the row from the database. These tests pin the resulting contract:
 *
 *  - A. no blur, then toggle  -> ONE updateSet (weight + completed), ONE refresh
 *  - B. blur saved, then toggle -> the weight is not written a second time
 *  - C. blur still pending, then toggle -> ordered, no duplicate weight write
 *  - D. blur write rejects -> the value stays eligible for retry
 *  - E. invalid draft -> stored weight preserved, completion still toggles
 *  - F. empty draft -> weightKg: null persisted
 *  - G. reps behaviour unchanged
 *
 * Assertions read IndexedDB directly; DOM assertions only corroborate.
 */

const DATE = '2026-11-10';

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();

  // 1. Let every read started by the test finish, including the refresh a
  //    toggle fires. `cleanup()` unmounts, which stops new ones from starting.
  //    This must run before `restoreAllMocks`, because the read tracking itself
  //    is implemented with spies and restoring them first would blind it.
  await settleDatabaseReads();

  vi.restoreAllMocks();

  // 2. Only then close the database, so nothing is left talking to it.
  //    Closing is explicit: `db.delete()` resolves once the delete request
  //    succeeds, but a Dexie instance left holding an open connection would
  //    otherwise be re-opened by a late read and fire its on('ready') event
  //    after this test environment is gone.
  await db.close();
  await db.delete();
});

async function seedExercise() {
  const exercise = await createExercise('Squat');
  await addExerciseToDay(DATE, exercise, 'universal');
  return exercise;
}

async function renderWorkout() {
  render(<WorkoutScreen date={DATE} onBack={() => {}} />);
  await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));
}

function weightInput(setNumber: number): HTMLInputElement {
  return screen.getByLabelText(`Weight for set ${setNumber}`) as HTMLInputElement;
}

function completeButton(setNumber: number): HTMLElement {
  return screen.getByLabelText(`Set ${setNumber} complete`);
}

async function storedSet(setNumber: number) {
  const rows = await db.workoutSets.toArray();
  return rows.find((row) => row.setNumber === setNumber);
}

/**
 * The real data layer, imported as a namespace so individual functions can be
 * wrapped and counted while every call still hits IndexedDB.
 */
const dataLayer = await import('../db/workout');

/**
 * Wrap the reads `WorkoutScreen` issues, so teardown can wait for them.
 * The helper explains the two teardown errors this prevents.
 */
trackDatabaseReads(dataLayer, ['loadDay']);
trackDatabaseReads(await import('../db/exercises'), ['loadExercises']);
trackDatabaseReads(await import('../db/personalRecords'), [
  'getPRsForExercise',
  'loadExercisePerformance',
]);
trackDatabaseReads(await import('../db/settings'), ['loadWeightUnit']);

describe('A. completing without blurring the weight', () => {
  it('saves the typed weight with one updateSet and one refresh', async () => {
    await seedExercise();

    render(<WorkoutScreen date={DATE} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));

    const user = userEvent.setup();
    await user.click(weightInput(1));
    await user.type(weightInput(1), '100');

    // Count only what the toggle itself triggers.
    const writes: unknown[] = [];
    let refreshes = 0;
    const realUpdateSet = dataLayer.updateSet;
    const realLoadDay = dataLayer.loadDay;
    const writeSpy = vi.spyOn(dataLayer, 'updateSet').mockImplementation(async (id, patch) => {
      writes.push(patch);
      return realUpdateSet(id, patch);
    });
    const readSpy = vi.spyOn(dataLayer, 'loadDay').mockImplementation(async (date) => {
      refreshes += 1;
      return realLoadDay(date);
    });

    // Dispatch the toggle without moving focus: `userEvent.click` would fire the
    // field's blur first and hide the path this test exists to cover.
    fireEvent.click(completeButton(1));

    await waitFor(async () => expect(await storedSet(1)).toMatchObject({ weightKg: 100, completed: true }));
    await waitFor(() => expect(refreshes).toBe(1));

    // Exactly one write, carrying both fields, and exactly one refresh.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ weightKg: 100, completed: true });
    expect(refreshes).toBe(1);

    // And the row renders from the persisted value.
    await waitFor(() => expect(weightInput(1).value).toBe('100'));

    writeSpy.mockRestore();
    readSpy.mockRestore();
  });
});

describe('B. blur saved, then toggle', () => {
  it('does not write the same weight a second time and still toggles completion', async () => {
    await seedExercise();
    await renderWorkout();

    const user = userEvent.setup();
    await user.click(weightInput(1));
    await user.type(weightInput(1), '80');
    await user.tab(); // blur commits
    await waitFor(async () => expect((await storedSet(1))?.weightKg).toBe(80));

    const writes: unknown[] = [];
    const realUpdateSet = dataLayer.updateSet;
    const spy = vi.spyOn(dataLayer, 'updateSet').mockImplementation(async (id, patch) => {
      writes.push(patch);
      return realUpdateSet(id, patch);
    });

    await user.click(completeButton(1));
    await waitFor(async () => expect(await storedSet(1)).toMatchObject({ weightKg: 80, completed: true }));

    // The weight is never rewritten: no patch after the blur carries weightKg.
    const weightWrites = writes.filter(
      (patch) => (patch as { weightKg?: unknown }).weightKg !== undefined,
    );
    expect(weightWrites).toHaveLength(0);

    // Completion is written exactly once, without a redundant weight.
    const completionWrites = writes.filter(
      (patch) => (patch as { completed?: boolean }).completed !== undefined,
    );
    expect(completionWrites).toEqual([{ completed: true }]);

    spy.mockRestore();
  });
});

describe('C. blur write still pending, then toggle', () => {
  it('waits for the pending weight write instead of duplicating it', async () => {
    await seedExercise();
    await renderWorkout();

    const writes: unknown[] = [];
    const realUpdateSet = dataLayer.updateSet;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;

    const spy = vi.spyOn(dataLayer, 'updateSet').mockImplementation(async (id, patch) => {
      writes.push(patch);
      if (first) {
        first = false;
        await gate; // hold the blur write open
      }
      return realUpdateSet(id, patch);
    });

    const user = userEvent.setup();
    await user.click(weightInput(1));
    await user.type(weightInput(1), '90');
    await user.tab(); // blur starts a write that stays in flight

    // Toggle while that write is still pending.
    fireEvent.click(completeButton(1));
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));

    // Nothing is marked saved and no duplicate weight write is issued yet.
    expect(writes[0]).toMatchObject({ weightKg: 90 });

    release();
    await waitFor(async () => expect(await storedSet(1)).toMatchObject({ weightKg: 90, completed: true }));

    // The weight appears once; the toggle then sends completion only.
    const weightWrites = writes.filter((patch) => (patch as { weightKg?: number }).weightKg !== undefined);
    expect(weightWrites).toHaveLength(1);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({ completed: true });

    spy.mockRestore();
  });
});

describe('D. blur write fails', () => {
  it('keeps the value eligible for a later retry instead of treating it as saved', async () => {
    await seedExercise();
    await renderWorkout();

    const writes: unknown[] = [];
    const realUpdateSet = dataLayer.updateSet;
    let failNext = true;
    const spy = vi.spyOn(dataLayer, 'updateSet').mockImplementation(async (id, patch) => {
      writes.push(patch);
      if (failNext) {
        failNext = false;
        throw new Error('write failed');
      }
      return realUpdateSet(id, patch);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    await user.click(weightInput(1));
    await user.type(weightInput(1), '70');
    await user.tab(); // this write rejects

    await waitFor(() => expect(writes).toHaveLength(1));
    // Not persisted, and not silently accepted as saved.
    expect((await storedSet(1))?.weightKg).toBeNull();

    // A later toggle must retry the value rather than believe it is saved.
    fireEvent.click(completeButton(1));
    await waitFor(async () => expect(await storedSet(1)).toMatchObject({ weightKg: 70, completed: true }));
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ weightKg: 70, completed: true });

    spy.mockRestore();
  });

  it('retries on a later blur with the same draft', async () => {
    await seedExercise();
    await renderWorkout();

    const writes: unknown[] = [];
    const realUpdateSet = dataLayer.updateSet;
    let failNext = true;
    const spy = vi.spyOn(dataLayer, 'updateSet').mockImplementation(async (id, patch) => {
      writes.push(patch);
      if (failNext) {
        failNext = false;
        throw new Error('write failed');
      }
      return realUpdateSet(id, patch);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    await user.click(weightInput(1));
    await user.type(weightInput(1), '60');
    await user.tab(); // fails
    await waitFor(() => expect(writes).toHaveLength(1));

    // Blurring again with the same text retries, because it never saved.
    fireEvent.focus(weightInput(1));
    fireEvent.blur(weightInput(1));
    await waitFor(async () => expect((await storedSet(1))?.weightKg).toBe(60));
    expect(writes).toHaveLength(2);

    spy.mockRestore();
  });
});

describe('E. invalid draft text', () => {
  it('preserves the stored weight while completion still toggles', async () => {
    await seedExercise();
    await renderWorkout();

    const user = userEvent.setup();
    await user.click(weightInput(1));
    await user.type(weightInput(1), '80');
    await user.tab();
    await waitFor(async () => expect((await storedSet(1))?.weightKg).toBe(80));

    await user.click(weightInput(1));
    await user.clear(weightInput(1));
    await user.type(weightInput(1), 'abc');
    fireEvent.click(completeButton(1));

    await waitFor(async () => expect(await storedSet(1)).toMatchObject({ weightKg: 80, completed: true }));
  });
});

describe('F. empty draft', () => {
  it('persists weightKg null and clears the PR', async () => {
    await seedExercise();
    await renderWorkout();

    const user = userEvent.setup();
    await user.click(weightInput(1));
    await user.type(weightInput(1), '80');
    await user.tab();
    await waitFor(async () => expect((await storedSet(1))?.weightKg).toBe(80));

    await user.click(weightInput(1));
    await user.clear(weightInput(1));
    fireEvent.click(completeButton(1));

    await waitFor(async () => expect(await storedSet(1)).toMatchObject({ weightKg: null, completed: true }));
    expect(screen.queryByText(/^PR /)).toBeNull();
  });
});

describe('G. reps behaviour is unchanged', () => {
  it('commits reps on blur only, never on the completion toggle', async () => {
    await seedExercise();
    await renderWorkout();

    const user = userEvent.setup();
    const reps = screen.getByLabelText('Repetitions for set 1') as HTMLInputElement;
    await user.click(reps);
    await user.clear(reps);
    await user.type(reps, '12');

    // Typing alone changes nothing in the database.
    expect((await storedSet(1))?.reps).toBe(10);

    await user.tab();
    await waitFor(async () => expect((await storedSet(1))?.reps).toBe(12));
  });

  it('leaves completion toggling alone when reps were never edited', async () => {
    await seedExercise();
    await renderWorkout();

    await userEvent.setup().click(completeButton(1));
    await waitFor(async () => expect((await storedSet(1))?.completed).toBe(true));
    // The row only reports completion once the refresh has applied the write,
    // so waiting for it also waits for the refresh to settle.
    await waitFor(() => expect(completeButton(1).getAttribute('aria-checked')).toBe('true'));
    // Untouched reps keep their generated value.
    expect((await storedSet(1))?.reps).toBe(10);
  });
});

describe('no per-keystroke writes', () => {
  it('writes nothing to IndexedDB while typing', async () => {
    await seedExercise();
    await renderWorkout();

    const user = userEvent.setup();
    await user.click(weightInput(1));

    for (const digit of ['1', '0', '0']) {
      await user.keyboard(digit);
      expect((await storedSet(1))?.weightKg).toBeNull();
    }
    expect((await storedSet(1))?.weightKg).toBeNull();

    await user.tab();
    await waitFor(async () => expect((await storedSet(1))?.weightKg).toBe(100));
  });
});

describe('SetRow contract in isolation', () => {
  const BASE = {
    id: 'set-1',
    workoutExerciseId: 'session-1',
    workoutDayId: 'day-1',
    setNumber: 1,
    weightKg: null as number | null,
    reps: 5,
    completed: false,
    createdAt: 0,
    updatedAt: 0,
  };

  it('sends the draft in the toggle patch and never through onChange', async () => {
    const onChange = vi.fn();
    const onToggle = vi.fn();
    render(
      <SetRow set={BASE} unit="kg" onChange={onChange} onToggle={onToggle} onDelete={() => {}} />,
    );

    const input = screen.getByPlaceholderText('kg') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('checkbox'));

    expect(onToggle).toHaveBeenCalledWith({ weightKg: 55 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggles without a patch when the draft is already saved', async () => {
    const onToggle = vi.fn();
    render(
      <SetRow
        set={{ ...BASE, weightKg: 55 }}
        unit="kg"
        onChange={() => {}}
        onToggle={onToggle}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith();
  });

  it('ignores unparseable text but still toggles', async () => {
    const onToggle = vi.fn();
    render(
      <SetRow set={{ ...BASE, weightKg: 40 }} unit="kg" onChange={() => {}} onToggle={onToggle} onDelete={() => {}} />,
    );

    fireEvent.change(screen.getByPlaceholderText('kg'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith();
  });
});
