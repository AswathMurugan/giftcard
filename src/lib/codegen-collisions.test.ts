import { describe, it, expect } from 'vitest';
import {
  detectNameCollisions,
  formatCollisionWarning,
  appKeyDir,
} from './codegen-collisions';

describe('codegen-collisions', { tags: ['codegen', 'logic'] }, () => {
  describe('detectNameCollisions', { tags: ['important'] }, () => {
    it('returns empty when every name is unique to one app', () => {
      const c = detectNameCollisions([
        { name: 'account', appKey: 'wealthdomain' },
        { name: 'client', appKey: 'wealthdomain' },
        { name: 'sr_instance', appKey: 'platform' },
      ]);
      expect(c.size).toBe(0);
    });

    it(
      'flags a name shared across distinct apps',
      { tags: ['important'] },
      () => {
        const c = detectNameCollisions([
          { name: 'account', appKey: 'wealthdomain' },
          { name: 'account', appKey: 'platform' },
          { name: 'client', appKey: 'wealthdomain' },
        ]);
        expect([...c.keys()]).toEqual(['account']);
        expect(c.get('account')).toEqual(['platform', 'wealthdomain']); // sorted
      },
    );

    it(
      'does NOT flag the same (name, app) appearing twice (dupe, not collision)',
      { tags: ['edge-case'] },
      () => {
        const c = detectNameCollisions([
          { name: 'account', appKey: 'wealthdomain' },
          { name: 'account', appKey: 'wealthdomain' },
        ]);
        expect(c.size).toBe(0);
      },
    );

    it('ignores entries without a name', { tags: ['edge-case'] }, () => {
      const c = detectNameCollisions([
        { name: '', appKey: 'a' },
        // @ts-expect-error — defensive runtime guard.
        { appKey: 'b' },
      ]);
      expect(c.size).toBe(0);
    });
  });

  describe('formatCollisionWarning', { tags: ['logic'] }, () => {
    it('returns null when there are no collisions', () => {
      expect(formatCollisionWarning('entity', new Map())).toBeNull();
    });

    it('enumerates collided names + their apps', () => {
      const w = formatCollisionWarning(
        'entity',
        new Map([['account', ['platform', 'wealthdomain']]]),
      );
      expect(w).toContain('1 entity name(s)');
      expect(w).toContain('account (platform, wealthdomain)');
    });
  });

  describe('appKeyDir', { tags: ['logic'] }, () => {
    it('passes through a clean app key', () => {
      expect(appKeyDir('wealthdomain_69c65d7d')).toBe('wealthdomain_69c65d7d');
      expect(appKeyDir('platform')).toBe('platform');
    });
    it('sanitises unsafe chars and falls back for empty', {
      tags: ['edge-case'],
    }, () => {
      expect(appKeyDir('a/b.c')).toBe('a_b_c');
      expect(appKeyDir('')).toBe('_unknown_app');
      expect(appKeyDir(undefined)).toBe('_unknown_app');
    });
  });
});
