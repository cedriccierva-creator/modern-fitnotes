/** Unit conversion. Storage is always kilograms; display is a projection. */

export const KG_PER_LB = 0.45359237;

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/** Convert a stored kilogram value into the unit the user is looking at. */
export function convertWeight(kg: number, unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? kgToLb(kg) : kg;
}

/**
 * Parse user input into stored kilograms. Returns null for empty or invalid
 * input so a half-typed value never silently becomes zero.
 */
export function parseWeightInput(raw: string, unit: 'kg' | 'lb'): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return unit === 'lb' ? roundKg(lbToKg(value)) : roundKg(value);
}

/** Kilograms are kept to 2dp: enough for 0.1 lb precision, no float noise. */
export function roundKg(kg: number): number {
  return Math.round(kg * 100) / 100;
}

/** Integer reps only — a partial rep is not a rep. */
export function parseRepInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

export function formatWeight(kg: number | null, unit: 'kg' | 'lb'): string {
  if (kg === null || !Number.isFinite(kg)) return '';
  const value = convertWeight(kg, unit);
  return unit === 'lb' ? value.toFixed(1) : String(roundKg(value));
}
