import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInMonth,
  formatDateLabel,
  isLeapYear,
  monthGrid,
  shortWeekday,
  toDateKey,
  weekDates,
  weekStart,
} from '../lib/month';

describe('month grid', () => {
  it('is Monday-first and covers six rows', () => {
    const cells = monthGrid(2026, 11);
    expect(cells).toHaveLength(42);
    // 1 Nov 2026 is a Sunday, so the grid starts on Mon 26 Oct.
    expect(cells[0]).toBe('2026-10-26');
    expect(weekStart(cells[0])).toBe(cells[0]);
    expect(cells[41]).toBe('2026-12-06');
  });

  it('starts on Monday for a month that begins on Monday', () => {
    expect(monthGrid(2026, 6)[0]).toBe('2026-06-01');
  });

  it('crosses the year boundary', () => {
    const december = monthGrid(2026, 12);
    expect(december[0]).toBe('2026-11-30');
    expect(december[41]).toBe('2027-01-10');
    expect(shortWeekday(december[0])).toBe('Mon');
  });

  it('never returns 42 cells that leave the target month', () => {
    for (const month of [1, 2, 4, 7, 9, 12]) {
      const cells = monthGrid(2026, month);
      const inside = cells.filter((date) => Number(date.slice(5, 7)) === month);
      expect(inside.length).toBeGreaterThanOrEqual(28);
    }
  });
});

describe('month boundaries and leap years', () => {
  it('detects leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('rolls over correctly across month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(toDateKey(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('labels dates without shifting them', () => {
    expect(formatDateLabel('2026-11-08')).toBe('Sunday, November 8, 2026');
    expect(formatDateLabel('2024-02-29')).toBe('Thursday, February 29, 2024');
  });
});

describe('week handling', () => {
  it('resolves every weekday to its Monday', () => {
    const expected: Record<string, string> = {
      '2026-11-09': '2026-11-09',
      '2026-11-10': '2026-11-09',
      '2026-11-11': '2026-11-09',
      '2026-11-12': '2026-11-09',
      '2026-11-13': '2026-11-09',
      '2026-11-14': '2026-11-09',
      '2026-11-15': '2026-11-09',
    };
    for (const [date, monday] of Object.entries(expected)) {
      expect(weekStart(date)).toBe(monday);
    }
  });

  it('treats Sunday as the last day of the week', () => {
    expect(weekDates('2026-11-09')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
      '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
    expect(weekDates('2026-11-09')[6]).toBe('2026-11-15');
  });
});
