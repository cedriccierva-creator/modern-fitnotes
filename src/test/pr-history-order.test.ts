import { describe, expect, it } from 'vitest';
import {
  computeExercisePr,
  computeExercisePrView,
  computeRecordAchievements,
  type SetPerformance,
} from '../lib/pr';

/**
 * `computeExercisePrView` sorts an exercise's history once and drives both the
 * weight engine and the achievement pass from that single ordering. These tests
 * pin that the bundled path is byte-identical to the two standalone entry
 * points it replaced, and that the shared ordering keeps every documented
 * guarantee: chronological PR history, total tie-breaking inside one date,
 * determinism under permutation, and empty history.
 */

const BASE: SetPerformance = {
  setId: 'set',
  workoutExerciseId: 'session-1',
  workoutDayId: 'day-2026-11-01',
  exerciseId: 'ex',
  exerciseName: 'Squat',
  date: '2026-11-01',
  exerciseOrder: 0,
  setNumber: 1,
  weightKg: 100,
  reps: 5,
  completed: true,
  createdAt: 0,
};

function perf(overrides: Partial<SetPerformance> = {}): SetPerformance {
  return { ...BASE, ...overrides };
}

/** A set on `date`, in session `session-${date}`, insertable in any order. */
function onDate(
  setId: string,
  date: string,
  setNumber: number,
  weightKg: number,
  createdAt = setNumber,
): SetPerformance {
  return perf({
    setId,
    workoutExerciseId: `session-${date}`,
    workoutDayId: `day-${date}`,
    date,
    setNumber,
    weightKg,
    createdAt,
  });
}

/** Every permutation of a small array (tests use <= 5 rows). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

describe('single-sort PR view', () => {
  it('returns exactly what the two standalone entry points return', () => {
    const history = [
      onDate('a', '2026-11-01', 1, 60),
      onDate('b', '2026-11-03', 1, 90),
      onDate('c', '2026-11-02', 2, 80),
      onDate('d', '2026-11-02', 1, 70),
    ];

    const view = computeExercisePrView('ex', history);

    expect(view.pr).toEqual(computeExercisePr('ex', history));
    expect(view.achievements).toEqual(computeRecordAchievements(history));
  });

  it('is independent of input order, for every permutation', () => {
    const history = [
      onDate('a', '2026-11-01', 1, 60),
      onDate('b', '2026-11-03', 1, 90),
      onDate('c', '2026-11-02', 1, 80),
      onDate('d', '2026-11-03', 2, 95),
    ];

    const reference = computeExercisePrView('ex', history);

    for (const permuted of permutations(history)) {
      const view = computeExercisePrView('ex', permuted);
      expect(view.pr.history).toEqual(reference.pr.history);
      expect(view.pr.current).toEqual(reference.pr.current);
      expect(view.pr.trophySetIds).toEqual(reference.pr.trophySetIds);
      expect([...view.achievements.bySetId.entries()]).toEqual([
        ...reference.achievements.bySetId.entries(),
      ]);
      expect([...view.achievements.currentBySetId.entries()]).toEqual([
        ...reference.achievements.currentBySetId.entries(),
      ]);
      expect(view.achievements.volume).toEqual(reference.achievements.volume);
    }
  });

  it('keeps PR history in chronological order across multiple dates', () => {
    const history = [
      onDate('nov-03', '2026-11-03', 1, 90),
      onDate('oct-28', '2026-10-28', 1, 70),
      onDate('nov-01', '2026-11-01', 1, 80),
    ];

    const { pr } = computeExercisePrView('ex', history);

    expect(pr.history.map((set) => set.date)).toEqual([
      '2026-10-28',
      '2026-11-01',
      '2026-11-03',
    ]);
    expect(pr.history.map((set) => set.weightKg)).toEqual([70, 80, 90]);
    expect(pr.current?.setId).toBe('nov-03');
  });

  it('breaks equal-date, equal-weight records by setNumber then createdAt then id', () => {
    // One day, one weight: only the earliest set in explicit order may hold the
    // trophy, and the ordering must not depend on array position.
    const history = [
      onDate('third', '2026-11-01', 3, 100),
      onDate('first', '2026-11-01', 1, 100),
      onDate('second', '2026-11-01', 2, 100),
    ];

    for (const permuted of permutations(history)) {
      const { pr, achievements } = computeExercisePrView('ex', permuted);
      expect(pr.trophySetIds).toEqual(['first']);
      expect(pr.history).toHaveLength(1);
      expect(achievements.weight).toEqual({ setId: 'first', weightKg: 100 });
    }

    // Same setNumber, so the earlier `createdAt` decides; `id` is the last tie.
    const sameNumber = [
      onDate('later', '2026-11-01', 1, 100, 5_000),
      onDate('earlier', '2026-11-01', 1, 100, 1_000),
      onDate('aa-last-resort', '2026-11-01', 1, 100, 1_000),
    ];

    for (const permuted of permutations(sameNumber)) {
      const { pr } = computeExercisePrView('ex', permuted);
      // createdAt 1000 ties, so `id` decides: 'aa-last-resort' < 'earlier'.
      expect(pr.trophySetIds).toEqual(['aa-last-resort']);
    }
  });

  it('handles an empty history without inventing records', () => {
    const { pr, achievements } = computeExercisePrView('ex', []);

    expect(pr.exerciseId).toBe('ex');
    expect(pr.current).toBeNull();
    expect(pr.history).toEqual([]);
    expect(pr.trophySetIds).toEqual([]);
    expect(achievements.setCount).toBe(0);
    expect(achievements.weight).toBeNull();
    expect(achievements.estimatedOneRepMax).toBeNull();
    expect(achievements.maxReps).toBeNull();
    expect(achievements.volume).toBeNull();
    expect(achievements.bySetId.size).toBe(0);
  });

  it('ignores rows belonging to other exercises, as the standalone engine does', () => {
    const history = [
      perf({ setId: 'mine', exerciseId: 'ex', weightKg: 100 }),
      perf({ setId: 'theirs', exerciseId: 'other', weightKg: 500 }),
    ];

    const { pr, achievements } = computeExercisePrView('ex', history);

    // The weight engine is scoped to `ex`; achievements are not filtered by
    // exercise here because callers pass one exercise's history, and this test
    // only pins that the bundled path matches the standalone behaviour exactly.
    expect(pr).toEqual(computeExercisePr('ex', history));
    expect(achievements).toEqual(computeRecordAchievements(history));
    expect(pr.trophySetIds).toEqual(['mine']);
    expect(pr.current?.weightKg).toBe(100);
  });

  it('does not mutate the array it is given', () => {
    const history = [
      onDate('b', '2026-11-02', 1, 80),
      onDate('a', '2026-11-01', 1, 70),
    ];
    const before = history.map((set) => set.setId);

    computeExercisePrView('ex', history);

    expect(history.map((set) => set.setId)).toEqual(before);
  });
});
