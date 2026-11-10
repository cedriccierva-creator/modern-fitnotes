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
    expect(parseWeightInput('135', 'lb')).toBe(61.23);
    expect(parseWeightInput('60', 'kg')).toBe(60);
    expect(parseWeightInput('  ', 'lb')).toBeNull();
    expect(parseWeightInput('-5', 'kg')).toBeNull();
    expect(parseWeightInput('abc', 'kg')).toBeNull();
  });

  it('accepts decimal weights', () => {
    expect(parseWeightInput('62.5', 'kg')).toBe(62.5);
    expect(parseWeightInput('', 'kg')).toBeNull();
  });

  it('keeps two decimal places without float noise', () => {
    expect(roundKg(0.1 + 0.2)).toBe(0.3);
    expect(parseWeightInput('100.5', 'lb')).toBe(45.59);
  });

  it('accepts integer reps only', () => {
    expect(parseRepInput('8')).toBe(8);
    expect(parseRepInput('0')).toBe(0);
    expect(parseRepInput('8.5')).toBeNull();
    expect(parseRepInput('')).toBeNull();
    expect(parseRepInput('-2')).toBeNull();
  });

  it('formats for display per unit', () => {
    expect(formatWeight(61.23, 'lb')).toBe('135.0');
    expect(formatWeight(60.5, 'kg')).toBe('60.5');
    expect(formatWeight(null, 'kg')).toBe('');
  });
});
