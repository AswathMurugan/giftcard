import { describe, it, expect } from 'vitest';
import {
  formatPhone,
  isCompletePhone,
  formatSsn,
  isCompleteSsn,
  maskSsn,
  maskSsnInput,
  formatEin,
  isCompleteEin,
  isValidEmail,
  MONEY_RE,
  sanitizeMoney,
  formatMoneyDisplay,
  formatUsd,
  parseDateOnly,
  toDateOnlyString,
  formatDate,
  formatDateTime,
  validatePostalForFormat,
  postalPlaceholder,
  postalComplete,
} from './index';

describe('field-format', { tags: ['field-format', 'logic'] }, () => {
  describe('formatPhone', { tags: ['important'] }, () => {
    it('returns empty for empty / nullish input', { tags: ['edge-case'] }, () => {
      expect(formatPhone('')).toBe('');
      expect(formatPhone(undefined as unknown as string)).toBe('');
    });

    it('shows raw digits until the area code is complete', () => {
      expect(formatPhone('2')).toBe('2');
      expect(formatPhone('20')).toBe('20');
    });

    it('builds up +1 (XXX) XXX-XXXX progressively', () => {
      expect(formatPhone('212')).toBe('+1 (212)');
      expect(formatPhone('212555')).toBe('+1 (212) 555');
      expect(formatPhone('2125550123')).toBe('+1 (212) 555-0123');
    });

    it('strips a leading 1 country-code digit and caps at 10 digits', { tags: ['edge-case'] }, () => {
      expect(formatPhone('12125550123')).toBe('+1 (212) 555-0123');
      expect(formatPhone('21255501239999')).toBe('+1 (212) 555-0123');
    });

    it('re-formats an already-formatted value idempotently', () => {
      expect(formatPhone('+1 (212) 555-0123')).toBe('+1 (212) 555-0123');
    });
  });

  describe('isCompletePhone', { tags: ['smoke'] }, () => {
    it('is true only for a full 10-digit national number', () => {
      expect(isCompletePhone('+1 (212) 555-0123')).toBe(true);
      expect(isCompletePhone('12125550123')).toBe(true);
      expect(isCompletePhone('')).toBe(false);
      expect(isCompletePhone(undefined)).toBe(false);
      expect(isCompletePhone('212555012')).toBe(false);
    });
  });

  describe('formatSsn / isCompleteSsn', { tags: ['important'] }, () => {
    it('masks digits progressively into XXX-XX-XXXX', () => {
      expect(formatSsn('123')).toBe('123');
      expect(formatSsn('1234')).toBe('123-4');
      expect(formatSsn('12345')).toBe('123-45');
      expect(formatSsn('123456789')).toBe('123-45-6789');
    });

    it('strips non-digits and caps at 9 digits', { tags: ['edge-case'] }, () => {
      expect(formatSsn('abc123-45-6789xx')).toBe('123-45-6789');
      expect(formatSsn('')).toBe('');
    });

    it('accepts only a full SSN as complete', () => {
      expect(isCompleteSsn('123-45-6789')).toBe(true);
      expect(isCompleteSsn('123456789')).toBe(false);
      expect(isCompleteSsn(undefined)).toBe(false);
    });
  });

  describe('maskSsn / maskSsnInput', { tags: ['important'] }, () => {
    it('maskSsnInput masks a complete SSN to last 4, leaves partials as-is', () => {
      expect(maskSsnInput('123-45-6789')).toBe('***-**-6789');
      expect(maskSsnInput('123456789')).toBe('***-**-6789');
      expect(maskSsnInput('123-45')).toBe('123-45');
      expect(maskSsnInput('')).toBe('');
      expect(maskSsnInput(undefined)).toBe('');
    });

    it('maskSsn masks for read-only display, dash when empty', { tags: ['edge-case'] }, () => {
      expect(maskSsn('123-45-6789')).toBe('•••-••-6789');
      expect(maskSsn('')).toBe('—');
      expect(maskSsn(undefined)).toBe('—');
    });
  });

  describe('formatEin / isCompleteEin', { tags: ['important'] }, () => {
    it('formats as XX-XXXXXXX', () => {
      expect(formatEin('1')).toBe('1');
      expect(formatEin('12')).toBe('12');
      expect(formatEin('123456789')).toBe('12-3456789');
      expect(formatEin('12a3456789999')).toBe('12-3456789');
    });

    it('accepts only a full EIN as complete', { tags: ['edge-case'] }, () => {
      expect(isCompleteEin('12-3456789')).toBe(true);
      expect(isCompleteEin('123456789')).toBe(false);
      expect(isCompleteEin('')).toBe(false);
      expect(isCompleteEin(undefined)).toBe(false);
    });
  });

  describe('isValidEmail', { tags: ['important'] }, () => {
    it('accepts well-formed addresses', () => {
      expect(isValidEmail('jane.doe@example.com')).toBe(true);
      expect(isValidEmail('  trimmed@example.org  ')).toBe(true);
      expect(isValidEmail('user+tag@sub.domain.io')).toBe(true);
    });

    it('rejects malformed / empty addresses', { tags: ['edge-case'] }, () => {
      expect(isValidEmail('hghjjhgjhgjhg')).toBe(false);
      expect(isValidEmail('foo@bar')).toBe(false); // no TLD
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('a b@example.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
    });
  });

  describe('sanitizeMoney / formatMoneyDisplay', { tags: ['important'] }, () => {
    it('keeps only digits and one dot with max 2 decimals', () => {
      expect(sanitizeMoney('$1,234.567')).toBe('1234.56');
      expect(sanitizeMoney('12.3.4')).toBe('12.34');
      expect(sanitizeMoney('abc')).toBe('');
    });

    it('MONEY_RE matches stored money strings', { tags: ['smoke'] }, () => {
      expect(MONEY_RE.test('1234')).toBe(true);
      expect(MONEY_RE.test('1234.5')).toBe(true);
      expect(MONEY_RE.test('1234.56')).toBe(true);
      expect(MONEY_RE.test('1,234')).toBe(false);
      expect(MONEY_RE.test('12.345')).toBe(false);
    });

    it('groups thousands for display and preserves decimals', () => {
      expect(formatMoneyDisplay('1234567')).toBe('1,234,567');
      expect(formatMoneyDisplay('1234.5')).toBe('1,234.5');
      expect(formatMoneyDisplay('')).toBe('');
      expect(formatMoneyDisplay(null)).toBe('');
      expect(formatMoneyDisplay(1234)).toBe('1,234');
    });
  });

  describe('formatUsd', { tags: ['important'] }, () => {
    it('formats numbers and numeric strings as USD with cents by default', () => {
      expect(formatUsd(1234.5)).toBe('$1,234.50');
      expect(formatUsd('1234.5')).toBe('$1,234.50');
    });

    it('cents:false rounds to whole dollars', () => {
      expect(formatUsd(1234.5, { cents: false })).toBe('$1,235');
      expect(formatUsd(1000000, { cents: false })).toBe('$1,000,000');
    });

    it('falls back for non-numeric values', { tags: ['edge-case'] }, () => {
      expect(formatUsd(null)).toBe('—');
      expect(formatUsd('abc')).toBe('—');
      expect(formatUsd('', { fallback: '' })).toBe('');
      expect(formatUsd(undefined, { fallback: 'N/A' })).toBe('N/A');
    });
  });

  describe('parseDateOnly / toDateOnlyString', { tags: ['important'] }, () => {
    it('round-trips yyyy-MM-dd through a local Date without TZ shift', () => {
      const d = parseDateOnly('2026-07-15');
      expect(d).toBeInstanceOf(Date);
      expect(toDateOnlyString(d)).toBe('2026-07-15');
    });

    it('handles empty values', { tags: ['edge-case'] }, () => {
      expect(parseDateOnly('')).toBeUndefined();
      expect(parseDateOnly(undefined)).toBeUndefined();
      expect(toDateOnlyString(undefined)).toBe('');
    });
  });

  describe('formatDate / formatDateTime', { tags: ['important'] }, () => {
    it('reads the calendar date literally from ISO strings (no TZ shift)', () => {
      expect(formatDate('2026-07-15')).toBe('07/15/2026');
      expect(formatDate('2026-07-15T00:00:00Z')).toBe('07/15/2026');
      expect(formatDateTime('2026-06-24T09:48:00Z')).toBe('06/24/2026, 9:48 AM');
      expect(formatDateTime('2026-06-24T21:05:00Z')).toBe('06/24/2026, 9:05 PM');
    });

    it('degrades gracefully for absent / unparseable values', { tags: ['edge-case'] }, () => {
      expect(formatDate('')).toBe('—');
      expect(formatDate(null)).toBe('—');
      expect(formatDate('not a date')).toBe('not a date');
      expect(formatDateTime('2026-07-15')).toBe('07/15/2026'); // date-only → no time part
    });
  });

  describe('postal helpers', { tags: ['important'] }, () => {
    it('clamps input per format', () => {
      expect(validatePostalForFormat('12345-6789x', 'zip5', true)).toBe('12345');
      expect(validatePostalForFormat('123456789', 'zip9', true)).toBe('12345-6789');
      expect(validatePostalForFormat('1234567', 'zip6', false)).toBe('123456');
      expect(validatePostalForFormat('SW1A 1AA!!', 'alnum', false)).toBe('SW1A 1AA');
      expect(validatePostalForFormat('12345678', 'auto', true)).toBe('12345');
      expect(validatePostalForFormat('SW1A 1AA', 'auto', false)).toBe('SW1A 1AA');
    });

    it('reports completeness per format', () => {
      expect(postalComplete('12345', 'zip5')).toBe(true);
      expect(postalComplete('1234', 'zip5')).toBe(false);
      expect(postalComplete('12345-6789', 'zip9')).toBe(true);
      expect(postalComplete('12345', 'zip9')).toBe(true); // zip9 accepts plain zip5
      expect(postalComplete('', 'auto')).toBe(false);
      expect(postalComplete('X', 'alnum')).toBe(true);
    });

    it('provides placeholders per format', { tags: ['smoke'] }, () => {
      expect(postalPlaceholder('zip5', true)).toBe('ZIP code (5 digits)');
      expect(postalPlaceholder('auto', true)).toBe('ZIP code');
      expect(postalPlaceholder('auto', false)).toBe('Postal code');
    });
  });
});
