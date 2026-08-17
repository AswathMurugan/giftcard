import { describe, it, expect } from 'vitest';
import {
  normalisePermissions,
  normaliseComponentPermissions,
  componentNameFromResource,
  type Permission,
} from './use-permissions';

describe('use-permissions', { tags: ['permissions', 'logic'] }, () => {
  describe('normalisePermissions (screen-level)', { tags: ['important'] }, () => {
    it('keeps only allow entries, grouping actions by resource', () => {
      const list: Permission[] = [
        { resource: 'app.screen.home', resource_type: 'screen', action: 'read', permission: 'allow' },
        { resource: 'app.screen.home', resource_type: 'screen', action: 'write', permission: 'allow' },
        { resource: 'app.screen.admin', resource_type: 'screen', action: 'write', permission: 'deny' },
      ];
      const map = normalisePermissions(list);
      expect(new Set(map['app.screen.home'])).toEqual(new Set(['read', 'write']));
      expect(map['app.screen.admin']).toBeUndefined();
    });
  });

  describe('componentNameFromResource', { tags: ['logic'] }, () => {
    it('extracts the component name after .screen.', () => {
      expect(componentNameFromResource('wealthtest_69ce.screen.kpiOutflows')).toBe('kpiOutflows');
    });

    it('falls back to the last dot segment', { tags: ['edge-case'] }, () => {
      expect(componentNameFromResource('foo.bar.baz')).toBe('baz');
      expect(componentNameFromResource('plain')).toBe('plain');
    });
  });

  describe('normaliseComponentPermissions', { tags: ['important'] }, () => {
    it('returns allowed component names from allow entries', () => {
      const list: Permission[] = [
        { resource: 'app.screen.kpiOutflows', resource_type: 'screen_component', action: 'write', permission: 'allow' },
        { resource: 'app.screen.kpiInflows', resource_type: 'screen_component', action: 'write', permission: 'allow' },
      ];
      expect(new Set(normaliseComponentPermissions(list))).toEqual(
        new Set(['kpiOutflows', 'kpiInflows']),
      );
    });

    it('excludes deny entries', { tags: ['edge-case'] }, () => {
      const list: Permission[] = [
        { resource: 'app.screen.kpiOutflows', resource_type: 'screen_component', action: 'write', permission: 'deny' },
      ];
      expect(normaliseComponentPermissions(list)).toEqual([]);
    });

    it('returns empty for empty input', { tags: ['edge-case'] }, () => {
      expect(normaliseComponentPermissions([])).toEqual([]);
    });
  });
});
