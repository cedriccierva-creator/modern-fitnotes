import { describe, expect, it } from 'vitest';
import {
  convertWeight,
  formatWeight,
  kgToLb,
  lbToKg,
  parseRepInput,
  parseWeightInput,
  roundKg,
} from '../lib/units';

describe('unit conversion', () => {
  it('round-trips kilograms and pounds', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
    expect(lbToKg(220.462)).toBeCloseTo(100, 3);
    expect(convertWeight(100, 'kg')).toBe(100);
    expect(convertWeight(100, 'lb')).toBeCloseTo(220.462, 3);
  });

  it('stores pounds as kilograms at input time', () => {
    // 135 lb = 61.234970... kg, stored on the 0.001 kg grid.
    expect(parseWeightInput('135', 'lb')).toBe(61.235);
    expect(parseWeightInput('60', 'kg')).toBe(60);
    expect(parseWeightInput('  ', 'lb')).toBeNull();
    expect(parseWeightInput('-5', 'kg')).toBeNull();
    expect(parseWeightInput('abc', 'kg')).toBeNull();
  });

  it('accepts decimal weights', () => {
    expect(parseWeightInput('62.5', 'kg')).toBe(62.5);
    expect(parseWeightInput('', 'kg')).toBeNull();
  });

  it('keeps three decimal places without float noise', () => {
    expect(roundKg(0.1 + 0.2)).toBe(0.3);
    expect(roundKg(1.0005)).toBe(1.001);
    expect(roundKg(99.998973890)).toBe(99.999);
    // 100.5 lb = 45.586033... kg
    expect(parseWeightInput('100.5', 'lb')).toBe(45.586);
  });

  it('compares pound entries at 0.001 kg, so nearby entries stay distinct', () => {
    // The case the earlier 0.01 kg grid could not express.
    expect(parseWeightInput('220.46', 'lb')).toBe(99.999);
    expect(parseWeightInput('220.462', 'lb')).toBe(100);
    expect(parseWeightInput('220.46', 'lb')).not.toBe(parseWeightInput('220.462', 'lb'));

    // Equivalent entries through different units agree exactly.
    expect(parseWeightInput('225', 'lb')).toBe(parseWeightInput('102.058', 'kg'));
    expect(parseWeightInput('225', 'lb')).toBe(102.058);
    expect(parseWeightInput('100', 'kg')).toBe(parseWeightInput('220.462', 'lb'));
  });

  it('never moves a stored value when it is shown and re-entered', () => {
    // Display -> edit -> store must be lossless in both units, because a silent
    // drift here would look like a new PR later on.
    const stored = [
      99.999, 100, 102.058, 45.586, 61.235, 140, 0.001, 250.5,
    ];

    for (const kg of stored) {
      for (const unit of ['kg', 'lb'] as const) {
        const shown = formatWeight(kg, unit);
        expect(parseWeightInput(shown, unit), `${kg} kg as ${unit} (${shown})`).toBe(kg);
      }
    }
  });

  it('never moves any stored value across the whole 0.001 kg sweep', () => {
    // 40.000..200.000 kg = 160,001 stored values, both display units.
    let checked = 0;
    for (let milliKg = 40_000; milliKg <= 200_000; milliKg += 1) {
      const kg = roundKg(milliKg / 1000);
      checked += 1;
      for (const unit of ['kg', 'lb'] as const) {
        const shown = formatWeight(kg, unit);
        if (parseWeightInput(shown, unit) !== kg) {
          throw new Error(`drift: ${kg} kg shown as ${shown} ${unit}`);
        }
      }
    }
    expect(checked).toBe(160_001);
  });

  it('accepts integer reps only', () => {
    expect(parseRepInput('8')).toBe(8);
    expect(parseRepInput('0')).toBe(0);
    expect(parseRepInput('8.5')).toBeNull();
    expect(parseRepInput('')).toBeNull();
    expect(parseRepInput('-2')).toBeNull();
  });

  it('formats for display per unit at 0.001 kg, trimming trailing zeros', () => {
    expect(formatWeight(61.235, 'lb')).toBe('135');
    expect(formatWeight(60.5, 'kg')).toBe('60.5');
    expect(formatWeight(100, 'kg')).toBe('100');
    expect(formatWeight(99.999, 'kg')).toBe('99.999');
    expect(formatWeight(102.058, 'lb')).toBe('224.999');
    expect(formatWeight(null, 'kg')).toBe('');
    expect(formatWeight(Number.NaN, 'lb')).toBe('');
  });

  it('shows the stored kilogram value in pounds at 3dp, not a rounded-up lb', () => {
    // 102.058 kg is what 225 lb stores as; the display states the stored value.
    expect(formatWeight(parseWeightInput('225', 'lb') as number, 'lb')).toBe('224.999');
    expect(formatWeight(parseWeightInput('220.462', 'lb') as number, 'lb')).toBe('220.462');
    expect(formatWeight(parseWeightInput('220.46', 'lb') as number, 'lb')).toBe('220.46');
  });
});
