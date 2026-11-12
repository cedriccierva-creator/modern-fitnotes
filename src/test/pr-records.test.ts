import { describe, expect, it } from 'vitest';
import {
  computeRecordAchievements,
  recordLabel,
  setRecords,
} from '../lib/pr';
import type { RecordAchievements, SetPerformance } from '../lib/pr';

/**
 * Phase 6A step 2: record achievements by set id.
 *
 * These tests deliberately build `SetPerformance` values directly: the engine is
 * pure, so no database is needed to prove which set established which record.
 * The historical-recalculation cases below replay the same histories the
 * workout screen would produce after an edit or a delete.
 */

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

function perf(overrides: Partial<SetPerformance> = {}): SetPerformance {
  return { ...BASE, ...overrides };
}

/** A set inside a named session on a named date. */
function inSession(
  workoutExerciseId: string,
  date: string,
  setNumber: number,
  weightKg: number | null,
  reps: number | null,
  setId = `${workoutExerciseId}-${setNumber}`,
): SetPerformance {
  return perf({
    setId,
    workoutExerciseId,
    workoutDayId: `day-${date}`,
    date,
    setNumber,
    weightKg,
    reps,
    createdAt: setNumber,
  });
}

const recordsOf = (achievements: RecordAchievements, setId: string) =>
  setRecords(achievements, setId);

describe('baseline records', () => {
  it('gives the first qualifying performance every record it can hold', () => {
    const achievements = computeRecordAchievements([perf({ setId: 'first', weightKg: 100, reps: 5 })]);

    expect(recordsOf(achievements, 'first')).toEqual([
      'weight',
      'estimatedOneRepMax',
      'maxReps',
      'rm5',
    ]);
    expect(achievements.weight).toEqual({ setId: 'first', weightKg: 100 });
    expect(achievements.setCount).toBe(1);
  });

  it('gives a first bodyweight set reps records only, with no invented load', () => {
    const achievements = computeRecordAchievements([
      perf({ setId: 'pullup', weightKg: null, reps: 12 }),
    ]);

    // No weight, no e1RM, no rep-range records: there is no external load.
    expect(recordsOf(achievements, 'pullup')).toEqual(['maxReps']);
    expect(achievements.weight).toBeNull();
  });
});

describe('multiple records on one set', () => {
  it('marks a single set that sets a heaviest weight and an 8RM at once', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, 100, 5),
      inSession('s1', '2026-11-05', 1, 110, 8, 'hero'),
    ];

    const achievements = computeRecordAchievements(history);
    // 8 reps also beats the earlier 5, so the same set takes the reps record too.
    expect(recordsOf(achievements, 'hero')).toEqual([
      'weight',
      'estimatedOneRepMax',
      'maxReps',
      'rm8',
    ]);
  });

  it('marks a set that sets a 1RM and an estimated 1RM together', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, 100, 5),
      inSession('s1', '2026-11-05', 1, 150, 1, 'single'),
    ];

    expect(recordsOf(computeRecordAchievements(history), 'single')).toEqual([
      'weight',
      'estimatedOneRepMax',
      'rm1',
    ]);
  });

  it('communicates every record, never collapsing them into one', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, 80, 3),
      inSession('s1', '2026-11-05', 1, 120, 3, 'hero'),
    ];

    const records = recordsOf(computeRecordAchievements(history), 'hero');
    expect(records.length).toBeGreaterThan(1);
    expect(records).toContain('rm3');
    // Each record keeps its own readable name.
    const achievements = computeRecordAchievements(history);
    expect(records.map((record) => achievements.labels[record])).toEqual([
      'Heaviest weight',
      'Estimated 1RM',
      '3RM',
    ]);
  });
});

