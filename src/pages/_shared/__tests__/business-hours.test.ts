/**
 * Working-time arithmetic.
 *
 * The case that motivates the whole module is Friday → Monday: calendar
 * arithmetic calls it three days and marks the row comfortable, when there is
 * exactly one working day left. Every other test here exists to stop that fix
 * introducing a subtler error — a timezone shift, a miscounted holiday, or the
 * boundary where "today" is itself a weekend.
 *
 * Dates are built from parts throughout. `new Date('2026-08-17')` parses as UTC
 * midnight and renders as the 16th in any negative offset, which is precisely
 * the off-by-one this module exists to avoid.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CALENDAR,
  addBusinessDays,
  businessDaysBetween,
  businessDaysUntil,
  isWorkingDay,
  isoDay,
  parseDay,
  workingTimeLeft,
  type BusinessCalendar,
} from '@/pages/_shared/business-hours';

/** 2026-08-17 is a Monday; the week runs Mon 17 → Sun 23. */
const MON = new Date(2026, 7, 17);
const FRI = new Date(2026, 7, 21);
const SAT = new Date(2026, 7, 22);
const SUN = new Date(2026, 7, 23);
const NEXT_MON = new Date(2026, 7, 24);

describe('isWorkingDay', { tags: ['milestones', 'logic'] }, () => {
  it('counts weekdays and not weekends', { tags: ['smoke'] }, () => {
    expect(isWorkingDay(MON)).toBe(true);
    expect(isWorkingDay(FRI)).toBe(true);
    expect(isWorkingDay(SAT)).toBe(false);
    expect(isWorkingDay(SUN)).toBe(false);
  });

  it('drops a configured holiday even on a weekday', { tags: ['important'] }, () => {
    const cal: BusinessCalendar = { ...DEFAULT_CALENDAR, holidays: ['2026-08-17'] };
    expect(isWorkingDay(MON, cal)).toBe(false);
    expect(isWorkingDay(FRI, cal)).toBe(true);
  });

  it('supports a different working week', { tags: ['edge-case'] }, () => {
    // Sun–Thu, as used in parts of the Middle East.
    const cal: BusinessCalendar = { workdays: [0, 1, 2, 3, 4], holidays: [] };
    expect(isWorkingDay(SUN, cal)).toBe(true);
    expect(isWorkingDay(FRI, cal)).toBe(false);
  });
});

describe('businessDaysBetween', { tags: ['milestones', 'important'] }, () => {
  /** The reason this module exists. */
  it('counts Friday to Monday as one working day, not three', { tags: ['smoke'] }, () => {
    expect(businessDaysBetween(FRI, NEXT_MON)).toBe(1);
  });

  it('counts a plain mid-week gap normally', () => {
    expect(businessDaysBetween(MON, FRI)).toBe(4);
  });

  it('excludes the day you are standing on', () => {
    // Today is already partly spent — capacity is the days you still get.
    expect(businessDaysBetween(MON, MON)).toBe(0);
    expect(businessDaysBetween(MON, new Date(2026, 7, 18))).toBe(1);
  });

  it('gives a weekend no capacity at all', { tags: ['important'] }, () => {
    expect(businessDaysBetween(FRI, SAT)).toBe(0);
    expect(businessDaysBetween(FRI, SUN)).toBe(0);
    expect(businessDaysBetween(SAT, SUN)).toBe(0);
  });

  it('goes negative in the past, mirroring the calendar helper', () => {
    expect(businessDaysBetween(NEXT_MON, FRI)).toBe(-1);
    expect(businessDaysBetween(FRI, MON)).toBe(-4);
  });

  it('skips holidays inside the span', { tags: ['important'] }, () => {
    const cal: BusinessCalendar = { ...DEFAULT_CALENDAR, holidays: ['2026-08-19'] };
    expect(businessDaysBetween(MON, FRI, cal)).toBe(3);
  });

  it('spans a whole week correctly', { tags: ['edge-case'] }, () => {
    // Mon 17 → Mon 24 touches one weekend: five working days.
    expect(businessDaysBetween(MON, NEXT_MON)).toBe(5);
  });

  it('handles a start that is itself a weekend', { tags: ['edge-case'] }, () => {
    expect(businessDaysBetween(SAT, NEXT_MON)).toBe(1);
  });
});

describe('businessDaysUntil', { tags: ['milestones', 'logic'] }, () => {
  it('reads a stored YYYY-MM-DD', { tags: ['smoke'] }, () => {
    expect(businessDaysUntil('2026-08-24', FRI)).toBe(1);
    expect(businessDaysUntil('2026-08-21', MON)).toBe(4);
  });

  it('tolerates a full timestamp', { tags: ['edge-case'] }, () => {
    expect(businessDaysUntil('2026-08-24T09:30:00.000Z', FRI)).toBe(1);
  });

  it('returns null rather than urgent for a missing date', { tags: ['important'] }, () => {
    expect(businessDaysUntil(null, MON)).toBeNull();
    expect(businessDaysUntil(undefined, MON)).toBeNull();
    expect(businessDaysUntil('', MON)).toBeNull();
    expect(businessDaysUntil('not a date', MON)).toBeNull();
  });
});

describe('parseDay / isoDay', { tags: ['milestones', 'edge-case'] }, () => {
  /** The off-by-one this module exists to avoid. */
  it('parses to local midnight, not UTC', () => {
    const d = parseDay('2026-08-17');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7);
    expect(d?.getDate()).toBe(17);
  });

  it('round-trips through isoDay', () => {
    expect(isoDay(parseDay('2026-08-17') as Date)).toBe('2026-08-17');
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('rejects nonsense', () => {
    expect(parseDay('17/08/2026')).toBeNull();
    expect(parseDay(null)).toBeNull();
  });
});

describe('addBusinessDays', { tags: ['milestones', 'logic'] }, () => {
  it('steps over the weekend', { tags: ['smoke'] }, () => {
    expect(isoDay(addBusinessDays(FRI, 1))).toBe('2026-08-24');
    expect(isoDay(addBusinessDays(MON, 5))).toBe('2026-08-24');
  });

  it('goes backwards too', () => {
    expect(isoDay(addBusinessDays(NEXT_MON, -1))).toBe('2026-08-21');
  });

  it('is a no-op for zero', { tags: ['edge-case'] }, () => {
    expect(isoDay(addBusinessDays(MON, 0))).toBe('2026-08-17');
  });

  it('lands on a working day even starting from a weekend', { tags: ['edge-case'] }, () => {
    expect(isoDay(addBusinessDays(SAT, 1))).toBe('2026-08-24');
  });
});

describe('workingTimeLeft', { tags: ['milestones', 'logic'] }, () => {
  it('names the unit, because "2 days" is ambiguous on a Thursday', () => {
    expect(workingTimeLeft(2)).toBe('2 working days left');
    expect(workingTimeLeft(1)).toBe('1 working day left');
  });

  it('collapses today and anything past it', { tags: ['edge-case'] }, () => {
    expect(workingTimeLeft(0)).toBe('Due today');
    expect(workingTimeLeft(-3)).toBe('Due today');
  });

  it('says so when there is no date', { tags: ['edge-case'] }, () => {
    expect(workingTimeLeft(null)).toBe('No date');
  });
});
