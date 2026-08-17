import { describe, it, expect } from 'vitest';
import {
  parseTime,
  formatTime,
  wrap,
  to12h,
  from12h,
} from './time-picker';

describe('TimePicker helpers', { tags: ['time-picker', 'logic'] }, () => {
  describe('parseTime', { tags: ['important'] }, () => {
    it('parses a well-formed "HH:mm" string', { tags: ['smoke'] }, () => {
      expect(parseTime('09:30')).toEqual({ hour: 9, minute: 30 });
      expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 });
      expect(parseTime('00:00')).toEqual({ hour: 0, minute: 0 });
    });

    it('falls back to 00:00 for empty/undefined', { tags: ['edge-case'] }, () => {
      expect(parseTime(undefined)).toEqual({ hour: 0, minute: 0 });
      expect(parseTime('')).toEqual({ hour: 0, minute: 0 });
    });

    it('clamps out-of-range parts', { tags: ['edge-case'] }, () => {
      expect(parseTime('99:99')).toEqual({ hour: 23, minute: 59 });
      expect(parseTime('-5:-5')).toEqual({ hour: 0, minute: 0 });
    });

    it('tolerates non-numeric junk', { tags: ['edge-case'] }, () => {
      expect(parseTime('ab:cd')).toEqual({ hour: 0, minute: 0 });
      expect(parseTime('12')).toEqual({ hour: 12, minute: 0 });
    });
  });

  describe('formatTime', { tags: ['important'] }, () => {
    it('zero-pads hours and minutes', () => {
      expect(formatTime({ hour: 9, minute: 5 })).toBe('09:05');
      expect(formatTime({ hour: 0, minute: 0 })).toBe('00:00');
      expect(formatTime({ hour: 23, minute: 59 })).toBe('23:59');
    });

    it('round-trips with parseTime', { tags: ['smoke'] }, () => {
      for (const v of ['00:00', '07:08', '13:45', '23:59']) {
        expect(formatTime(parseTime(v))).toBe(v);
      }
    });
  });

  describe('wrap', { tags: ['logic'] }, () => {
    it('wraps within the modulus', () => {
      expect(wrap(0, 24)).toBe(0);
      expect(wrap(24, 24)).toBe(0);
      expect(wrap(25, 24)).toBe(1);
    });

    it('wraps negatives forward', { tags: ['edge-case'] }, () => {
      expect(wrap(-1, 24)).toBe(23);
      expect(wrap(-1, 60)).toBe(59);
      expect(wrap(-25, 24)).toBe(23);
    });
  });

  describe('to12h', { tags: ['logic'] }, () => {
    it('maps midnight and noon correctly', { tags: ['edge-case'] }, () => {
      expect(to12h(0)).toEqual({ h12: 12, meridiem: 'AM' });
      expect(to12h(12)).toEqual({ h12: 12, meridiem: 'PM' });
    });

    it('maps AM and PM ranges', () => {
      expect(to12h(1)).toEqual({ h12: 1, meridiem: 'AM' });
      expect(to12h(11)).toEqual({ h12: 11, meridiem: 'AM' });
      expect(to12h(13)).toEqual({ h12: 1, meridiem: 'PM' });
      expect(to12h(23)).toEqual({ h12: 11, meridiem: 'PM' });
    });
  });

  describe('from12h', { tags: ['logic'] }, () => {
    it('maps 12 AM/PM correctly', { tags: ['edge-case'] }, () => {
      expect(from12h(12, 'AM')).toBe(0);
      expect(from12h(12, 'PM')).toBe(12);
    });

    it('maps AM and PM ranges', () => {
      expect(from12h(1, 'AM')).toBe(1);
      expect(from12h(11, 'AM')).toBe(11);
      expect(from12h(1, 'PM')).toBe(13);
      expect(from12h(11, 'PM')).toBe(23);
    });

    it('round-trips with to12h across all 24 hours', { tags: ['important'] }, () => {
      for (let h = 0; h < 24; h++) {
        const { h12, meridiem } = to12h(h);
        expect(from12h(h12, meridiem)).toBe(h);
      }
    });
  });
});