describe('rep-range records', () => {
  it('tracks 1RM through 10RM as independent records', () => {
    // Descending weight as reps climb, which is the realistic shape.
    const history = Array.from({ length: 10 }, (_, index) => {
      const reps = index + 1;
      return inSession('s1', '2026-11-01', reps, 200 - reps * 5, reps, `r${reps}`);
    });

    const achievements = computeRecordAchievements(history);
    for (let reps = 1; reps <= 10; reps += 1) {
      expect(recordsOf(achievements, `r${reps}`)).toContain(`rm${reps}`);
    }
  });

  it('lets different sets hold different rep-range records', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, 120, 2, 'two'),
      inSession('s1', '2026-11-02', 1, 100, 8, 'eight'),
      inSession('s1', '2026-11-03', 1, 80, 12, 'twelve'),
    ];

    const achievements = computeRecordAchievements(history);
    expect(recordsOf(achievements, 'two')).toContain('rm2');
    expect(recordsOf(achievements, 'eight')).toContain('rm8');
    // 12 reps is outside 1..10, so it holds no rep-range record.
    expect(recordsOf(achievements, 'twelve').some((r) => r.startsWith('rm'))).toBe(false);
    expect(recordsOf(achievements, 'twelve')).toContain('maxReps');
  });

  it('does not let a heavy 1-rep set claim a 5RM', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 200, 1, 'single'),
    ]);

    expect(recordsOf(achievements, 'single')).toEqual(['weight', 'estimatedOneRepMax', 'maxReps', 'rm1']);
    expect(recordsOf(achievements, 'single')).not.toContain('rm5');
  });
});

describe('estimated 1RM', () => {
  it('uses the existing Epley formula', () => {
    // 100 kg x 5 -> 116.66, which beats 110 kg x 1 -> 113.66.
    const history = [
      inSession('s1', '2026-11-01', 1, 110, 1, 'single'),
      inSession('s1', '2026-11-05', 1, 100, 5, 'fiver'),
    ];

    expect(recordsOf(computeRecordAchievements(history), 'fiver')).toContain('estimatedOneRepMax');
  });

  it('keeps an estimate that only ties out of the record list', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, 100, 6, 'first'),
      inSession('s1', '2026-11-05', 1, 100, 6, 'second'),
    ];

    const achievements = computeRecordAchievements(history);
    expect(recordsOf(achievements, 'first')).toContain('estimatedOneRepMax');
    expect(recordsOf(achievements, 'second')).not.toContain('estimatedOneRepMax');
  });

  it('never invents an estimate for a bodyweight set', () => {
    const achievements = computeRecordAchievements([
      perf({ setId: 'bw', weightKg: null, reps: 20 }),
    ]);

    expect(recordsOf(achievements, 'bw')).not.toContain('estimatedOneRepMax');
  });
});

describe('maximum reps and bodyweight', () => {
  it('records reps for a bodyweight set with no external load', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, null, 8, 'eight'),
      inSession('s1', '2026-11-05', 1, null, 12, 'twelve'),
    ];

    const achievements = computeRecordAchievements(history);
    expect(recordsOf(achievements, 'eight')).toContain('maxReps');
    expect(recordsOf(achievements, 'twelve')).toContain('maxReps');
    expect(achievements.weight).toBeNull();
    expect(achievements.volume).toBeNull();
  });

  it('lets an externally weighted bodyweight set earn weight records', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, null, 10, 'bodyweight'),
      inSession('s1', '2026-11-05', 1, 20, 6, 'weighted'),
    ];

    const achievements = computeRecordAchievements(history);
    // The weighted set is the only one with a real load, so it holds the
    // weight and e1RM records and contributes volume.
    expect(recordsOf(achievements, 'weighted')).toEqual([
      'weight',
      'estimatedOneRepMax',
      'rm6',
    ]);
    // The bodyweight set still holds the reps record.
    expect(recordsOf(achievements, 'bodyweight')).toEqual(['maxReps']);
    expect(achievements.weight).toEqual({ setId: 'weighted', weightKg: 20 });
  });

  it('never produces a weight record from an unknown load', () => {
    const achievements = computeRecordAchievements([
      perf({ setId: 'bw-1', weightKg: null, reps: 30 }),
      perf({ setId: 'bw-2', weightKg: null, reps: 25 }),
    ]);

    expect(achievements.weight).toBeNull();
    expect(recordsOf(achievements, 'bw-1')).toEqual(['maxReps']);
    expect(recordsOf(achievements, 'bw-2')).toEqual([]);
  });
});

