/** Local calendar helpers. Every date here is a "YYYY-MM-DD" string, never UTC. */

export type DateKey = string;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const WEEKDAY_FULL = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const;

export function toDateKey(date: Date): DateKey {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parses a local calendar day. Midnight local, so day arithmetic never drifts. */
export function parseDateKey(key: DateKey): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `month` is 1-based, matching Date. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: DateKey): number {
  return (parseDateKey(key).getDay() + 6) % 7;
}

/** The Monday of the Monday-first week containing `key`. */
export function weekStart(key: DateKey): DateKey {
  return addDays(key, -weekdayIndex(key));
}

/** The seven days of the Monday-first week starting at `key`. */
export function weekDates(key: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, index) => addDays(key, index));
}

/** Six Monday-first rows of 42 cells covering the given month. */
export function monthGrid(year: number, month: number): DateKey[] {
  const first = toDateKey(new Date(year, month - 1, 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index - weekdayIndex(first)));
}

export function isSameMonth(key: DateKey, year: number, month: number): boolean {
  return key.slice(0, 4) === `${year}` && Number(key.slice(5, 7)) === month;
}

/** "Mon", "Tue", … for compact lists. */
export function shortWeekday(key: DateKey): string {
  return WEEKDAY_LABELS[weekdayIndex(key)];
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function formatDateLabel(key: DateKey): string {
  const date = parseDateKey(key);
  return `${WEEKDAY_FULL[weekdayIndex(key)]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Current local day. Never `new Date().toISOString()`, which shifts the day. */
export function todayKey(): DateKey {
  return toDateKey(new Date());
}
