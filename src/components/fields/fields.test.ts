import { describe, it, expect } from 'vitest';
import { ssnDisplay } from './SsnInput';
import { nextPhoneValue } from './PhoneInput';

describe('fields', { tags: ['fields', 'logic'] }, () => {
  describe('ssnDisplay', { tags: ['important'] }, () => {
    it('masks a complete SSN when neither revealed nor focused', () => {
      expect(ssnDisplay('123-45-6789', false, false)).toBe('***-**-6789');
    });

    it('shows the real value while focused (so it stays editable)', () => {
      expect(ssnDisplay('123-45-6789', false, true)).toBe('123-45-6789');
    });

    it('shows the real value when revealed via the eye toggle', () => {
      expect(ssnDisplay('123-45-6789', true, false)).toBe('123-45-6789');
    });

    it('never masks an incomplete value', { tags: ['edge-case'] }, () => {
      expect(ssnDisplay('123-45', false, false)).toBe('123-45');
      expect(ssnDisplay('', false, false)).toBe('');
    });
  });

  describe('nextPhoneValue', { tags: ['important'] }, () => {
    it('live-formats typed digits', () => {
      expect(nextPhoneValue('2125550123', '')).toBe('+1 (212) 555-0123');
      expect(nextPhoneValue('212', '')).toBe('+1 (212)');
    });

    it('fixes the backspace trap on trailing punctuation', { tags: ['edge-case'] }, () => {
      // User hits backspace on "+1 (212)" → DOM gives "+1 (212"; the naive
      // re-format would restore the ")" making delete a no-op. The helper
      // drops the last digit instead.
      expect(nextPhoneValue('+1 (212', '+1 (212)')).toBe('21');
    });

    it('deletes normally when the result actually shrinks', { tags: ['edge-case'] }, () => {
      expect(nextPhoneValue('+1 (212) 555-012', '+1 (212) 555-0123')).toBe('+1 (212) 555-012');
    });
  });
});