describe('eligibility', () => {
  it('never qualifies an incomplete set', () => {
    const achievements = computeRecordAchievements([
      perf({ setId: 'done', weightKg: 100, reps: 5 }),
      perf({ setId: 'not-done', weightKg: 200, reps: 5, completed: false }),
    ]);

    expect(recordsOf(achievements, 'not-done')).toEqual([]);
    expect(achievements.weight).toEqual({ setId: 'done', weightKg: 100 });
  });

  it('rejects invalid reps and weights', () => {
    // Each row is invalid in *both* dimensions, so it can earn nothing at all.
    const achievements = computeRecordAchievements([
      perf({ setId: 'zero-reps', reps: 0, weightKg: 0 }),
      perf({ setId: 'negative-reps', reps: -5, weightKg: -50 }),
      perf({ setId: 'fractional', reps: 4.5, weightKg: Number.NaN }),
      perf({ setId: 'null-reps', reps: null, weightKg: null }),
    ]);

    expect(achievements.setCount).toBe(0);
    expect(achievements.bySetId.size).toBe(0);
    expect(achievements.weight).toBeNull();
    expect(achievements.volume).toBeNull();
  });

  it('still awards a weight record to a set whose reps are invalid', () => {
    // Heaviest weight needs only a real load, exactly like the weight engine.
    const achievements = computeRecordAchievements([
      perf({ setId: 'no-reps', reps: 0, weightKg: 100 }),
    ]);

    expect(recordsOf(achievements, 'no-reps')).toEqual(['weight']);
    expect(recordsOf(achievements, 'no-reps')).not.toContain('maxReps');
  });

  it('still awards a reps record to a set whose weight is invalid', () => {
    const achievements = computeRecordAchievements([
      perf({ setId: 'no-weight', weightKg: Number.NaN, reps: 8 }),
    ]);

    expect(recordsOf(achievements, 'no-weight')).toEqual(['maxReps']);
    expect(achievements.weight).toBeNull();
  });

  it('treats a missing completed flag as completed, as the weight engine does', () => {
    const legacy = { ...perf({ setId: 'legacy', weightKg: 100, reps: 5 }) };
    delete (legacy as { completed?: boolean }).completed;

    expect(recordsOf(computeRecordAchievements([legacy]), 'legacy')).toContain('weight');
  });
});

describe('ties and determinism', () => {
  it('does not duplicate an achievement when a record is tied', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, 100, 5, 'first'),
      inSession('s1', '2026-11-08', 1, 100, 5, 'tied'),
    ];

    const achievements = computeRecordAchievements(history);
    expect(recordsOf(achievements, 'first').length).toBeGreaterThan(0);
    expect(recordsOf(achievements, 'tied')).toEqual([]);
    expect(achievements.setCount).toBe(1);
  });

  it('breaks a full tie deterministically by canonical order', () => {
    const a = perf({ setId: 'aaa', weightKg: 100, reps: 5 });
    const b = perf({ setId: 'bbb', weightKg: 100, reps: 5 });

    for (const order of [[a, b], [b, a]]) {
      const achievements = computeRecordAchievements(order);
      expect(achievements.setCount).toBe(1);
      expect(recordsOf(achievements, 'aaa').length).toBeGreaterThan(0);
      expect(recordsOf(achievements, 'bbb')).toEqual([]);
    }
  });

  it('produces the same achievements regardless of input order', () => {
    const history = [
      inSession('s1', '2026-11-01', 1, 100, 5),
      inSession('s1', '2026-11-05', 1, 110, 3),
      inSession('s1', '2026-11-09', 1, 90, 10),
    ];

    const forward = computeRecordAchievements(history);
    const reversed = computeRecordAchievements([...history].reverse());

    expect([...forward.bySetId.entries()]).toEqual([...reversed.bySetId.entries()]);
    expect(forward.weight).toEqual(reversed.weight);
  });
});

describe('session volume', () => {
  it('groups volume by the correct session and never attaches it to a set', () => {
    const history = [
      inSession('session-a', '2026-11-01', 1, 100, 5),
      inSession('session-a', '2026-11-01', 2, 100, 5),
      inSession('session-b', '2026-11-05', 1, 120, 5),
    ];

    const achievements = computeRecordAchievements(history);

    expect(achievements.volume).toMatchObject({
      workoutExerciseId: 'session-a',
      date: '2026-11-01',
      volumeKg: 1000,
      setCount: 2,
    });
    // No set carries a 'volume' record: the category is session-scoped.
    for (const records of achievements.bySetId.values()) {
      expect(records).not.toContain('volume');
    }
  });

  it('omits bodyweight-only sessions from volume', () => {
    const achievements = computeRecordAchievements([
      inSession('bw', '2026-11-01', 1, null, 20),
      inSession('weighted', '2026-11-05', 1, 50, 5),
    ]);

    expect(achievements.volume?.workoutExerciseId).toBe('weighted');
  });

  it('has no volume record when nothing carries a load', () => {
    const achievements = computeRecordAchievements([
      inSession('bw', '2026-11-01', 1, null, 20),
    ]);

    expect(achievements.volume).toBeNull();
  });
});

