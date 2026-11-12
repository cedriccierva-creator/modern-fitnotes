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
}: {
  sets?: WorkoutSet[];
  records?: Record<string, SetRecord[]>;
  pr?: Parameters<typeof makePr>[0] | null;
  session?: SessionExercise;
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
      unit="kg"
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
  achievements?: { volumeWorkoutExerciseId?: string; volumeKg?: number };
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
          weight: null,
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
      pr: { current: { setId: 'hero', weightKg: 150 }, achievements: {} },
    });

    const marks = badges(1);
    expect(marks[0].getAttribute('aria-label')).toBe('Heaviest weight record');
    expect(marks[1].getAttribute('aria-label')).toBe('Estimated 1RM record');
    expect(marks[2].getAttribute('aria-label')).toBe('1RM record');
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

    expect(screen.getByText('Best volume 1500 kg')).toBeTruthy();
    expect(screen.getByLabelText('Best session volume record')).toBeTruthy();
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
