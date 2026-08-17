import { describe, it, expect } from 'vitest';
import { escapeCelString, celString } from './cel';

describe('cel', { tags: ['cel', 'logic'] }, () => {
  describe('escapeCelString', { tags: ['important'] }, () => {
    it('escapes single quotes with a backslash (never SQL doubling)', () => {
      expect(escapeCelString("O'Brien")).toBe("O\\'Brien");
      expect(escapeCelString("''")).toBe("\\'\\'");
    });

    it('doubles backslashes FIRST so user input cannot form escapes', () => {
      expect(escapeCelString('C:\\temp')).toBe('C:\\\\temp');
      // A backslash followed by a quote must not collapse into \' early.
      expect(escapeCelString("\\'")).toBe("\\\\\\'");
    });

    it('passes plain strings through untouched', () => {
      expect(escapeCelString('plain text 123 %_')).toBe('plain text 123 %_');
      expect(escapeCelString('')).toBe('');
    });
  });

  describe('celString', { tags: ['smoke'] }, () => {
    it('returns the fully quoted literal', () => {
      expect(celString("O'Brien")).toBe("'O\\'Brien'");
      expect(celString('plain')).toBe("'plain'");
      expect(celString('')).toBe("''");
    });
  });
});
