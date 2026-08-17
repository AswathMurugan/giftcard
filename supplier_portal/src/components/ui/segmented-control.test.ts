import { describe, it, expect } from 'vitest';
import { normalizeSegOptions, nextSegIndex } from './segmented-control';

describe('segmented-control', { tags: ['segmented-control', 'logic'] }, () => {
  describe('normalizeSegOptions', { tags: ['important'] }, () => {
    it('turns strings into {value, label} pairs', () => {
      expect(normalizeSegOptions(['GET', 'POST'])).toEqual([
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
      ]);
    });

    it('defaults a missing label to the value, keeping other props', () => {
      expect(normalizeSegOptions([{ value: 'hi', icon: 'icon_-Tb_list', disabled: true }])).toEqual([
        { value: 'hi', label: 'hi', icon: 'icon_-Tb_list', disabled: true },
      ]);
    });

    it('preserves an explicit label', { tags: ['edge-case'] }, () => {
      expect(normalizeSegOptions([{ value: 'y', label: 'Yes' }])).toEqual([
        { value: 'y', label: 'Yes' },
      ]);
    });
  });

  describe('nextSegIndex', { tags: ['important'] }, () => {
    const abc = [{}, {}, {}];

    it('steps forward and backward', () => {
      expect(nextSegIndex(0, 1, abc)).toBe(1);
      expect(nextSegIndex(1, -1, abc)).toBe(0);
    });

    it('wraps around both ends', { tags: ['edge-case'] }, () => {
      expect(nextSegIndex(2, 1, abc)).toBe(0);
      expect(nextSegIndex(0, -1, abc)).toBe(2);
    });

    it('skips disabled options', { tags: ['edge-case'] }, () => {
      const opts = [{}, { disabled: true }, {}];
      expect(nextSegIndex(0, 1, opts)).toBe(2);
      expect(nextSegIndex(2, -1, opts)).toBe(0);
    });

    it('returns current when every other option is disabled', { tags: ['edge-case'] }, () => {
      const opts = [{ disabled: true }, {}, { disabled: true }];
      expect(nextSegIndex(1, 1, opts)).toBe(1);
      expect(nextSegIndex(0, 1, [])).toBe(0);
    });
  });
});
