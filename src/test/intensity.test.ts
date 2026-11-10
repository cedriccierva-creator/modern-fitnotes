import { describe, expect, it } from 'vitest';
import { findIntensity, generateSets, intensityFromNote, INTENSITY_PRESETS, repRangeLabel } from '../lib/intensity';

describe('intensity presets', () => {
  it('defines the three presets with their set and rep ranges', () => {
    expect(findIntensity('high')).toMatchObject({ sets: 2, repMin: 6, repMax: 8 });
    expect(findIntensity('universal')).toMatchObject({ sets: 3, repMin: 8, repMax: 12 });
    expect(findIntensity('power')).toMatchObject({ sets: 3, repMin: 3, repMax: 5 });
    expect(new Set(INTENSITY_PRESETS.map((preset) => preset.id)).size).toBe(3);
  });

  it('rejects an unknown intensity', () => {
    // @ts-expect-error probing the guard with a value outside the union
    expect(() => findIntensity('volume')).toThrow(/Unknown intensity/);
  });

  it('generates editable rows in order', () => {
    expect(generateSets(findIntensity('high'))).toEqual([
      { setNumber: 1, reps: 7 },
      { setNumber: 2, reps: 7 },
    ]);
    expect(generateSets(findIntensity('universal'))).toEqual([
      { setNumber: 1, reps: 10 },
      { setNumber: 2, reps: 10 },
      { setNumber: 3, reps: 10 },
    ]);
    expect(generateSets(findIntensity('power'))).toHaveLength(3);
  });

  it('labels ranges and reads them back off a session note', () => {
    expect(repRangeLabel(findIntensity('power'))).toBe('3–5');
    expect(intensityFromNote('High Intensity · 2 sets · 6–8 reps')).toBe('high');
    expect(intensityFromNote('Universal · 3 sets · 8–12 reps')).toBe('universal');
    expect(intensityFromNote('Power Focus · 3 sets · 3–5 reps')).toBe('power');
    expect(intensityFromNote(undefined)).toBe('universal');
  });
});
