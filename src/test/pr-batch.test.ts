import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import {
  getPRsForExercise,
  getPRsForExercises,
  loadExercisePerformance,
} from '../db/personalRecords';
import { newId } from '../lib/id';
import { computeExercisePrView } from '../lib/pr';

/**
 * `getPRsForExercises` answers a whole logged day from three shared reads
 * instead of three reads per exercise.
 *
 * These tests pin three separate things:
 *
 *  1. **Equivalence.** For every exercise the batch returns exactly what the
 *     single-exercise read returns, so batching cannot change a record.
 *  2. **Cost.** The successful path is one sessions read, one sets read and one
 *     day read, however many exercises are asked for.
 *  3. **Failure behaviour.** A shared stage failing discards the batch and falls
 *     back to the isolated per-exercise reads -- never a mixture of the two --
 *     while one exercise's calculation failing costs only that exercise.
 *
 * The engine (`computeExercisePrView`) is wrapped, not replaced: it delegates to
 * the real implementation except for the one sentinel id used to make a single
 * calculation throw.
 */

const FAILING_EXERCISE = 'exercise-that-throws';

vi.mock('../lib/pr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pr')>();
  return {
    ...actual,
    computeExercisePrView: vi.fn(
      (exerciseId: string, history: Parameters<typeof actual.computeExercisePrView>[1]) => {
        if (exerciseId === FAILING_EXERCISE) throw new Error('PR calculation failed');
        return actual.computeExercisePrView(exerciseId, history);
      },
    ),
  };
});

const NOW = 1_700_000_000_000;

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
  vi.restoreAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

/**
 * The day row for `date`, reused when it already exists.
 *
 * `workoutDays` carries a *unique* `&date` index -- one logged workout per local
 * day -- so several exercises on the same date must share a single day row, just
 * as they do in the app.
 */
async function dayFor(date: string): Promise<string> {
  const existing = await db.workoutDays.where('date').equals(date).first();
  if (existing !== undefined) return existing.id;

  const id = newId();
  await db.workoutDays.add({ id, date, createdAt: NOW, updatedAt: NOW });
  return id;
}

