import { describe, expect, it } from 'vitest';
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  ROUTINE_PRESETS,
  evenSpread,
  findPreset,
  planWeek,
} from '../lib/routines';
import { CATEGORY_CHIP } from '../lib/categoryStyles';
import { CATEGORY_ORDER } from '../db/workout';

const WEEK = '2026-11-09';

describe('preset definitions', () => {
  it('defines PPLUL, ULUL, PPLPPL and Full Body ×3', () => {
    const byName = new Map(ROUTINE_PRESETS.map((preset) => [preset.name, preset]));
    expect(byName.get('PPLUL')?.templates).toEqual(['push', 'pull', 'legs', 'upper', 'lower']);
    expect(byName.get('ULUL')?.templates).toEqual(['upper', 'lower', 'upper', 'lower']);
    expect(byName.get('PPLPPL')?.templates).toEqual([
      'push', 'pull', 'legs', 'push', 'pull', 'legs',
    ]);
    expect(byName.get('Full Body ×3')?.templates).toEqual(['fullBody', 'fullBody', 'fullBody']);
  });

  it('has unique stable ids and a label for every category', () => {
    const ids = ROUTINE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of ROUTINE_PRESETS) {
      expect(findPreset(preset.id)?.name).toBe(preset.name);
      for (const template of preset.templates) {
        expect(CATEGORY_LABELS[template]).toBeTruthy();
      }
    }
  });
});

describe('evenSpread', () => {
  it('spaces three full-body days evenly', () => {
    expect(evenSpread(3, 7)).toEqual([0, 3, 6]);
    expect(evenSpread(5, 7)).toEqual([0, 2, 3, 5, 6]);
  });

  it('clamps when there is less room than templates', () => {
    expect(evenSpread(6, 3)).toEqual([0, 1, 2]);
    expect(evenSpread(1, 5)).toEqual([2]);
    expect(evenSpread(3, 0)).toEqual([]);
  });
});

describe('planWeek', () => {
  it('fills the whole week when nothing is blocked', () => {
    const pplul = findPreset('ppl-flow')!;
    const assignments = planWeek(pplul, WEEK);
    expect(assignments).toHaveLength(5);
    expect(assignments.map((entry) => entry.category)).toEqual(pplul.templates);
  });

  it('puts full body on three evenly spaced days', () => {
    const assignments = planWeek(findPreset('full-body-3')!, WEEK);
    expect(assignments.map((entry) => entry.date)).toEqual([
      '2026-11-09', '2026-11-12', '2026-11-15',
    ]);
  });

  it('skips dates that already hold a logged workout', () => {
    const blocked = new Set(['2026-11-09', '2026-11-11']);
    const assignments = planWeek(findPreset('ppl-flow')!, WEEK, blocked);
    expect(assignments).toHaveLength(5);
    for (const entry of assignments) expect(blocked.has(entry.date)).toBe(false);
  });

  it('produces nothing when the whole week is logged', () => {
    const all = new Set([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
      '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
    expect(planWeek(findPreset('ulul')!, WEEK, all)).toEqual([]);
  });
});

describe('categories', () => {
  it('offers every stored category, arms included', () => {
    expect(ALL_CATEGORIES).toContain('arms');
    expect(CATEGORY_LABELS.arms).toBe('Arms');
    expect(new Set(ALL_CATEGORIES).size).toBe(ALL_CATEGORIES.length);
  });

  it('keeps labels, chip styles and the persisted order exhaustive and in step', () => {
    // A new member of the WorkoutCategory union must be added to all three maps.
    expect([...ALL_CATEGORIES].sort()).toEqual([...CATEGORY_ORDER].sort());
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
      expect(CATEGORY_CHIP[category]).toBeTruthy();
    }
  });

  it('leaves the four routine presets untouched by the arms addition', () => {
    // Routines stay optional templates; adding a category must not invent one.
    expect(ROUTINE_PRESETS.map((preset) => preset.id)).toEqual([
      'ppl-flow', 'ulul', 'pplppl', 'full-body-3',
    ]);
    for (const preset of ROUTINE_PRESETS) {
      expect(preset.templates).not.toContain('arms');
    }
  });
});
