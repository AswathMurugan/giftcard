import { describe, it, expect } from 'vitest';
import { isEmbeddedFrom } from './embedded';

describe('embedded', { tags: ['cross-app', 'logic'] }, () => {
  describe('isEmbeddedFrom', { tags: ['important'] }, () => {
    it('is embedded only when ?embedded=1', () => {
      expect(isEmbeddedFrom('?embedded=1')).toBe(true);
      expect(isEmbeddedFrom('?foo=bar&embedded=1')).toBe(true);
    });

    it('is standalone otherwise — iframe is NOT a signal', { tags: ['edge-case'] }, () => {
      // The preview always runs in an iframe; absence of ?embedded=1 must
      // still mean standalone (chrome visible).
      expect(isEmbeddedFrom('')).toBe(false);
      expect(isEmbeddedFrom('?embedded=0')).toBe(false);
      expect(isEmbeddedFrom('?embedded=true')).toBe(false);
    });

    it('tolerates malformed search', { tags: ['edge-case'] }, () => {
      expect(isEmbeddedFrom('not a query')).toBe(false);
    });
  });
});