/** A session row for `exerciseId` on an existing day. */
async function addSession(dayId: string, exerciseId: string, exerciseName = 'Squat'): Promise<string> {
  const sessionId = newId();
  await db.workoutExercises.add({
    id: sessionId,
    workoutDayId: dayId,
    exerciseId,
    exerciseName,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return sessionId;
}

async function seedSet(
  sessionId: string,
  dayId: string,
  setNumber: number,
  weightKg: number,
): Promise<string> {
  const id = newId();
  await db.workoutSets.add({
    id,
    workoutExerciseId: sessionId,
    workoutDayId: dayId,
    setNumber,
    weightKg,
    reps: 5,
    completed: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

/**
 * Two exercises with real history on two shared days: the shape a logged week
 * has, and the case where a per-exercise read would re-read the same day rows.
 */
async function seedTwoExercises(): Promise<{ squat: string; bench: string }> {
  const squat = newId();
  const bench = newId();

  const firstDay = await dayFor('2026-11-01');
  const squatFirst = await addSession(firstDay, squat, 'Squat');
  await seedSet(squatFirst, firstDay, 1, 100);
  await seedSet(squatFirst, firstDay, 2, 110);
  const benchFirst = await addSession(firstDay, bench, 'Bench');
  await seedSet(benchFirst, firstDay, 1, 60);

  const secondDay = await dayFor('2026-11-08');
  const squatSecond = await addSession(secondDay, squat, 'Squat');
  await seedSet(squatSecond, secondDay, 1, 120);
  const benchSecond = await addSession(secondDay, bench, 'Bench');
  await seedSet(benchSecond, secondDay, 1, 70);

  return { squat, bench };
}

/** Count the table reads a call issues, without changing what they return. */
function countReads(): { sessions: number; sets: number; days: number; total: number } {
  const counts = { sessions: 0, sets: 0, days: 0, total: 0 };

  const sessionWhere = db.workoutExercises.where.bind(db.workoutExercises);
  vi.spyOn(db.workoutExercises, 'where').mockImplementation((...args: Parameters<typeof sessionWhere>) => {
    counts.sessions += 1;
    counts.total += 1;
    return sessionWhere(...args);
  });

  const setWhere = db.workoutSets.where.bind(db.workoutSets);
  vi.spyOn(db.workoutSets, 'where').mockImplementation((...args: Parameters<typeof setWhere>) => {
    counts.sets += 1;
    counts.total += 1;
    return setWhere(...args);
  });

  const bulkGet = db.workoutDays.bulkGet.bind(db.workoutDays);
  vi.spyOn(db.workoutDays, 'bulkGet').mockImplementation((...args: Parameters<typeof bulkGet>) => {
    counts.days += 1;
    counts.total += 1;
    return bulkGet(...args);
  });

  return counts;
}

describe('batched PR reads match the individual reads', () => {
  it('returns the same PR for every exercise as getPRsForExercise', async () => {
    const { squat, bench } = await seedTwoExercises();

    const batched = await getPRsForExercises([squat, bench]);

    expect(batched.size).toBe(2);
    expect(batched.get(squat)).toEqual(await getPRsForExercise(squat));
    expect(batched.get(bench)).toEqual(await getPRsForExercise(bench));

    // Spot-check the records themselves, so equality cannot hide a shared bug.
    expect(batched.get(squat)?.current?.weightKg).toBe(120);
    expect(batched.get(squat)?.history.map((set) => set.date)).toEqual([
      '2026-11-01',
      '2026-11-08',
    ]);
    expect(batched.get(bench)?.current?.weightKg).toBe(70);
  });

  it('uses exactly three shared reads however many exercises are asked for', async () => {
    const { squat, bench } = await seedTwoExercises();
    const counts = countReads();

    await getPRsForExercises([squat, bench]);

    expect(counts).toEqual({ sessions: 1, sets: 1, days: 1, total: 3 });
  });

  it('does not grow the read count with a third exercise', async () => {
    const { squat, bench } = await seedTwoExercises();
    const press = newId();
    const pressDay = await dayFor('2026-11-08');
    const pressSession = await addSession(pressDay, press, 'Press');
    await seedSet(pressSession, pressDay, 1, 40);

    const counts = countReads();
    await getPRsForExercises([squat, bench, press]);

    expect(counts.total).toBe(3);
  });
});

describe('batched PR read edge cases', () => {
  it('deduplicates repeated exercise ids', async () => {
    const { squat } = await seedTwoExercises();
    const counts = countReads();

    const prs = await getPRsForExercises([squat, squat, squat]);

    expect([...prs.keys()]).toEqual([squat]);
    expect(counts.total).toBe(3);
  });

  it('returns an empty map and issues no read for an empty id list', async () => {
    const counts = countReads();

    const prs = await getPRsForExercises([]);

    expect(prs.size).toBe(0);
    expect(counts.total).toBe(0);
  });

  it('returns EMPTY_PR for an exercise with no history, not a missing entry', async () => {
    const unknown = newId();

    const prs = await getPRsForExercises([unknown]);

    const pr = prs.get(unknown);
    expect(pr).toBeDefined();
    expect(pr?.current).toBeNull();
    expect(pr?.history).toEqual([]);
    expect(pr?.trophySetIds).toEqual([]);
    expect(pr).toEqual(await getPRsForExercise(unknown));
  });

  it('returns EMPTY_PR for a session that has no sets', async () => {
    const empty = newId();
    await addSession(await dayFor('2026-11-01'), empty);

    const prs = await getPRsForExercises([empty]);

    expect(prs.get(empty)?.current).toBeNull();
    expect(await loadExercisePerformance(empty)).toEqual([]);
  });

  it('skips orphan sets whose day row is missing', async () => {
    const { squat } = await seedTwoExercises();
    const session = await addSession(await dayFor('2026-11-15'), squat);
    // Heavier than every real lift: it would win the PR if it were not skipped.
    await db.workoutSets.add({
      id: 'orphan-day',
      workoutExerciseId: session,
      workoutDayId: 'missing-day-id',
      setNumber: 1,
      weightKg: 999,
      reps: 5,
      completed: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const prs = await getPRsForExercises([squat]);

    expect(prs.get(squat)).toEqual(await getPRsForExercise(squat));
    expect(prs.get(squat)?.current?.weightKg).toBe(120);
  });

  it('skips orphan sets whose session row is missing', async () => {
    const { squat } = await seedTwoExercises();
    const dayId = newId();
    await db.workoutDays.add({ id: dayId, date: '2026-11-22', createdAt: NOW, updatedAt: NOW });
    // A set pointing at a session that does not exist cannot be reached by the
    // batch at all (sets are selected through their sessions), and must not
    // appear in any exercise's history either.
    await db.workoutSets.add({
      id: 'orphan-session',
      workoutExerciseId: 'missing-session-id',
      workoutDayId: dayId,
      setNumber: 1,
      weightKg: 999,
      reps: 5,
      completed: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const prs = await getPRsForExercises([squat]);

    expect(prs.get(squat)?.current?.weightKg).toBe(120);
    expect(prs.get(squat)?.history.every((set) => set.setId !== 'orphan-session')).toBe(true);
  });

  it('never lets one exercise contribute to another exercise records', async () => {
    const { squat, bench } = await seedTwoExercises();

    const prs = await getPRsForExercises([squat, bench]);

    const squatSets = (await loadExercisePerformance(squat)).map((set) => set.setId);
    const benchSets = (await loadExercisePerformance(bench)).map((set) => set.setId);
    expect(squatSets.some((id) => benchSets.includes(id))).toBe(false);

    // The heavy squat must not surface as a bench record.
    expect(prs.get(squat)?.current?.weightKg).toBe(120);
    expect(prs.get(bench)?.current?.weightKg).toBe(70);
  });
});

describe('batched PR read failures', () => {
  /** Make one shared stage throw once, then behave normally. */
  function failStageOnce(stage: 'sessions' | 'sets' | 'days'): void {
    if (stage === 'sessions') {
      const where = db.workoutExercises.where.bind(db.workoutExercises);
      let failed = false;
      vi.spyOn(db.workoutExercises, 'where').mockImplementation(
        (...args: Parameters<typeof where>) => {
          if (!failed) {
            failed = true;
            throw new Error('sessions stage failed');
          }
          return where(...args);
        },
      );
      return;
    }

    if (stage === 'sets') {
      const where = db.workoutSets.where.bind(db.workoutSets);
      let failed = false;
      vi.spyOn(db.workoutSets, 'where').mockImplementation((...args: Parameters<typeof where>) => {
        if (!failed) {
          failed = true;
          throw new Error('sets stage failed');
        }
        return where(...args);
      });
      return;
    }

    const bulkGet = db.workoutDays.bulkGet.bind(db.workoutDays);
    let failed = false;
    vi.spyOn(db.workoutDays, 'bulkGet').mockImplementation((...args: Parameters<typeof bulkGet>) => {
      if (!failed) {
        failed = true;
        throw new Error('days stage failed');
      }
      return bulkGet(...args);
    });
  }

  it.each(['sessions', 'sets', 'days'] as const)(
    'falls back to per-exercise reads when the %s stage fails',
    async (stage) => {
      const { squat, bench } = await seedTwoExercises();
      const expectedSquat = await getPRsForExercise(squat);
      const expectedBench = await getPRsForExercise(bench);

      failStageOnce(stage);
      const prs = await getPRsForExercises([squat, bench]);

      // The fallback answers are complete and correct: nothing from the failed
      // batch leaked in.
      expect(prs.get(squat)).toEqual(expectedSquat);
      expect(prs.get(bench)).toEqual(expectedBench);
      expect(prs.size).toBe(2);
    },
  );

  it('isolates one failing exercise calculation from the others', async () => {
    const { squat, bench } = await seedTwoExercises();
    // A failing exercise must have real history, so it reaches the calculation.
    const failingDay = await dayFor('2026-11-08');
    const failingSession = await addSession(failingDay, FAILING_EXERCISE, 'Failing');
    await seedSet(failingSession, failingDay, 1, 80);

    const prs = await getPRsForExercises([squat, bench, FAILING_EXERCISE]);

    // Omitted, not empty: a failed exercise is distinguishable from no history.
    expect(prs.has(FAILING_EXERCISE)).toBe(false);
    expect(prs.get(squat)?.current?.weightKg).toBe(120);
    expect(prs.get(bench)?.current?.weightKg).toBe(70);
  });

  it('keeps one failed exercise out of a fallback result while the others resolve', async () => {
    const { squat, bench } = await seedTwoExercises();
    const failing = newId();
    const failingDay = await dayFor('2026-11-08');
    const failingSession = await addSession(failingDay, failing);
    await seedSet(failingSession, failingDay, 1, 50);

    const expectedSquat = await getPRsForExercise(squat);

    // The batch is driven into its fallback, and inside that fallback this one
    // exercise's read throws. Only `anyOf` (the batch stage) and the failing
    // exercise's own `equals` are affected.
    /*
     * Dexie's `where` is overloaded and the spy has to satisfy its object form,
     * so the fake is built as a plain function and cast once. `realWhere` is
     * captured first, so the delegated `equals` calls the real implementation
     * rather than recursing through the spy.
     */
    type ExerciseWhere = typeof db.workoutExercises.where;
    const realWhere = db.workoutExercises.where.bind(db.workoutExercises) as ExerciseWhere;

    const fakeWhere = (() => ({
      // The batch stage: fail it so the call has to fall back.
      anyOf: () => {
        throw new Error('batch stage failed');
      },
      // Inside the fallback, only this one exercise's read fails.
      equals: (key: string) => {
        if (key === failing) throw new Error('this exercise failed');
        return realWhere('exerciseId').equals(key);
      },
    })) as unknown as ExerciseWhere;

    vi.spyOn(db.workoutExercises, 'where').mockImplementation(fakeWhere);

    const prs = await getPRsForExercises([squat, bench, failing]);

    expect(prs.has(failing)).toBe(false);
    expect(prs.get(squat)).toEqual(expectedSquat);
    expect(prs.get(bench)?.current?.weightKg).toBe(70);
  });

  it('resolves rather than rejecting when every stage fails', async () => {
    const { squat } = await seedTwoExercises();

    vi.spyOn(db.workoutExercises, 'where').mockImplementation(() => {
      throw new Error('everything is broken');
    });

    const prs = await getPRsForExercises([squat]);

    // Both the batch and the fallback fail for this exercise: an empty map, no
    // rejection, no stale entry.
    expect(prs.size).toBe(0);
  });

  it('discards partial batch data instead of mixing it with fallback results', async () => {
    const { squat, bench } = await seedTwoExercises();

    // Sessions and sets succeed, the day stage fails. A partial batch would have
    // sessions and sets in hand but no dates, so every set would look like an
    // orphan and the result would be EMPTY_PR -- the bug this test rules out.
    const bulkGet = db.workoutDays.bulkGet.bind(db.workoutDays);
    let failed = false;
    vi.spyOn(db.workoutDays, 'bulkGet').mockImplementation(
      (...args: Parameters<typeof bulkGet>) => {
        if (!failed) {
          failed = true;
          throw new Error('days stage failed');
        }
        return bulkGet(...args);
      },
    );

    const prs = await getPRsForExercises([squat, bench]);

    expect(prs.get(squat)?.current?.weightKg).toBe(120);
    expect(prs.get(bench)?.current?.weightKg).toBe(70);
    expect(prs.get(squat)?.current).not.toBeNull();
  });
});

describe('batched results preserve ordering and tie-breaking', () => {
  it('matches the engine output for a day with several sets', async () => {
    const exercise = newId();
    const day = await dayFor('2026-11-01');
    const session = await addSession(day, exercise);
    await seedSet(session, day, 1, 100);
    await seedSet(session, day, 2, 100);
    await seedSet(session, day, 3, 105);

    const batched = await getPRsForExercises([exercise]);
    const history = await loadExercisePerformance(exercise);

    expect(batched.get(exercise)).toEqual({
      ...computeExercisePrView(exercise, history).pr,
      achievements: computeExercisePrView(exercise, history).achievements,
    });
    // Only one trophy for the day: the earliest set that beat the running best.
    expect(batched.get(exercise)?.trophySetIds).toHaveLength(1);
    expect(batched.get(exercise)?.current?.setNumber).toBe(3);
  });
});
