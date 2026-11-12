import { describe, expect, it } from 'vitest';
import {
  REP_RANGE_MAX,
  REP_RANGE_MIN,
  bestByRepCount,
  bestEstimatedOneRepMax,
  bestForReps,
  bestMaxReps,
  bestSessionVolume,
  eligibleReps,
  eligibleWeightKg,
  estimatedOneRepMax,
  isEligible,
  sessionVolumes,
  toCanonicalKg,
} from '../lib/pr';
import type { SetPerformance } from '../lib/pr';

const BASE: SetPerformance = {
  setId: 'set-1',
  workoutExerciseId: 'session-1',
  workoutDayId: 'day-2026-11-01',
  exerciseId: 'exercise',
  exerciseName: 'Squat',
  date: '2026-11-01',
  exerciseOrder: 0,
  setNumber: 1,
  weightKg: 100,
  reps: 5,
  completed: true,
  createdAt: 0,
};

/** One performance, with only the fields a test cares about overridden. */
function perf(overrides: Partial<SetPerformance> = {}): SetPerformance {
  return { ...BASE, ...overrides };
}

/** A set inside a named session on a named date, for volume grouping tests. */
function inSession(
  workoutExerciseId: string,
  date: string,
  setNumber: number,
  weightKg: number | null,
  reps: number | null,
): SetPerformance {
  return perf({
    setId: `${workoutExerciseId}-${setNumber}`,
    workoutExerciseId,
    workoutDayId: `day-${date}`,
    date,
    setNumber,
    weightKg,
    reps,
    createdAt: setNumber,
  });
}

