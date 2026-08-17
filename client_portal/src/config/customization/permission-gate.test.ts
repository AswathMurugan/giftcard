import { describe, it, expect } from 'vitest';
import { splitSlotId, isPermissionHidden } from './ConfigProvider';

describe('permission gating', { tags: ['customization', 'permissions', 'logic'] }, () => {
  describe('splitSlotId', { tags: ['logic'] }, () => {
    it('splits `<Page>.<name>` into parts', () => {
      expect(splitSlotId('BookOfBusinessPage.kpiOutflows')).toEqual({
        page: 'BookOfBusinessPage',
        name: 'kpiOutflows',
      });
    });

    it('handles names containing extra dots (name keeps the remainder)', { tags: ['edge-case'] }, () => {
      expect(splitSlotId('Page.a.b')).toEqual({ page: 'Page', name: 'a.b' });
    });

    it('handles a bare id with no dot', { tags: ['edge-case'] }, () => {
      expect(splitSlotId('Page')).toEqual({ page: 'Page', name: 'Page' });
    });
  });

  describe('isPermissionHidden', { tags: ['important'] }, () => {
    const allowed = new Set(['kpiInflows']);

    it('never hides an unflagged component', () => {
      expect(isPermissionHidden(false, 'kpiOutflows', undefined, false)).toBe(false);
      expect(isPermissionHidden(false, 'kpiOutflows', new Set(), false)).toBe(false);
    });

    it('fails CLOSED while loading with no resolved set (gated, no data yet)', { tags: ['edge-case'] }, () => {
      // Cold cache / no localStorage seed: hide rather than flash gated content.
      expect(isPermissionHidden(true, 'kpiOutflows', undefined, true)).toBe(true);
      // localStorage-seeded set present while still revalidating: use the set.
      expect(isPermissionHidden(true, 'kpiOutflows', allowed, true)).toBe(true);
      expect(isPermissionHidden(true, 'kpiInflows', allowed, true)).toBe(false);
    });

    it('fails CLOSED when the set is unresolved after load (fetch error)', { tags: ['edge-case'] }, () => {
      expect(isPermissionHidden(true, 'kpiOutflows', undefined, false)).toBe(true);
    });

    it('shows a gated component the user is allowed to see', () => {
      expect(isPermissionHidden(true, 'kpiInflows', allowed, false)).toBe(false);
    });

    it('hides a gated component missing from the allowed set', { tags: ['important'] }, () => {
      expect(isPermissionHidden(true, 'kpiOutflows', allowed, false)).toBe(true);
    });

    it('hides a gated component when the allowed set is empty', { tags: ['edge-case'] }, () => {
      expect(isPermissionHidden(true, 'kpiOutflows', new Set(), false)).toBe(true);
    });
  });
});