describe('historical recalculation', () => {
  it('moves the achievement when a later performance beats it', () => {
    const before = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'older'),
    ]);
    expect(recordsOf(before, 'older')).toContain('weight');

    // Same history plus a heavier set: history is re-derived, not patched.
    const after = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'older'),
      inSession('s1', '2026-11-05', 1, 120, 5, 'newer'),
    ]);
    expect(recordsOf(after, 'newer')).toContain('weight');
    expect(recordsOf(after, 'older')).toContain('weight'); // still a baseline at the time
  });

  it('drops an achievement when an earlier set is edited higher', () => {
    const later = inSession('s1', '2026-11-05', 1, 110, 5, 'later');

    // 100 then 110: the later set legitimately established the record.
    const original = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'earlier'),
      later,
    ]);
    expect(recordsOf(original, 'later')).toContain('weight');

    // Edit the earlier set to 130: the later set no longer ever beat it.
    const edited = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 130, 5, 'earlier'),
      later,
    ]);
    expect(recordsOf(edited, 'later')).not.toContain('weight');
    expect(recordsOf(edited, 'earlier')).toContain('weight');
    expect(edited.weight).toEqual({ setId: 'earlier', weightKg: 130 });
  });

  it('recalculates when the record-setting set is deleted', () => {
    const deleted = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'kept'),
    ]);

    expect(recordsOf(deleted, 'kept')).toContain('weight');
    expect(recordsOf(deleted, 'gone')).toEqual([]);
    expect(deleted.weight).toEqual({ setId: 'kept', weightKg: 100 });
  });

  it('drops the volume record when the session holding it is deleted', () => {
    const both = computeRecordAchievements([
      inSession('session-a', '2026-11-01', 1, 100, 5),
      inSession('session-b', '2026-11-05', 1, 200, 5),
    ]);
    expect(both.volume?.workoutExerciseId).toBe('session-b');

    // Session B removed: the record must fall back to session A.
    const aOnly = computeRecordAchievements([inSession('session-a', '2026-11-01', 1, 100, 5)]);
    expect(aOnly.volume?.workoutExerciseId).toBe('session-a');
    expect(aOnly.volume?.volumeKg).toBe(500);
  });

  it('gives a set no achievements when the whole exercise is empty', () => {
    const empty = computeRecordAchievements([]);
    expect(empty.setCount).toBe(0);
    expect(empty.weight).toBeNull();
    expect(empty.volume).toBeNull();
    expect(setRecords(empty, 'anything')).toEqual([]);
  });
});

describe('labels', () => {
  it('names every record type readably', () => {
    expect(recordLabel('weight')).toBe('Heaviest weight');
    expect(recordLabel('estimatedOneRepMax')).toBe('Estimated 1RM');
    expect(recordLabel('maxReps')).toBe('Most reps');
    expect(recordLabel('rm1')).toBe('1RM');
    expect(recordLabel('rm10')).toBe('10RM');
  });

  it('exposes a label for every record it can emit', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5),
      inSession('s1', '2026-11-02', 1, 90, 10, 'ten'),
    ]);

    for (const records of achievements.bySetId.values()) {
      for (const record of records) {
        expect(achievements.labels[record]).toBeTruthy();
      }
    }
  });
});

/**
 * Phase 6A step 3: the difference between *establishing* a record and *holding*
 * it now. `bySetId` is history and never shrinks; `currentBySetId` is the
 * present and moves whenever a later set wins.
 */
