import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { createExercise } from '../db/exercises';
import { addExerciseToDay, deleteSet, ensureWorkoutDay, updateSet } from '../db/workout';
import { getPRsForExercise } from '../db/personalRecords';
import { newId } from '../lib/id';
import type { PrSet } from '../lib/pr';

/**
 * Seeded property test: "random add/edit/delete matches from-scratch replay".
 *
 * The oracle below is an INDEPENDENT brute-force reference written here in the
 * test file. It never calls the engine: for each set it scans *all* earlier sets
 * to decide whether anything earlier was at least as heavy. That is a different
 * algorithm (O(n^2) scan) from the engine's single chronological pass, so an
 * ordering, tie or per-day grouping mistake cannot hide behind shared code.
 *
 * The operations drive the real app mutation functions against fake-indexeddb
 * while a plain in-memory mirror of the history is maintained alongside. After
 * every run the two are compared: current PR, full history, and trophy ids.
 *
 * On failure the seed, run number and the exact operation log are printed.
 */

const SEED = 0x5eed1a5; // 99_495_077
const RUNS = 300;
const DATE_POOL = [
  '2026-11-01',
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
];

/** In-file xorshift32: deterministic, dependency-free. */
function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

interface ModelSet {
  setId: string;
  sessionId: string;
  dayId: string;
  date: string;
  exerciseOrder: number;
  setNumber: number;
  weightKg: number | null;
  completed: boolean;
  createdAt: number;
}

/** Plain in-memory mirror of what the app persisted. */
interface Model {
  sets: Map<string, ModelSet>;
  sessionOrder: Map<string, number>;
  dateByDay: Map<string, string>;
}

interface OraclePr {
  current: PrSet | null;
  history: PrSet[];
  trophySetIds: string[];
}

/**
 * Independent brute-force reference.
 *
 * For a set to be a trophy it must (a) be completed with weight > 0 (enforced by
 * the caller's `qualifying` filter, repeated here), and (b) beat *every*
 * qualifying set in any strictly earlier day; within its own day it must be the
 * heaviest such set, earliest on a tie.
 */
function oracle(sets: readonly ModelSet[]): OraclePr {
  const qualifying = sets.filter(
    (set) => set.completed && set.weightKg !== null && set.weightKg > 0,
  );

  const byDate = new Map<string, ModelSet[]>();
  for (const set of qualifying) {
    const bucket = byDate.get(set.date);
    if (bucket) bucket.push(set);
    else byDate.set(set.date, [set]);
  }

  const dates = [...byDate.keys()].sort();
  const history: ModelSet[] = [];

  for (const date of dates) {
    // Heaviest set of this day; ties go to the earliest (session order, setNumber).
    const daySets = [...(byDate.get(date) as ModelSet[])].sort(
      (a, b) =>
        a.exerciseOrder - b.exerciseOrder ||
        a.setNumber - b.setNumber ||
        a.createdAt - b.createdAt ||
        (a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : 0),
    );
    let dayBest: ModelSet | null = null;
    for (const set of daySets) {
      const weight = set.weightKg as number;
      if (dayBest === null || weight > (dayBest.weightKg as number)) dayBest = set;
    }
    if (dayBest === null) continue;

    // Brute force: is anything in a strictly earlier day at least as heavy?
    const earlier = qualifying.filter((set) => set.date < date);
    const beaten = earlier.some((set) => (set.weightKg as number) >= (dayBest.weightKg as number));
    if (beaten) continue;

    history.push(dayBest);
  }

  const toPr = (set: ModelSet): PrSet => ({
    setId: set.setId,
    workoutExerciseId: set.sessionId,
    workoutDayId: set.dayId,
    date: set.date,
    setNumber: set.setNumber,
    weightKg: set.weightKg as number,
    reps: null,
  });

  const prSets = history.map(toPr);
  return {
    current: prSets.length === 0 ? null : prSets[prSets.length - 1],
    history: prSets,
    trophySetIds: prSets.map((set) => set.setId),
  };
}

