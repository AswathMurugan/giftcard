/**
 * Working-time arithmetic for the stage timers (US-702).
 *
 * The queue used to count calendar days, which quietly misreads every deadline
 * that sits across a weekend. Looked at on a Friday, an order due Monday is
 * "3 days away — on track", when in truth there is *one* working day left and
 * it is the most urgent thing on the board. Two of those three days do not
 * exist as capacity.
 *
 * So the two directions are measured differently, on purpose:
 *
 *   - **How late something already is → calendar days.** A client who has been
 *     waiting a fortnight has been waiting a fortnight; the weekend does not
 *     make that better, and "10 working days late" is a number only an
 *     operations team says out loud.
 *   - **How long is left → working days.** That is capacity to actually do the
 *     work, and it is the number that should decide whether a row is urgent.
 *
 * Holidays are a plain list rather than a calendar service: the pilot needs a
 * handful of dates per region, and a list can be configured by an admin
 * without a deployment. Everything is date-only and local-time — the platform
 * stores `requested_delivery` as a bare `YYYY-MM-DD`, so introducing a
 * timezone here would create a bug rather than fix one.
 */

/** 0 = Sunday … 6 = Saturday, matching `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface BusinessCalendar {
  /** Days that count as working. Defaults to Monday–Friday. */
  workdays: readonly Weekday[];
  /** `YYYY-MM-DD` dates that do not count, whatever day they fall on. */
  holidays: readonly string[];
}

/** Monday–Friday, no holidays. Override per tenant rather than editing this. */
export const DEFAULT_CALENDAR: BusinessCalendar = {
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
};

/** `YYYY-MM-DD` for a local date — never `toISOString`, which shifts to UTC. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a stored date into LOCAL midnight.
 *
 * `new Date('2026-08-17')` is parsed as UTC midnight, which in any negative
 * offset renders as the 16th — the classic off-by-one that makes a deadline
 * look a day tighter than it is. Building from parts avoids it.
 */
export function parseDay(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Does this date count as capacity? */
export function isWorkingDay(date: Date, cal: BusinessCalendar = DEFAULT_CALENDAR): boolean {
  if (cal.holidays.includes(isoDay(date))) return false;
  return cal.workdays.includes(date.getDay() as Weekday);
}

/** Midnight-normalised copy, so arithmetic never carries a stray time. */
function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Working days from `from` up to and including `to`.
 *
 * Counts the days you could actually work, EXCLUDING the starting day — "how
 * many working days do I still have" rather than "how many does this span
 * touch". Friday → Monday is 1: today is already partly spent, Monday is the
 * day you get.
 *
 * Returns a negative count when `to` is in the past, mirroring `daysUntil`.
 */
export function businessDaysBetween(
  from: Date,
  to: Date,
  cal: BusinessCalendar = DEFAULT_CALENDAR,
): number {
  const start = atMidnight(from);
  const end = atMidnight(to);
  if (start.getTime() === end.getTime()) return 0;

  const backwards = end < start;
  const [lo, hi] = backwards ? [end, start] : [start, end];

  let count = 0;
  const cursor = new Date(lo);
  // Step off the start day first: the day you are standing on is not capacity
  // you still have.
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= hi) {
    if (isWorkingDay(cursor, cal)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return backwards ? -count : count;
}

/**
 * Working days until a stored date. Null when there is no usable date, which
 * callers render as "no date" rather than as urgent.
 */
export function businessDaysUntil(
  due: string | null | undefined,
  today: Date,
  cal: BusinessCalendar = DEFAULT_CALENDAR,
): number | null {
  const target = parseDay(due);
  if (!target) return null;
  return businessDaysBetween(today, target, cal);
}

/**
 * Move forward by N working days — for back-calculating a target that must
 * land on a day someone can actually act.
 */
export function addBusinessDays(
  from: Date,
  days: number,
  cal: BusinessCalendar = DEFAULT_CALENDAR,
): Date {
  const cursor = atMidnight(from);
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(Math.trunc(days));
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + step);
    if (isWorkingDay(cursor, cal)) remaining -= 1;
  }
  return cursor;
}

/**
 * The forward-looking label.
 *
 * Lateness stays in calendar days — see the module note — so this only shapes
 * the "time left" half, where working days are what matter. The wording says
 * "working" explicitly, because "2 days left" on a Thursday means something
 * very different depending on whether the reader is counting the weekend.
 */
export function workingTimeLeft(businessDays: number | null): string {
  if (businessDays === null) return 'No date';
  if (businessDays <= 0) return 'Due today';
  if (businessDays === 1) return '1 working day left';
  return `${businessDays} working days left`;
}
