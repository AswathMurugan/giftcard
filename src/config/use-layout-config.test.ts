import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from './layout';
import {
  parseLayoutPreferences,
  resolveLayoutConfig,
  type LayoutPreferenceRecord,
} from './use-layout-config';

describe('layout config', { tags: ['layout', 'logic'] }, () => {
  describe('resolveLayoutConfig', { tags: ['important'] }, () => {
    it('returns defaults when nothing is set', () => {
      expect(resolveLayoutConfig(null, null)).toEqual(DEFAULT_LAYOUT_CONFIG);
    });

    it('applies the override over defaults', () => {
      const r = resolveLayoutConfig({ sidebar: 'hidden' }, null);
      expect(r.sidebar).toBe('hidden');
      expect(r.header).toBe('visible'); // untouched
    });

    it('preferences win over the override', () => {
      const r = resolveLayoutConfig(
        { sidebar: 'hidden', variant: 'compact' },
        { sidebar: 'visible' },
      );
      expect(r.sidebar).toBe('visible'); // pref wins
      expect(r.variant).toBe('compact'); // override kept
    });

    it('defaultCollapsed defaults true and honors override/pref', () => {
      expect(resolveLayoutConfig(null, null).defaultCollapsed).toBe(true);
      // An app can opt out via the override…
      expect(resolveLayoutConfig({ defaultCollapsed: false }, null).defaultCollapsed).toBe(false);
      // …and a preference still wins over the override.
      expect(
        resolveLayoutConfig({ defaultCollapsed: false }, { defaultCollapsed: true }).defaultCollapsed,
      ).toBe(true); // pref wins
    });
  });

  describe('parseLayoutPreferences', { tags: ['important'] }, () => {
    function rec(name: string, value: string, extra: Partial<LayoutPreferenceRecord> = {}) {
      return { name, value, ...extra };
    }

    it('parses visibility, colour, and variant keys', () => {
      const out = parseLayoutPreferences([
        rec('App.Layout.Sidebar', 'hidden'),
        rec('App.Layout.Header', 'visible'),
        rec('App.Layout.SidebarColor', '#000000'),
        rec('App.Layout.SidebarTextColor', '#fff'),
        rec('App.Layout.SidebarActiveColor', '#abcdef12'),
        rec('App.Layout.Variant', 'compact'),
      ]);
      expect(out).toEqual({
        sidebar: 'hidden',
        header: 'visible',
        sidebarColor: '#000000',
        sidebarTextColor: '#fff',
        sidebarActiveColor: '#abcdef12',
        variant: 'compact',
      });
    });

    it('parses App.Layout.DefaultCollapsed as a boolean', () => {
      expect(parseLayoutPreferences([rec('App.Layout.DefaultCollapsed', 'true')])).toEqual({
        defaultCollapsed: true,
      });
      expect(parseLayoutPreferences([rec('App.Layout.DefaultCollapsed', 'false')])).toEqual({
        defaultCollapsed: false,
      });
    });

    it('ignores invalid values', { tags: ['edge-case'] }, () => {
      const out = parseLayoutPreferences([
        rec('App.Layout.Sidebar', 'sometimes'),
        rec('App.Layout.SidebarColor', 'red'), // not hex
        rec('App.Layout.Variant', 'fancy'),
        rec('App.Layout.DefaultCollapsed', 'maybe'),
      ]);
      expect(out).toEqual({});
    });

    it('skips disabled records and non-layout names', { tags: ['edge-case'] }, () => {
      const out = parseLayoutPreferences([
        rec('App.Layout.Sidebar', 'hidden', { disabled: true }),
        rec('App.Theme', '{}'),
        rec('App.Layout.Header', 'hidden'),
      ]);
      expect(out).toEqual({ header: 'hidden' });
    });

    it('handles empty / non-array input', { tags: ['edge-case'] }, () => {
      expect(parseLayoutPreferences(null)).toEqual({});
      expect(parseLayoutPreferences(undefined)).toEqual({});
      expect(parseLayoutPreferences([])).toEqual({});
    });
  });
});