describe('current record holders', () => {
  it('exposes the current heaviest-weight holder', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'older'),
      inSession('s1', '2026-11-05', 1, 120, 5, 'newer'),
    ]);

    expect(achievements.weight).toEqual({ setId: 'newer', weightKg: 120 });
    expect(achievements.currentBySetId.get('newer')).toContain('weight');
    expect(achievements.currentBySetId.get('older')).not.toContain('weight');
    // The older set keeps its historical achievement.
    expect(recordsOf(achievements, 'older')).toContain('weight');
  });

  it('exposes the current estimated-1RM holder separately from the heaviest', () => {
    // 90 x 10 estimates ~120, beating a 105 single's ~108.5.
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 105, 1, 'heavy-single'),
      inSession('s1', '2026-11-05', 1, 90, 10, 'light-tens'),
    ]);

    expect(achievements.estimatedOneRepMax?.setId).toBe('light-tens');
    expect(achievements.estimatedOneRepMax?.estimatedKg).toBeCloseTo(120, 10);
    expect(achievements.estimatedOneRepMax?.weightKg).toBe(90);
    // The heaviest actual weight is still the single: the two never borrow.
    expect(achievements.weight).toEqual({ setId: 'heavy-single', weightKg: 105 });
  });

  it('exposes the current maximum-reps holder, including bodyweight sets', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, null, 12, 'bw-early'),
      inSession('s1', '2026-11-05', 1, null, 18, 'bw-later'),
    ]);

    expect(achievements.maxReps?.setId).toBe('bw-later');
    expect(achievements.maxReps?.reps).toBe(18);
    expect(achievements.maxReps?.weightKg).toBeNull();
  });

  it('reports no estimate for a bodyweight-only exercise', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, null, 15),
    ]);

    expect(achievements.estimatedOneRepMax).toBeNull();
    expect(achievements.weight).toBeNull();
    expect(achievements.maxReps?.reps).toBe(15);
  });

  it('exposes the current session-volume holder', () => {
    const achievements = computeRecordAchievements([
      inSession('small', '2026-11-01', 1, 100, 5),
      inSession('big', '2026-11-05', 1, 200, 5),
    ]);

    expect(achievements.volume?.workoutExerciseId).toBe('big');
    expect(achievements.volume?.volumeKg).toBe(1000);
  });

  it('moves every holder when one later set improves several metrics at once', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'older'),
      // Heavier, more reps and a better estimate all in one set.
      inSession('s1', '2026-11-05', 1, 120, 8, 'hero'),
    ]);

    const held = achievements.currentBySetId.get('hero') ?? [];
    expect(held).toContain('weight');
    expect(held).toContain('estimatedOneRepMax');
    expect(held).toContain('maxReps');
    expect(held).toContain('rm8');
    // The older set keeps only the 5RM: the later set improved weight, reps and
    // the estimate, but never repeated five reps, so that record is untouched.
    expect(achievements.currentBySetId.get('older')).toEqual(['rm5']);
    // Both sets still hold history.
    expect(recordsOf(achievements, 'older')).toContain('weight');
    expect(recordsOf(achievements, 'hero')).toContain('weight');
  });

  it('keeps independent rep-count records on the set that still holds each', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'fiver'),
      inSession('s1', '2026-11-05', 1, 110, 8, 'eighter'),
    ]);

    // The 8-rep set wins 8RM and the estimate, but the 5RM still belongs to the
    // earlier set because the later set never repeated five reps.
    expect(achievements.currentBySetId.get('fiver')).toEqual(['rm5']);
    expect(achievements.currentBySetId.get('eighter')).toContain('rm8');
    expect(achievements.currentBySetId.get('eighter')).not.toContain('rm5');
  });

  it('holds nothing for a set whose every record was surpassed', () => {
    const achievements = computeRecordAchievements([
      inSession('s1', '2026-11-01', 1, 100, 5, 'beaten'),
      inSession('s1', '2026-11-05', 1, 150, 5, 'winner'),
    ]);

    // The beaten set loses the weight record but keeps `maxReps`: five reps is a
    // tie, and a tie never creates a second holder.
    expect(achievements.currentBySetId.get('beaten')).toEqual(['maxReps']);
    expect(achievements.currentBySetId.get('beaten')).not.toContain('weight');
    expect(achievements.currentBySetId.get('winner')).toContain('weight');
    // The surpassed set is still listed in history, so its badge survives.
    expect(recordsOf(achievements, 'beaten')).toContain('weight');
  });
});
