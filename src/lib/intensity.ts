export type IntensityId = 'high' | 'universal' | 'power';

export interface IntensityPreset {
  id: IntensityId;
  /** Short label shown on the picker. */
  name: string;
  /** Longer label for the confirmation row. */
  hint: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Text class for the active pill. */
  tone: string;
}

export const INTENSITY_PRESETS: readonly IntensityPreset[] = [
  {
    id: 'high',
    name: 'High Intensity',
    hint: '2 sets · 6–8 reps',
    sets: 2,
    repMin: 6,
    repMax: 8,
    tone: 'bg-sky-500/20 text-sky-200 ring-sky-400',
  },
  {
    id: 'universal',
    name: 'Universal',
    hint: '3 sets · 8–12 reps',
    sets: 3,
    repMin: 8,
    repMax: 12,
    tone: 'bg-emerald-500/20 text-emerald-200 ring-emerald-400',
  },
  {
    id: 'power',
    name: 'Power Focus',
    hint: '3 sets · 3–5 reps',
    sets: 3,
    repMin: 3,
    repMax: 5,
    tone: 'bg-rose-500/20 text-rose-200 ring-rose-400',
  },
];

export function findIntensity(id: IntensityId): IntensityPreset {
  const preset = INTENSITY_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error(`Unknown intensity: ${id}`);
  return preset;
}

export function repRangeLabel(preset: IntensityPreset): string {
  return `${preset.repMin}–${preset.repMax}`;
}

export interface GeneratedSet {
  setNumber: number;
  /** Seeded midpoint of the range, editable per row. */
  reps: number;
}

/** Editable set rows generated from the selected intensity. */
export function generateSets(preset: IntensityPreset): GeneratedSet[] {
  const midpoint = Math.round((preset.repMin + preset.repMax) / 2);
  return Array.from({ length: preset.sets }, (_, index) => ({
    setNumber: index + 1,
    reps: midpoint,
  }));
}
/** Inverse of the note prefix written in addExerciseToDay. */
export function intensityFromNote(note: string | undefined): IntensityId {
  return note?.startsWith('High Intensity') ? 'high' : note?.startsWith('Power Focus') ? 'power' : 'universal';
}
