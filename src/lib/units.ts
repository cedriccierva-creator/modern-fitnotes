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

/**
 * The one canonical storage grid: kilograms at 0.001 kg.
 *
 * Stored weights, and therefore every PR comparison, sit on this grid. There is
 * deliberately only this single rounding step in the app -- a consumer that
 * rounds again (e.g. the PR engine) would create a second grid and could make a
 * genuine improvement disappear.
 */
export const KG_STORAGE_DECIMALS = 3;

export function roundKg(kg: number): number {
  const factor = 10 ** KG_STORAGE_DECIMALS;
  return Math.round(kg * factor) / factor;
}

/** Integer reps only — a partial rep is not a rep. */
export function parseRepInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Format a stored kilogram value for display, with trailing zeros trimmed.
 *
 * Both units show the full 0.001 kg storage resolution. That matters: a coarser
 * pound display would not round-trip -- re-entering the shown value would move
 * the stored weight (a 1dp pound display changes 97.8% of stored values when
 * re-entered). Keeping 3dp makes display -> edit -> store lossless, at the cost
 * of cosmetic surprises such as 225 lb coming back as 224.999 lb, because the
 * stored 102.058 kg is authoritative.
 */
export function formatWeight(kg: number | null, unit: 'kg' | 'lb'): string {
  if (kg === null || !Number.isFinite(kg)) return '';
  const value = convertWeight(kg, unit);
  return trimZeros(value.toFixed(KG_STORAGE_DECIMALS));
}

/** "220.460" -> "220.46", "135.000" -> "135", "0.000" -> "0". */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') || '0' : text;
}
