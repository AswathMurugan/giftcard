import { describe, it, expect } from 'vitest';
import { asText, coerceBool, asNumber } from './runtime';

describe('runtime coercions', { tags: ['runtime', 'logic'] }, () => {
  describe('coerceBool', { tags: ['important'] }, () => {
    it('handles real booleans (the type-drift case: declared string, returns boolean)', () => {
      expect(coerceBool(true)).toBe(true);
      expect(coerceBool(false)).toBe(false);
    });
    it('handles 0/1 numbers', () => {
      expect(coerceBool(1)).toBe(true);
      expect(coerceBool(0)).toBe(false);
    });
    it('handles truthy strings (case-insensitive)', () => {
      expect(coerceBool('true')).toBe(true);
      expect(coerceBool('Active')).toBe(true);
      expect(coerceBool('YES')).toBe(true);
      expect(coerceBool(' 1 ')).toBe(true);
    });
    it('returns false for falsey / unexpected shapes', { tags: ['edge-case'] }, () => {
      expect(coerceBool('false')).toBe(false);
      expect(coerceBool('0')).toBe(false);
      expect(coerceBool('')).toBe(false);
      expect(coerceBool(null)).toBe(false);
      expect(coerceBool(undefined)).toBe(false);
      expect(coerceBool({})).toBe(false);
    });
  });

  describe('asText', { tags: ['logic'] }, () => {
    it('passes strings through and stringifies number/boolean', () => {
      expect(asText('hello')).toBe('hello');
      expect(asText(42)).toBe('42');
      expect(asText(true)).toBe('true');
    });
    it('returns empty string for null/object/NaN', { tags: ['edge-case'] }, () => {
      expect(asText(null)).toBe('');
      expect(asText(undefined)).toBe('');
      expect(asText({})).toBe('');
      expect(asText(NaN)).toBe('');
    });
  });

  describe('asNumber', { tags: ['logic'] }, () => {
    it('returns finite numbers and parses numeric strings', () => {
      expect(asNumber(3.14)).toBe(3.14);
      expect(asNumber('100')).toBe(100);
    });
    it('returns null for non-numeric / empty / unexpected', { tags: ['edge-case'] }, () => {
      expect(asNumber('abc')).toBeNull();
      expect(asNumber('')).toBeNull();
      expect(asNumber(null)).toBeNull();
      expect(asNumber(NaN)).toBeNull();
      expect(asNumber({})).toBeNull();
    });
  });
});
