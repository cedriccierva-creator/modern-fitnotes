// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExerciseBlock from '../components/ExerciseBlock';
import SetRow from '../components/SetRow';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import { addExerciseToDay, deleteSet, removeExerciseFromDay, updateSet } from '../db/workout';
import { getPRsForExercise } from '../db/personalRecords';
import { setPlannedTemplate } from '../db/planned';
import type { SessionExercise } from '../db/workout';
import { recordLabel } from '../lib/pr';
import type { ExercisePR, RecordAchievements, SetRecord } from '../lib/pr';
import type { WorkoutSet } from '../types';

/**
 * Phase 6A step 2 UI: record badges on the exact set, plus the session-volume
 * line. Presentation only — every record shown comes from the real engine via
 * `getPRsForExercise`, so no record arithmetic lives in this file.
 */

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

/** Render one exercise block with explicit records per set id. */
function renderBlock({
  sets = [baseSet()],
  records = {},
  pr = null,
  session = baseSession({ sets }),
  unit = 'kg',
}: {
  sets?: WorkoutSet[];
  records?: Record<string, SetRecord[]>;
  pr?: Parameters<typeof makePr>[0] | null;
  session?: SessionExercise;
  unit?: 'kg' | 'lb';
} = {}) {
  const exercisePr = pr === null ? null : makePr(pr);
  const withBadges =
    exercisePr === null || exercisePr.achievements === undefined
      ? exercisePr
      : {
          ...exercisePr,
          achievements: {
            ...exercisePr.achievements,
            bySetId: new Map(Object.entries(records)),
          },
        };

  return render(
    <ExerciseBlock
      session={session}
      index={0}
      total={1}
      unit={unit}
      intensity="universal"
      pr={withBadges}
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

/**
 * An ExercisePR carrying an achievements block. Built by hand so the badge
 * rendering can be tested without a database, while still using the real types.
 */
function makePr({
  current = null,
  achievements = undefined,
}: {
  current?: { setId: string; weightKg: number } | null;
  achievements?: {
    volumeWorkoutExerciseId?: string;
    volumeKg?: number;
    /** Current holders, so the emphasis and the summary can be exercised. */
    current?: Record<string, SetRecord[]>;
    weightKg?: number;
    estimatedKg?: number;
    maxReps?: number;
  };
} = {}): ExercisePR {
  const hasAchievements = achievements !== undefined;
  return {
    exerciseId: 'exercise-1',
    exerciseName: 'Squat',
    current:
      current === null
        ? null
        : {
            setId: current.setId,
            workoutExerciseId: 'session-1',
            workoutDayId: 'day-1',
            date: DATE,
            setNumber: 1,
            weightKg: current.weightKg,
            reps: 5,
          },
    history: [],
    trophySetIds: current === null ? [] : [current.setId],
    achievements: hasAchievements
      ? {
          bySetId: new Map<string, SetRecord[]>(),
          currentBySetId: new Map(Object.entries(achievements.current ?? {})),
          weight:
            achievements.weightKg === undefined
              ? null
              : { setId: 'session-1', weightKg: achievements.weightKg },
          estimatedOneRepMax:
            achievements.estimatedKg === undefined
              ? null
              : {
                  setId: 'session-1',
                  workoutExerciseId: 'session-1',
                  workoutDayId: 'day-1',
                  date: DATE,
                  setNumber: 1,
                  weightKg: 100,
                  reps: 5,
                  estimatedKg: achievements.estimatedKg,
                },
          maxReps:
            achievements.maxReps === undefined
              ? null
              : {
                  setId: 'session-1',
                  workoutExerciseId: 'session-1',
                  workoutDayId: 'day-1',
                  date: DATE,
                  setNumber: 1,
                  reps: achievements.maxReps,
                  weightKg: 100,
                },
          volume:
            achievements.volumeWorkoutExerciseId === undefined
              ? null
              : {
                  workoutExerciseId: achievements.volumeWorkoutExerciseId,
                  workoutDayId: 'day-1',
                  date: DATE,
                  volumeKg: achievements.volumeKg ?? 1000,
                  setCount: 2,
                },
          setCount: 0,
          // The real label table, so a badge can never show an unnamed record.
          labels: Object.fromEntries(
            ([
              'weight', 'estimatedOneRepMax', 'maxReps',
              'rm1', 'rm2', 'rm3', 'rm4', 'rm5', 'rm6', 'rm7', 'rm8', 'rm9', 'rm10',
            ] as SetRecord[]).map((record) => [record, recordLabel(record)]),
          ) as RecordAchievements['labels'],
        }
      : undefined,
  };
}

const badges = (setNumber: number): HTMLElement[] =>
  within(screen.getByLabelText(`Records for set ${setNumber}`)).getAllByRole('listitem');

describe('record badges on a set', () => {
  it('shows every record a set established, not just one', () => {
    renderBlock({
      sets: [baseSet({ id: 'hero', setNumber: 1 })],
      records: { hero: ['weight', 'estimatedOneRepMax', 'maxReps', 'rm8'] },
      pr: { current: { setId: 'hero', weightKg: 110 }, achievements: {} },
    });

    const marks = badges(1);
    expect(marks.map((mark) => mark.textContent)).toEqual(['PR', 'e1RM', 'Reps', '8RM']);
  });

  it('labels each badge accessibly so the record type is never colour-only', () => {
    renderBlock({
      sets: [baseSet({ id: 'hero', setNumber: 1 })],
      records: { hero: ['weight', 'estimatedOneRepMax', 'rm1'] },
      pr: {
        current: { setId: 'hero', weightKg: 150 },
        // All three records are still this set's, so all three read "current".
        achievements: { current: { hero: ['weight', 'estimatedOneRepMax', 'rm1'] } },
      },
    });

    const marks = badges(1);
    expect(marks[0].getAttribute('aria-label')).toBe('Heaviest weight record, current best');
    expect(marks[1].getAttribute('aria-label')).toBe('Estimated 1RM record, current best');
    expect(marks[2].getAttribute('aria-label')).toBe('1RM record, current best');
  });

  it('marks a surpassed record as historical without removing it', () => {
    // The set established all three records, but only 1RM is still its own.
    renderBlock({
      sets: [baseSet({ id: 'hero', setNumber: 1 })],
      records: { hero: ['weight', 'estimatedOneRepMax', 'rm1'] },
      pr: {
        current: { setId: 'hero', weightKg: 150 },
        achievements: { current: { hero: ['rm1'] } },
      },
    });

    const marks = badges(1);
    // The badge is still rendered: history is never rewritten.
    expect(marks).toHaveLength(3);
    expect(marks[0].getAttribute('aria-label')).toBe('Heaviest weight record, since surpassed');
    expect(marks[1].getAttribute('aria-label')).toBe('Estimated 1RM record, since surpassed');
    expect(marks[2].getAttribute('aria-label')).toBe('1RM record, current best');
  });

  it('puts the badges on the exact set that earned them', () => {
    renderBlock({
      sets: [
        baseSet({ id: 'set-1', setNumber: 1, weightKg: 90 }),
        baseSet({ id: 'set-2', setNumber: 2, weightKg: 110 }),
      ],
      records: { 'set-2': ['weight', 'rm5'] },
      pr: { current: { setId: 'set-2', weightKg: 110 }, achievements: {} },
    });

    expect(screen.queryByLabelText('Records for set 1')).toBeNull();
    expect(badges(2).map((mark) => mark.textContent)).toEqual(['PR', '5RM']);
  });

  it('renders no badge row when a set holds no record', () => {
    renderBlock({ records: {}, pr: { achievements: {} } });
    expect(screen.queryByLabelText('Records for set 1')).toBeNull();
  });

  it('keeps the existing trophy and touch targets intact', () => {
    renderBlock({
      sets: [baseSet({ id: 'hero', setNumber: 1 })],
      records: { hero: ['weight'] },
      pr: { current: { setId: 'hero', weightKg: 110 }, achievements: {} },
    });

    // The Phase 5b trophy is still there, unchanged.
    expect(screen.getByLabelText('Personal record set').textContent).toBe('★');
    expect(screen.getByLabelText('Delete set 1').className).toContain('h-11');
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });

  it('keeps the current-PR line correct alongside the badges', () => {
    renderBlock({
      sets: [baseSet({ id: 'hero', setNumber: 1, weightKg: 110 })],
      records: { hero: ['weight', 'rm5'] },
      pr: { current: { setId: 'hero', weightKg: 110 }, achievements: {} },
    });

    expect(screen.getByText('PR 110 kg')).toBeTruthy();
  });

  it('works through SetRow directly, with records opt-in', () => {
    const { rerender } = render(
      <SetRow set={baseSet()} unit="kg" onChange={() => {}} onToggle={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByLabelText('Records for set 1')).toBeNull();

    rerender(
      <SetRow
        set={baseSet()}
        unit="kg"
        records={['weight', 'rm3']}
        onChange={() => {}}
        onToggle={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(badges(1).map((mark) => mark.textContent)).toEqual(['PR', '3RM']);
  });
});

describe('session volume indicator', () => {
  it('shows the volume record on the session that holds it', () => {
    renderBlock({ pr: { achievements: { volumeWorkoutExerciseId: 'session-1', volumeKg: 1500 } } });

    expect(screen.getByText('Best volume 1500 kg·reps')).toBeTruthy();
    expect(screen.getByLabelText('Best session volume record')).toBeTruthy();
  });

  it('labels the volume with the rep multiplier in the active unit', () => {
    // 1500 kg = 3307.… lb, so the figure follows the unit toggle while the
    // `·reps` multiplier stays put: volume is weight x reps, not a weight.
    renderBlock({ pr: { achievements: { volumeWorkoutExerciseId: 'session-1', volumeKg: 1500 } }, unit: 'lb' });

    const text = screen.getByText(/Best volume/).textContent ?? '';
    expect(text).toContain('lb·reps');
    expect(text).not.toContain('kg·reps');
  });

  it('does not show it on a different session of the same exercise', () => {
    renderBlock({ pr: { achievements: { volumeWorkoutExerciseId: 'other-session' } } });

    expect(screen.queryByText(/Best volume/)).toBeNull();
  });

  it('never attaches the volume record to a set row', () => {
    renderBlock({
      sets: [baseSet({ id: 'set-1', setNumber: 1 })],
      records: { 'set-1': ['weight'] },
      pr: { current: { setId: 'set-1', weightKg: 100 }, achievements: { volumeWorkoutExerciseId: 'session-1' } },
    });

    // It is a session line, so no badge mentions it.
    expect(badges(1).map((mark) => mark.textContent)).toEqual(['PR']);
    expect(screen.getByText(/Best volume/)).toBeTruthy();
  });
});

/**
 * A `SessionExercise` for a real database session id, with no sets. The block
 * only reads `session.id`, `exerciseName` and `sets` for display; the sets and
 * records come from the database read, so nothing about the records is faked.
 */
function blockSession(exerciseName: string, sessionId: string): SessionExercise {
  return {
    id: sessionId,
    workoutDayId: 'day-from-db',
    exerciseId: 'exercise-from-db',
    exerciseName,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    sets: [],
  };
}

describe('end to end through the database', () => {
  afterEach(async () => {
    cleanup();
    await db.delete();
  });

  beforeEach(async () => {
    await db.open();
    await db.delete();
    await db.open();
  });

  /** Log one session on a date with explicit sets, then read its records. */
  async function logDay(
    date: string,
    entries: readonly { weightKg: number | null; reps: number; completed?: boolean }[],
  ) {
    const exercise = await createExercise(`Squat ${date}`);
    await addExerciseToDay(date, exercise, 'universal');
    const day = await db.workoutDays.where('date').equals(date).first();
    const session = (await db.workoutExercises.where('workoutDayId').equals(day!.id).toArray())[0];
    const sets = (
      await db.workoutSets.where('workoutExerciseId').equals(session.id).toArray()
    ).sort((a, b) => a.setNumber - b.setNumber);

    for (const [index, entry] of entries.entries()) {
      if (index >= sets.length) break;
      await updateSet(sets[index].id, {
        weightKg: entry.weightKg,
        reps: entry.reps,
        completed: entry.completed ?? true,
      });
    }

    return { exercise, sessionId: session.id, setIds: sets.map((set) => set.id) };
  }

  it('derives achievements from stored history, not from a cache', async () => {
    const { exercise, setIds } = await logDay(DATE, [
      { weightKg: 100, reps: 3 },
      { weightKg: 110, reps: 3 },
      { weightKg: 120, reps: 1 },
    ]);

    const pr = await getPRsForExercise(exercise.id);
    expect(pr.achievements).toBeDefined();

    const first = pr.achievements!.bySetId.get(setIds[0]);
    const third = pr.achievements!.bySetId.get(setIds[2]);

    // Baseline 3RM, then a heavier 3RM (which also takes the weight record),
    // then a 1RM.
    expect(first).toContain('rm3');
    expect(pr.achievements!.bySetId.get(setIds[1])).toContain('rm3');
    expect(third).toContain('rm1');
    expect(pr.achievements!.weight).toEqual({ setId: setIds[2], weightKg: 120 });
  });

  it('recalculates after a historical edit, dropping a badge that no longer holds', async () => {
    const { exercise, setIds } = await logDay(DATE, [
      { weightKg: 100, reps: 5 },
      { weightKg: 110, reps: 5 },
    ]);

    const before = await getPRsForExercise(exercise.id);
    expect(before.achievements!.bySetId.get(setIds[1])).toContain('weight');

    // Edit the earlier set above the later one: the later set never set a record.
    await updateSet(setIds[0], { weightKg: 130 });

    const after = await getPRsForExercise(exercise.id);
    expect(after.achievements!.bySetId.get(setIds[1]) ?? []).not.toContain('weight');
    expect(after.achievements!.bySetId.get(setIds[0])).toContain('weight');
    expect(after.achievements!.weight).toEqual({ setId: setIds[0], weightKg: 130 });
  });

  it('moves the current holders through the database when a later set wins', async () => {
    const { exercise, setIds } = await logDay(DATE, [
      { weightKg: 100, reps: 5 },
      { weightKg: 120, reps: 8 },
    ]);

    const after = await getPRsForExercise(exercise.id);
    const achievements = after.achievements!;

    // The later set now holds weight, estimate, reps and 8RM.
    expect(achievements.weight).toEqual({ setId: setIds[1], weightKg: 120 });
    expect(achievements.estimatedOneRepMax?.setId).toBe(setIds[1]);
    expect(achievements.maxReps?.setId).toBe(setIds[1]);
    expect(achievements.currentBySetId.get(setIds[1])).toContain('weight');

    // The earlier set keeps history but no longer holds the weight record.
    expect(achievements.bySetId.get(setIds[0])).toContain('weight');
    expect(achievements.currentBySetId.get(setIds[0]) ?? []).not.toContain('weight');
  });

  it('moves the holders back when the winning set is deleted', async () => {
    const { exercise, setIds } = await logDay(DATE, [
      { weightKg: 100, reps: 5 },
      { weightKg: 120, reps: 5 },
    ]);

    expect((await getPRsForExercise(exercise.id)).achievements!.weight).toEqual({
      setId: setIds[1],
      weightKg: 120,
    });

    await deleteSet(setIds[1]);

    const after = await getPRsForExercise(exercise.id);
    expect(after.achievements!.weight).toEqual({ setId: setIds[0], weightKg: 100 });
    expect(after.achievements!.currentBySetId.get(setIds[0])).toContain('weight');
  });

  it('recalculates when the record-setting set is deleted', async () => {
    const { exercise, setIds } = await logDay(DATE, [
      { weightKg: 100, reps: 5 },
      { weightKg: 120, reps: 5 },
    ]);

    await deleteSet(setIds[1]);

    const after = await getPRsForExercise(exercise.id);
    expect(after.achievements!.bySetId.get(setIds[1])).toBeUndefined();
    expect(after.achievements!.bySetId.get(setIds[0])).toContain('weight');
    expect(after.achievements!.weight).toEqual({ setId: setIds[0], weightKg: 100 });
  });

  it('drops the volume record when the session holding it is deleted', async () => {
    // Both sessions belong to the same exercise, so volume is genuinely compared.
    const exercise = await createExercise('Deadlift');
    await addExerciseToDay(DATE, exercise, 'universal');
    await addExerciseToDay('2026-11-11', exercise, 'universal');

    const dayA = await db.workoutDays.where('date').equals(DATE).first();
    const dayB = await db.workoutDays.where('date').equals('2026-11-11').first();
    const sessionA = (await db.workoutExercises.where('workoutDayId').equals(dayA!.id).toArray())[0];
    const sessionB = (await db.workoutExercises.where('workoutDayId').equals(dayB!.id).toArray())[0];

    const setA = (await db.workoutSets.where('workoutExerciseId').equals(sessionA.id).toArray())[0];
    const setB = (await db.workoutSets.where('workoutExerciseId').equals(sessionB.id).toArray())[0];

    // A light session, then a much heavier one that takes the volume record.
    await updateSet(setA.id, { weightKg: 50, reps: 5, completed: true });
    await updateSet(setB.id, { weightKg: 100, reps: 5, completed: true });

    const both = await getPRsForExercise(exercise.id);
    expect(both.achievements!.volume?.workoutExerciseId).toBe(sessionB.id);

    // Delete the session holding it: the record must fall back to session A.
    await removeExerciseFromDay(sessionB.id);

    const after = await getPRsForExercise(exercise.id);
    expect(after.achievements!.volume?.workoutExerciseId).toBe(sessionA.id);
    expect(after.achievements!.volume?.volumeKg).toBe(250);
  });

  /**
   * The full data path, with nothing hand-built:
   * IndexedDB -> getPRsForExercise -> ExerciseBlock -> rendered summary.
   */
  it('renders the summary from real database-backed records', async () => {
    const { exercise, setIds, sessionId } = await logDay(DATE, [
      { weightKg: 100, reps: 5 },
      { weightKg: 120, reps: 8 },
    ]);
    const session = blockSession(exercise.name, sessionId);

    const pr = await getPRsForExercise(exercise.id);
    render(
      <ExerciseBlock
        session={session}
        index={0}
        total={1}
        unit="kg"
        intensity="universal"
        pr={pr}
        onMove={() => {}}
        onRename={() => {}}
        onDeleteExercise={() => {}}
        onAddSet={() => {}}
        onChangeSet={() => {}}
        onToggleSet={() => {}}
        onDeleteSet={() => {}}
      />,
    );

    const summary = screen.getByLabelText(`Current records for ${session.exerciseName}`);
    // 120 kg x 8: estimate 120 * (1 + 8/30) = 152; volume 100*5 + 120*8 = 1460.
    expect(summary.textContent).toContain('e1RM');
    expect(summary.textContent).toContain('152 kg');
    expect(summary.textContent).toContain('Reps');
    expect(summary.textContent).toContain('8');
    expect(summary.textContent).toContain('8RM');
    expect(summary.textContent).toContain('Best volume 1460 kg·reps');

    // The heaviest weight has exactly one home: the Phase 5b line. The summary
    // still mentions 120 kg inside its 8RM entry, which is a different record.
    expect(screen.getByText('PR 120 kg')).toBeTruthy();
    expect(screen.queryByLabelText(/^Current heaviest weight/)).toBeNull();

    // The winning set is the only current holder; the earlier one is history.
    expect(pr.achievements!.currentBySetId.get(setIds[1])).toContain('weight');
    expect(pr.achievements!.currentBySetId.get(setIds[0]) ?? []).not.toContain('weight');
  });

  it('updates the rendered summary after a set is edited or deleted', async () => {
    const { exercise, setIds, sessionId } = await logDay(DATE, [
      { weightKg: 100, reps: 5 },
      { weightKg: 120, reps: 8 },
    ]);
    const session = blockSession(exercise.name, sessionId);

    const renderCurrent = async () => {
      cleanup();
      const pr = await getPRsForExercise(exercise.id);
      render(
        <ExerciseBlock
          session={session}
          index={0}
          total={1}
          unit="kg"
          intensity="universal"
          pr={pr}
          onMove={() => {}}
          onRename={() => {}}
          onDeleteExercise={() => {}}
          onAddSet={() => {}}
          onChangeSet={() => {}}
          onToggleSet={() => {}}
          onDeleteSet={() => {}}
        />,
      );
      return pr;
    };

    await renderCurrent();
    expect(screen.getByLabelText(/^Current records/).textContent).toContain('152 kg');

    // Drop the winning set: the summary must fall back to the first set's figures.
    await deleteSet(setIds[1]);
    await renderCurrent();
    const afterDelete = screen.getByLabelText(/^Current records/).textContent ?? '';
    expect(afterDelete).not.toContain('152 kg');
    expect(afterDelete).toContain('116.667'); // 100 * (1 + 5/30)
    expect(screen.getByText('PR 100 kg')).toBeTruthy();
  });

  it('never qualifies an incomplete set', async () => {
    const { exercise, setIds } = await logDay(DATE, [
      { weightKg: 100, reps: 5 },
      { weightKg: 200, reps: 5, completed: false },
    ]);

    const pr = await getPRsForExercise(exercise.id);
    expect(pr.achievements!.bySetId.get(setIds[1])).toBeUndefined();
    expect(pr.achievements!.weight).toEqual({ setId: setIds[0], weightKg: 100 });
  });

  it('records reps for a bodyweight set with no invented load', async () => {
    const { exercise, setIds } = await logDay(DATE, [{ weightKg: null, reps: 12 }]);

    const pr = await getPRsForExercise(exercise.id);
    expect(pr.achievements!.bySetId.get(setIds[0])).toEqual(['maxReps']);
    expect(pr.achievements!.weight).toBeNull();
    expect(pr.achievements!.volume).toBeNull();
  });

  it('ignores planned days entirely', async () => {
    const { exercise } = await logDay(DATE, [{ weightKg: 100, reps: 5 }]);

    // A plan for a *later* date, heavier than anything logged.
    await setPlannedTemplate('2026-11-20', 'custom', 'push');

    const pr = await getPRsForExercise(exercise.id);
    expect(pr.achievements!.weight).toEqual({ setId: expect.any(String), weightKg: 100 });
    expect(pr.achievements!.setCount).toBe(1);
  });
});

/**
 * Phase 6A step 3: current holders in the header, and the split between a
 * historical badge and the "still holds it" emphasis.
 */
describe('current record summary', () => {
  it('renders the estimate, reps and volume without repeating the weight', () => {
    renderBlock({
      pr: {
        current: { setId: 'hero', weightKg: 120 },
        achievements: {
          weightKg: 120,
          estimatedKg: 150,
          maxReps: 12,
          volumeWorkoutExerciseId: 'session-1',
          volumeKg: 1500,
        },
      },
    });

    const summary = screen.getByLabelText('Current records for Squat');
    expect(summary.textContent).toContain('e1RM');
    expect(summary.textContent).toContain('150 kg');
    expect(summary.textContent).toContain('Reps');
    expect(summary.textContent).toContain('12');
    expect(summary.textContent).toContain('Best volume 1500 kg·reps');

    // The heaviest weight is reported once, on the Phase 5b line, not twice.
    expect(summary.textContent).not.toContain('120 kg');
    expect(screen.getAllByText(/120 kg/)).toHaveLength(1);
    expect(screen.getByText('PR 120 kg')).toBeTruthy();
  });

  it('omits the estimate entirely for a bodyweight exercise', () => {
    renderBlock({
      pr: { current: null, achievements: { maxReps: 20 } },
    });

    const summary = screen.getByLabelText('Current records for Squat');
    expect(summary.textContent).toContain('20');
    // No load was ever recorded, so no weight or e1RM figure is invented.
    expect(summary.textContent).not.toContain('e1RM');
    expect(summary.textContent).not.toContain('kg');
  });

  it('renders no summary at all when nothing qualifies', () => {
    renderBlock({ pr: { current: null, achievements: {} } });
    expect(screen.queryByLabelText('Current records for Squat')).toBeNull();
  });

  it('converts every figure with the active unit', () => {
    renderBlock({
      unit: 'lb',
      pr: {
        current: { setId: 'hero', weightKg: 100 },
        achievements: { weightKg: 100, estimatedKg: 100, maxReps: 5 },
      },
    });

    const summary = screen.getByLabelText('Current records for Squat');
    expect(summary.textContent).toContain('220.462 lb');
    expect(summary.textContent).not.toContain(' kg');
  });

  it('gives each figure its own accessible label', () => {
    renderBlock({
      pr: {
        current: { setId: 'hero', weightKg: 120 },
        achievements: { weightKg: 120, estimatedKg: 150, maxReps: 12 },
      },
    });

    // Weight is intentionally absent here; it is announced by the PR line.
    expect(screen.queryByLabelText(/^Current heaviest weight/)).toBeNull();
    expect(screen.getByLabelText('Current estimated 1RM: 150 kg')).toBeTruthy();
    expect(screen.getByLabelText('Current maximum reps: 12')).toBeTruthy();
  });
});

describe('trophy and badge agreement', () => {
  it('puts the trophy on the current weight holder, not on a surpassed set', () => {
    renderBlock({
      sets: [
        baseSet({ id: 'old', setNumber: 1, weightKg: 100 }),
        baseSet({ id: 'new', setNumber: 2, weightKg: 120, workoutExerciseId: 'session-1' }),
      ],
      // The older set established a record, so it keeps its badge...
      records: { old: ['weight'], new: ['weight'] },
      // ...but only `new` still holds it.
      pr: {
        current: { setId: 'new', weightKg: 120 },
        achievements: { current: { new: ['weight'] } },
      },
    });

    const marks = screen.getAllByLabelText('Personal record set');
    expect(marks).toHaveLength(1);
    // The trophy is on set 2, the current holder.
    const row = marks[0].closest('li') as HTMLElement;
    expect((within(row).getByPlaceholderText('kg') as HTMLInputElement).value).toBe('120');

    // Both sets still show the historical badge, and the wording differs.
    expect(badges(1)[0].getAttribute('aria-label')).toBe('Heaviest weight record, since surpassed');
    expect(badges(2)[0].getAttribute('aria-label')).toBe('Heaviest weight record, current best');
  });

  it('never shows two trophies when one set was surpassed in the same day', () => {
    renderBlock({
      sets: [
        baseSet({ id: 'a', setNumber: 1, weightKg: 100 }),
        baseSet({ id: 'b', setNumber: 2, weightKg: 110 }),
      ],
      records: { a: ['weight'], b: ['weight'] },
      pr: {
        current: { setId: 'b', weightKg: 110 },
        achievements: { current: { b: ['weight'] } },
      },
    });

    expect(screen.getAllByLabelText('Personal record set')).toHaveLength(1);
  });
});