/** Compare only the fields both sides define (the engine also reports reps). */
function summarize(pr: { current: PrSet | null; history: PrSet[]; trophySetIds: string[] }) {
  const pick = (set: PrSet) => ({
    setId: set.setId,
    date: set.date,
    setNumber: set.setNumber,
    weightKg: set.weightKg,
    workoutDayId: set.workoutDayId,
  });
  return {
    current: pr.current === null ? null : pick(pr.current),
    history: pr.history.map(pick),
    trophySetIds: pr.trophySetIds,
  };
}

const WEIGHTS_KG = ['60', '80.5', '100', '100.01', '102.06', '102.07', '140'];
const WEIGHTS_LB = ['225', '220.462', '220.46', '176.37', '110.23', '308.65'];

beforeEach(async () => {
  await db.open();
  await db.delete();
  await db.open();
});

afterAll(async () => {
  await db.delete();
});

describe('PR property: random history vs independent replay', () => {
  it('matches the brute-force oracle across 300 seeded runs', async () => {
    const exercise = await createExercise('Squat');
    const random = xorshift32(SEED);
    let now = 1_700_000_000_000;
    let opCounter = 0;
    let runsWithHistory = 0;
    let runsWithProgression = 0;
    let runsWithEmptyHistory = 0;

    const pick = <T>(items: readonly T[]): T => items[random() % items.length];

    for (let run = 0; run < RUNS; run += 1) {
      await db.delete();
      await db.open();

      const model: Model = { sets: new Map(), sessionOrder: new Map(), dateByDay: new Map() };
      // One session per date is all the UI creates; the model reuses it.
      const sessionsByDate = new Map<string, string>();
      const operations: string[] = [];
      const length = 6 + (random() % 19); // 6..24 operations

      const addSet = async (date: string, weightKg: number | null, completed: boolean) => {
        let sessionId = sessionsByDate.get(date);
        if (sessionId === undefined) {
          const day = await ensureWorkoutDay(date);
          const session = await addExerciseToDay(date, exercise, 'universal');
          sessionId = session.id;
          sessionsByDate.set(date, sessionId);
          model.dateByDay.set(day.id, date);
          model.sessionOrder.set(sessionId, session.order);
          // addExerciseToDay already created 3 empty sets; track them all.
          for (const generated of session.sets) {
            model.sets.set(generated.id, {
              setId: generated.id,
              sessionId,
              dayId: day.id,
              date,
              exerciseOrder: session.order,
              setNumber: generated.setNumber,
              weightKg: generated.weightKg,
              completed: generated.completed,
              createdAt: generated.createdAt,
            });
          }
        }

        const session = (await db.workoutExercises.get(sessionId)) as { workoutDayId: string };
        const dayId = session.workoutDayId;
        const existing = [...model.sets.values()].filter((set) => set.sessionId === sessionId);
        const setNumber = existing.reduce((max, set) => Math.max(max, set.setNumber), 0) + 1;
        const setId = newId();
        now += 1;
        await db.workoutSets.add({
          id: setId,
          workoutExerciseId: sessionId,
          workoutDayId: dayId,
          setNumber,
          weightKg,
          reps: 5,
          completed,
          createdAt: now,
          updatedAt: now,
        });
        model.sets.set(setId, {
          setId,
          sessionId,
          dayId,
          date,
          exerciseOrder: model.sessionOrder.get(sessionId) as number,
          setNumber,
          weightKg,
          completed,
          createdAt: now,
        });
        return setId;
      };

      for (let step = 0; step < length; step += 1) {
        opCounter += 1;
        const roll = random() % 100;
        const all = [...model.sets.values()];
        const target = all.length === 0 ? null : pick(all);

        if (roll < 30 || target === null) {
          const date = pick(DATE_POOL);
          const useLb = random() % 2 === 0;
          const text = useLb ? pick(WEIGHTS_LB) : pick(WEIGHTS_KG);
          const blank = random() % 100 < 10;
          const weightKg = blank ? null : Number(text) * (useLb ? 0.45359237 : 1);
          const rounded = blank ? null : Math.round((weightKg as number) * 100) / 100;
          const completed = random() % 100 >= 15;
          const setId = await addSet(date, rounded, completed);
          operations.push(`add(${date},${blank ? 'blank' : `${text}${useLb ? 'lb' : 'kg'}`},completed=${completed})#${setId.slice(0, 4)}`);
        } else if (roll < 48) {
          // Edit weight up, through the real updateSet (which rounds to storage).
          const text = pick([...WEIGHTS_KG, ...WEIGHTS_LB]);
          const isLb = WEIGHTS_LB.includes(text);
          const kg = Number(text) * (isLb ? 0.45359237 : 1);
          const rounded = Math.round(kg * 100) / 100;
          // Only the weight is patched: `completed` is whatever it already was,
          // and the mirror must not "helpfully" change it.
          await updateSet(target.setId, { weightKg: rounded });
          target.weightKg = rounded;
          operations.push(`up(${target.setId.slice(0, 4)},${text}${isLb ? 'lb' : 'kg'})`);
        } else if (roll < 60) {
          const text = pick(WEIGHTS_KG);
          const kg = Number(text) * 0.5;
          const rounded = Math.round(kg * 100) / 100;
          await updateSet(target.setId, { weightKg: rounded });
          target.weightKg = rounded;
          operations.push(`down(${target.setId.slice(0, 4)},${rounded})`);
        } else if (roll < 70) {
          await updateSet(target.setId, { completed: !target.completed });
          target.completed = !target.completed;
          operations.push(`toggle(${target.setId.slice(0, 4)})=${target.completed}`);
        } else if (roll < 78) {
          await updateSet(target.setId, { weightKg: null });
          target.weightKg = null;
          operations.push(`blank(${target.setId.slice(0, 4)})`);
        } else if (roll < 90) {
          // Change the date of the set's whole session.
          const nextDate = pick(DATE_POOL);
          const day = await db.workoutDays.get(target.dayId);
          if (day !== undefined) {
            if (!sessionsByDate.has(nextDate)) {
              await db.workoutDays.update(day.id, { date: nextDate });
              const moved = new Set<string>();
              for (const set of model.sets.values()) {
                if (set.sessionId === target.sessionId) {
                  set.date = nextDate;
                  moved.add(set.setId);
                }
              }
              sessionsByDate.delete(model.dateByDay.get(day.id) as string);
              sessionsByDate.set(nextDate, target.sessionId);
              model.dateByDay.set(day.id, nextDate);
              operations.push(`redate(${target.sessionId.slice(0, 4)},${nextDate})`);
            }
          }
        } else {
          await deleteSet(target.setId);
          model.sets.delete(target.setId);
          operations.push(`delete(${target.setId.slice(0, 4)})`);
        }
      }

      const actual = summarize(await getPRsForExercise(exercise.id));
      const expected = summarize(oracle([...model.sets.values()]));

      if (expected.history.length === 0) runsWithEmptyHistory += 1;
      else runsWithHistory += 1;
      if (expected.history.length > 1) runsWithProgression += 1;

      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        console.error(`FAILED seed=0x${SEED.toString(16)} run=${run} ops:\n${operations.join(' ')}`);
      }
      expect(
        JSON.stringify(actual),
        `seed=0x${SEED.toString(16)} run=${run}\nops: ${operations.join(' ')}`,
      ).toBe(JSON.stringify(expected));
    }

    // Non-vacuity: the runs must actually cover the interesting shapes, not just
    // "no qualifying sets" on both sides.
    expect(opCounter).toBeGreaterThan(RUNS * 6);
    expect(runsWithHistory).toBeGreaterThan(RUNS * 0.5);
    expect(runsWithProgression).toBeGreaterThan(RUNS * 0.1);
    expect(runsWithEmptyHistory).toBeGreaterThan(0);
    console.log(
      `runs=${RUNS} ops=${opCounter} withHistory=${runsWithHistory} multiTrophy=${runsWithProgression} empty=${runsWithEmptyHistory}`,
    );
  }, 120_000);
});
