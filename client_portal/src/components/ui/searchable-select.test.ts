import { describe, it, expect } from 'vitest';
import { normalizeOptions } from './searchable-select-utils';

describe('searchable-select', { tags: ['ui', 'logic'] }, () => {
  describe('normalizeOptions', { tags: ['important'] }, () => {
    it('maps bare strings to { label, value }', { tags: ['smoke'] }, () => {
      expect(normalizeOptions(['Chase Bank', 'US Bank'])).toEqual([
        { label: 'Chase Bank', value: 'Chase Bank' },
        { label: 'US Bank', value: 'US Bank' },
      ]);
    });

    it('passes { label, value } objects through (incl. disabled)', () => {
      const opts = [
        { label: 'Chase Bank', value: 'chase' },
        { label: 'Closed Bank', value: 'closed', disabled: true },
      ];
      expect(normalizeOptions(opts)).toEqual(opts);
    });

    it('supports a mixed array of strings and objects', () => {
      expect(
        normalizeOptions(['Wells Fargo', { label: 'Citibank', value: 'citi' }]),
      ).toEqual([
        { label: 'Wells Fargo', value: 'Wells Fargo' },
        { label: 'Citibank', value: 'citi' },
      ]);
    });

    it('returns [] for null / undefined / non-array', { tags: ['edge-case'] }, () => {
      expect(normalizeOptions(null)).toEqual([]);
      expect(normalizeOptions(undefined)).toEqual([]);
      // @ts-expect-error — guarding a wrong runtime type
      expect(normalizeOptions('nope')).toEqual([]);
    });
  });
});