describe('eligibility helpers', () => {
  it('treats an explicitly un-completed set as ineligible', () => {
    expect(isEligible(perf({ completed: false }))).toBe(false);
    expect(isEligible(perf({ completed: true }))).toBe(true);
    expect(eligibleReps(perf({ completed: false }))).toBeNull();
    expect(eligibleWeightKg(perf({ completed: false }))).toBeNull();
  });

  it('accepts only integer reps of at least 1', () => {
    expect(eligibleReps(perf({ reps: 5 }))).toBe(5);
    expect(eligibleReps(perf({ reps: 1 }))).toBe(1);
    expect(eligibleReps(perf({ reps: 0 }))).toBeNull();
    expect(eligibleReps(perf({ reps: -3 }))).toBeNull();
    expect(eligibleReps(perf({ reps: null }))).toBeNull();
    expect(eligibleReps(perf({ reps: 5.5 }))).toBeNull();
    expect(eligibleReps(perf({ reps: Number.NaN }))).toBeNull();
    expect(eligibleReps(perf({ reps: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('accepts only a finite positive external weight', () => {
    expect(eligibleWeightKg(perf({ weightKg: 100 }))).toBe(100);
    expect(eligibleWeightKg(perf({ weightKg: 0.001 }))).toBe(0.001);
    expect(eligibleWeightKg(perf({ weightKg: 0 }))).toBeNull();
    expect(eligibleWeightKg(perf({ weightKg: -50 }))).toBeNull();
    expect(eligibleWeightKg(perf({ weightKg: null }))).toBeNull();
    expect(eligibleWeightKg(perf({ weightKg: Number.NaN }))).toBeNull();
    expect(eligibleWeightKg(perf({ weightKg: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});

describe('exact rep-range records (1RM..10RM)', () => {
  it('picks the best weight for each exact rep count independently', () => {
    const history = [
      perf({ setId: 'a', reps: 1, weightKg: 120 }),
      perf({ setId: 'b', reps: 5, weightKg: 100 }),
      perf({ setId: 'c', reps: 5, weightKg: 102.5 }),
      perf({ setId: 'd', reps: 10, weightKg: 80 }),
    ];

    const best = bestByRepCount(history);
    expect(best.get(1)?.setId).toBe('a');
    expect(best.get(5)?.setId).toBe('c');
    expect(best.get(5)?.weightKg).toBe(102.5);
    expect(best.get(10)?.setId).toBe('d');
  });

  it('never lets one rep count win another, however heavy', () => {
    // A very heavy 1-rep set must not appear as a 5RM.
    const history = [perf({ setId: 'heavy-single', reps: 1, weightKg: 200 })];
    const best = bestByRepCount(history);

    expect(best.get(1)?.setId).toBe('heavy-single');
    expect(best.get(5)).toBeUndefined();
    expect(best.size).toBe(1);
  });

  it('only reports counts from 1 through 10', () => {
    expect(REP_RANGE_MIN).toBe(1);
    expect(REP_RANGE_MAX).toBe(10);

    const history = [
      perf({ setId: 'eleven', reps: 11, weightKg: 90 }),
      perf({ setId: 'twelve', reps: 12, weightKg: 90 }),
      perf({ setId: 'ten', reps: 10, weightKg: 70 }),
    ];
    const best = bestByRepCount(history);

    expect(best.get(10)?.setId).toBe('ten');
    expect(best.get(11)).toBeUndefined();
    expect(best.get(12)).toBeUndefined();
  });

  it('rejects zero, negative, null and fractional reps', () => {
    const history = [
      perf({ setId: 'zero', reps: 0, weightKg: 100 }),
      perf({ setId: 'negative', reps: -5, weightKg: 100 }),
      perf({ setId: 'null', reps: null, weightKg: 100 }),
      perf({ setId: 'fractional', reps: 4.5, weightKg: 100 }),
    ];

    expect(bestByRepCount(history).size).toBe(0);
  });

  it('rejects null, zero, negative and non-finite weights', () => {
    const history = [
      perf({ setId: 'bodyweight', reps: 5, weightKg: null }),
      perf({ setId: 'zero', reps: 5, weightKg: 0 }),
      perf({ setId: 'negative', reps: 5, weightKg: -100 }),
      perf({ setId: 'nan', reps: 5, weightKg: Number.NaN }),
    ];

    expect(bestByRepCount(history).size).toBe(0);
  });

  it('rejects an un-completed set even when it is the heaviest', () => {
    const history = [
      perf({ setId: 'done', reps: 5, weightKg: 100 }),
      perf({ setId: 'not-done', reps: 5, weightKg: 150, completed: false }),
    ];

    expect(bestForReps(history, 5)?.setId).toBe('done');
  });

  it('keeps the earliest set on a tied weight', () => {
    const history = [
      perf({ setId: 'first', reps: 5, weightKg: 100, date: '2026-11-01' }),
      perf({ setId: 'second', reps: 5, weightKg: 100, date: '2026-11-08' }),
    ];

    expect(bestForReps(history, 5)?.setId).toBe('first');
  });

  it('is deterministic regardless of input order', () => {
    const forward = [
      perf({ setId: 'a', reps: 3, weightKg: 110, date: '2026-11-01' }),
      perf({ setId: 'b', reps: 3, weightKg: 115, date: '2026-11-05' }),
      perf({ setId: 'c', reps: 3, weightKg: 115, date: '2026-11-09' }),
    ];

    const forwards = bestForReps(forward, 3)?.setId;
    const backwards = bestForReps([...forward].reverse(), 3)?.setId;
    const shuffled = bestForReps([forward[2], forward[0], forward[1]], 3)?.setId;

    expect(forwards).toBe('b');
    expect(backwards).toBe('b');
    expect(shuffled).toBe('b');
  });

  it('returns null for an out-of-range rep count', () => {
    const history = [perf({ reps: 5, weightKg: 100 })];
    expect(bestForReps(history, 0)).toBeNull();
    expect(bestForReps(history, 11)).toBeNull();
    expect(bestForReps(history, 5.5)).toBeNull();
    expect(bestForReps([], 5)).toBeNull();
  });
});

describe('estimated 1RM (Epley)', () => {
  it('applies weight * (1 + reps / 30)', () => {
    expect(estimatedOneRepMax(perf({ weightKg: 100, reps: 5 }))).toBeCloseTo(116.666_7, 3);
    expect(estimatedOneRepMax(perf({ weightKg: 100, reps: 1 }))).toBeCloseTo(103.333_3, 3);
    expect(estimatedOneRepMax(perf({ weightKg: 60, reps: 10 }))).toBeCloseTo(80, 10);
    expect(estimatedOneRepMax(perf({ weightKg: 90, reps: 30 }))).toBeCloseTo(180, 10);
  });

  it('refuses a bodyweight set rather than inventing a load', () => {
    expect(estimatedOneRepMax(perf({ weightKg: null, reps: 20 }))).toBeNull();
  });

  it('refuses invalid reps and invalid weights', () => {
    expect(estimatedOneRepMax(perf({ weightKg: 100, reps: 0 }))).toBeNull();
    expect(estimatedOneRepMax(perf({ weightKg: 100, reps: -5 }))).toBeNull();
    expect(estimatedOneRepMax(perf({ weightKg: 100, reps: null }))).toBeNull();
    expect(estimatedOneRepMax(perf({ weightKg: 100, reps: 3.5 }))).toBeNull();
    expect(estimatedOneRepMax(perf({ weightKg: 0, reps: 5 }))).toBeNull();
    expect(estimatedOneRepMax(perf({ weightKg: 100, reps: 5, completed: false }))).toBeNull();
  });

  it('finds the best estimate across history, not the heaviest weight', () => {
    // 90 kg x 10 estimates ~120; 105 kg x 1 estimates only ~108.5.
    const history = [
      perf({ setId: 'heavy-single', date: '2026-11-01', weightKg: 105, reps: 1 }),
      perf({ setId: 'light-set', date: '2026-11-05', weightKg: 90, reps: 10 }),
    ];

    const best = bestEstimatedOneRepMax(history);
    expect(best?.setId).toBe('light-set');
    expect(best?.weightKg).toBe(90);
    expect(best?.reps).toBe(10);
    expect(best?.estimatedKg).toBeCloseTo(120, 10);
  });

  it('keeps the earliest set on a tied estimate', () => {
    const history = [
      perf({ setId: 'first', date: '2026-11-01', weightKg: 100, reps: 6 }),
      perf({ setId: 'second', date: '2026-11-08', weightKg: 100, reps: 6 }),
    ];

    expect(bestEstimatedOneRepMax(history)?.setId).toBe('first');
  });

  it('reports the actual load separately from the estimate', () => {
    const best = bestEstimatedOneRepMax([perf({ weightKg: 100, reps: 5 })]);
    expect(best?.weightKg).toBe(100);
    expect(best?.estimatedKg).toBeCloseTo(116.666_7, 3);
    expect(best?.estimatedKg).not.toBe(best?.weightKg);
  });

  it('returns null for an empty history', () => {
    expect(bestEstimatedOneRepMax([])).toBeNull();
  });
});

describe('maximum reps', () => {
  it('records a bodyweight-only set on its reps alone', () => {
    const history = [
      perf({ setId: 'pullup', weightKg: null, reps: 12 }),
      perf({ setId: 'pullup-2', weightKg: null, reps: 9 }),
    ];

    const best = bestMaxReps(history);
    expect(best?.setId).toBe('pullup');
    expect(best?.reps).toBe(12);
    // The load stays unknown: never invented, never estimated.
    expect(best?.weightKg).toBeNull();
  });

  it('lets a weighted set qualify and keeps its real load', () => {
    const history = [
      perf({ setId: 'bodyweight', weightKg: null, reps: 8 }),
      perf({ setId: 'weighted', weightKg: 20, reps: 6 }),
    ];

    const best = bestMaxReps(history);
    expect(best?.setId).toBe('bodyweight');
    expect(best?.weightKg).toBeNull();

    const heavierOnly = bestMaxReps([perf({ setId: 'weighted', weightKg: 20, reps: 15 })]);
    expect(heavierOnly?.reps).toBe(15);
    expect(heavierOnly?.weightKg).toBe(20);
  });

  it('ignores reps of 0, negative, null and fractional', () => {
    const history = [
      perf({ setId: 'zero', reps: 0 }),
      perf({ setId: 'negative', reps: -4 }),
      perf({ setId: 'null', reps: null }),
      perf({ setId: 'fractional', reps: 7.5 }),
    ];

    expect(bestMaxReps(history)).toBeNull();
  });

  it('ignores an un-completed set', () => {
    const history = [
      perf({ setId: 'done', reps: 10 }),
      perf({ setId: 'not-done', reps: 20, completed: false }),
    ];

    expect(bestMaxReps(history)?.setId).toBe('done');
  });

  it('keeps the earliest set on a tied rep count', () => {
    const history = [
      perf({ setId: 'first', date: '2026-11-01', reps: 15 }),
      perf({ setId: 'second', date: '2026-11-09', reps: 15 }),
    ];

    expect(bestMaxReps(history)?.setId).toBe('first');
  });

  it('is deterministic regardless of input order', () => {
    const sets = [
      perf({ setId: 'a', date: '2026-11-01', reps: 10 }),
      perf({ setId: 'b', date: '2026-11-05', reps: 14 }),
      perf({ setId: 'c', date: '2026-11-09', reps: 14 }),
    ];

    expect(bestMaxReps(sets)?.setId).toBe('b');
    expect(bestMaxReps([...sets].reverse())?.setId).toBe('b');
  });

  it('returns null for an empty history', () => {
    expect(bestMaxReps([])).toBeNull();
  });
});

describe('exercise-session volume', () => {
  it('sums weight x reps across the sets of one session', () => {
    const history = [
      inSession('session-a', '2026-11-01', 1, 100, 5),
      inSession('session-a', '2026-11-01', 2, 100, 5),
      inSession('session-a', '2026-11-01', 3, 90, 8),
    ];

    const volumes = sessionVolumes(history);
    expect(volumes.size).toBe(1);
    expect(volumes.get('session-a')).toMatchObject({
      volumeKg: 500 + 500 + 720,
      setCount: 3,
      date: '2026-11-01',
    });
  });

  it('keeps separate sessions apart and picks the biggest', () => {
    const history = [
      inSession('session-a', '2026-11-01', 1, 100, 5), // 500
      inSession('session-b', '2026-11-05', 1, 100, 5), // 500
      inSession('session-b', '2026-11-05', 2, 100, 5), // 500
    ];

    const volumes = sessionVolumes(history);
    expect(volumes.size).toBe(2);
    expect(volumes.get('session-a')?.volumeKg).toBe(500);
    expect(volumes.get('session-b')?.volumeKg).toBe(1000);

    const best = bestSessionVolume(history);
    expect(best?.workoutExerciseId).toBe('session-b');
    expect(best?.volumeKg).toBe(1000);
    expect(best?.setCount).toBe(2);
  });

  it('omits bodyweight-only sets instead of inventing volume', () => {
    const history = [
      inSession('session-a', '2026-11-01', 1, null, 20),
      inSession('session-a', '2026-11-01', 2, 10, 10),
      inSession('session-b', '2026-11-05', 1, null, 30),
    ];

    const volumes = sessionVolumes(history);
    // The all-bodyweight session contributes nothing at all.
    expect(volumes.has('session-b')).toBe(false);
    expect(volumes.get('session-a')).toMatchObject({ volumeKg: 100, setCount: 1 });
    expect(bestSessionVolume(history)?.workoutExerciseId).toBe('session-a');
  });

  it('excludes sets with invalid weights or reps', () => {
    const history = [
      inSession('session-a', '2026-11-01', 1, 100, 5),
      inSession('session-a', '2026-11-01', 2, 100, 0),
      inSession('session-a', '2026-11-01', 3, 0, 5),
      inSession('session-a', '2026-11-01', 4, -10, 5),
      inSession('session-a', '2026-11-01', 5, 100, null),
      inSession('session-a', '2026-11-01', 6, 100, 2.5),
    ];

    expect(sessionVolumes(history).get('session-a')).toMatchObject({ volumeKg: 500, setCount: 1 });
  });

  it('excludes un-completed sets', () => {
    const history = [
      inSession('session-a', '2026-11-01', 1, 100, 5),
      { ...inSession('session-a', '2026-11-01', 2, 100, 5), completed: false },
    ];

    expect(sessionVolumes(history).get('session-a')).toMatchObject({ volumeKg: 500, setCount: 1 });
  });

  it('keeps the earliest session on a tied volume', () => {
    const history = [
      inSession('session-late', '2026-11-09', 1, 100, 5),
      inSession('session-early', '2026-11-01', 1, 100, 5),
    ];

    expect(bestSessionVolume(history)?.workoutExerciseId).toBe('session-early');
  });

  it('is deterministic regardless of input order', () => {
    const sets = [
      inSession('session-a', '2026-11-01', 1, 100, 5),
      inSession('session-a', '2026-11-01', 2, 100, 5),
      inSession('session-b', '2026-11-05', 1, 120, 5),
    ];

    const forwards = bestSessionVolume(sets);
    const backwards = bestSessionVolume([...sets].reverse());

    expect(forwards?.workoutExerciseId).toBe('session-a');
    expect(forwards?.volumeKg).toBe(1000);
    expect(backwards?.workoutExerciseId).toBe('session-a');
    expect(backwards?.volumeKg).toBe(1000);
  });

  it('returns null when nothing qualifies', () => {
    expect(bestSessionVolume([])).toBeNull();
    expect(bestSessionVolume([inSession('session-a', '2026-11-01', 1, null, 10)])).toBeNull();
  });
});

describe('canonical kilogram handling', () => {
  it('does not depend on the unit a weight was typed in', () => {
    // 225 lb and the kilogram value it stores as are the same performance.
    const fromPounds = toCanonicalKg(225, 'lb');
    const fromKilograms = toCanonicalKg(fromPounds, 'kg');
    expect(fromKilograms).toBe(fromPounds);

    const history = [
      perf({ setId: 'lb-typed', reps: 5, weightKg: fromPounds, date: '2026-11-01' }),
      perf({ setId: 'kg-typed', reps: 5, weightKg: fromPounds, date: '2026-11-08' }),
    ];

    // Equal stored weights tie, so there is one record, not two, and the
    // earlier session holds it however the rows are fed in.
    expect(bestByRepCount(history).size).toBe(1);
    expect(bestForReps(history, 5)?.setId).toBe('lb-typed');
    expect(bestForReps([...history].reverse(), 5)?.setId).toBe('lb-typed');
  });

  it('breaks a genuine tie by the canonical order, not by insertion', () => {
    // Same date, same set number, same createdAt: only `setId` can decide, and
    // `comparePrOrder` is the ordering that settles it.
    const a = perf({ setId: 'aaa', reps: 5, weightKg: 100 });
    const b = perf({ setId: 'bbb', reps: 5, weightKg: 100 });

    expect(bestForReps([a, b], 5)?.setId).toBe('aaa');
    expect(bestForReps([b, a], 5)?.setId).toBe('aaa');
  });

  it('separates weights that differ by one 0.001 kg step', () => {
    const history = [
      perf({ setId: 'lighter', reps: 5, weightKg: 102.058 }),
      perf({ setId: 'heavier', reps: 5, weightKg: 102.059 }),
    ];

    expect(bestForReps(history, 5)?.setId).toBe('heavier');
  });

  it('computes estimates from stored kilograms, not display units', () => {
    const kg = 100;
    const set = perf({ weightKg: kg, reps: 5 });
    expect(estimatedOneRepMax(set)).toBeCloseTo(kg * (1 + 5 / 30), 10);
  });
});

describe('cross-metric independence', () => {
  it('reports every metric from the same history without borrowing results', () => {
    const history = [
      perf({ setId: 'single', date: '2026-11-01', weightKg: 120, reps: 1 }),
      perf({ setId: 'volume-a', date: '2026-11-05', weightKg: 90, reps: 10 }),
      perf({ setId: 'volume-b', date: '2026-11-05', weightKg: 90, reps: 10 }),
      perf({ setId: 'bodyweight', date: '2026-11-09', weightKg: null, reps: 20 }),
    ];

    expect(bestForReps(history, 1)?.setId).toBe('single');
    expect(bestForReps(history, 10)?.setId).toBe('volume-a');
    // 90 x 10 estimates 120; 120 x 1 estimates 124, so the single still wins.
    expect(bestEstimatedOneRepMax(history)?.setId).toBe('single');
    expect(bestMaxReps(history)?.setId).toBe('bodyweight');
    // Every set here shares one session: 120x1 + 90x10 + 90x10. The
    // bodyweight set adds nothing, because it has no load to contribute.
    expect(bestSessionVolume(history)?.volumeKg).toBe(1920);
  });

  it('lets one set hold several records at once', () => {
    const single = perf({ setId: 'hero', weightKg: 150, reps: 1 });
    const history = [single];

    expect(bestForReps(history, 1)?.setId).toBe('hero');
    expect(bestEstimatedOneRepMax(history)?.setId).toBe('hero');
    expect(bestSessionVolume(history)?.workoutExerciseId).toBe('session-1');
    expect(bestMaxReps(history)?.setId).toBe('hero');
  });
});
