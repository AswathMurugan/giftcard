import { describe, it, expect } from 'vitest';
import {
  navItemClasses,
  navIconClasses,
  toggleGlyph,
  isNavItemVisible,
  resolveRailColors,
} from './DefaultLayout';
import { getScreenResourceKey } from '@/constants/pages';

const NO_OVERRIDE = {
  sidebarColor: null,
  sidebarTextColor: null,
  sidebarActiveColor: null,
};

describe('DefaultLayout sidebar nav', { tags: ['layout', 'logic'] }, () => {
  describe('navItemClasses', { tags: ['important'] }, () => {
    it('uses 15px text (DS side-nav item size) and the configurable inactive ink var', () => {
      const inactive = navItemClasses(false, false);
      const active = navItemClasses(true, false);
      expect(inactive).toContain('text-[0.9375rem]');
      expect(active).toContain('text-[0.9375rem]');
      expect(inactive).toContain('text-[var(--rail-text)]');
    });

    it('is semibold + the active-colour var only when active', () => {
      expect(navItemClasses(true, false)).toContain('font-semibold');
      expect(navItemClasses(true, false)).toContain('text-[var(--rail-active)]');
      expect(navItemClasses(false, false)).not.toContain('font-semibold');
    });

    it('applies the gold-tinted active fill only when active', () => {
      // Selected state uses a translucent wash of the rail's active gold
      // (DS active = primary-50 gold tint), not the neutral hover overlay.
      // Assert on the 15% ACTIVE fill specifically: hover/focus also use
      // color-mix (a 10% wash) so that the rail stays legible on a light
      // background, so a bare "no color-mix" check would be a false negative.
      expect(navItemClasses(true, false)).toContain(
        'bg-[color-mix(in_srgb,var(--rail-active)_15%,transparent)]',
      );
      expect(navItemClasses(false, false)).not.toContain(
        'bg-[color-mix(in_srgb,var(--rail-active)_15%,transparent)]',
      );
    });

    it('derives hover/focus from the rail vars, never a hardcoded white', () => {
      // A light rail (Forge's is white) would render `hover:text-white` as
      // white-on-white — invisible. Hover must follow --rail-active instead.
      const inactive = navItemClasses(false, false);
      expect(inactive).not.toContain('hover:text-white');
      expect(inactive).toContain('hover:text-[var(--rail-active)]');
    });

    it('uses an 8px (rounded-lg) item radius per the DS side-nav spec', () => {
      expect(navItemClasses(false, false)).toContain('rounded-lg');
      expect(navItemClasses(false, false)).not.toContain('rounded-md');
    });

    it('centers and drops horizontal padding when collapsed', { tags: ['edge-case'] }, () => {
      const collapsed = navItemClasses(false, true);
      expect(collapsed).toContain('justify-center');
      expect(collapsed).toContain('px-0');
      expect(navItemClasses(false, false)).not.toContain('justify-center');
    });
  });

  describe('navIconClasses', { tags: ['important'] }, () => {
    it('renders the Nucleo glyph at 20px in both states (not an SVG box)', () => {
      expect(navIconClasses(true)).toContain('text-[1.25rem]');
      expect(navIconClasses(false)).toContain('text-[1.25rem]');
      // No longer a lucide SVG sizing class.
      expect(navIconClasses(false)).not.toContain('h-5 w-5');
    });

    it('uses the active-colour var when active, text var when inactive', () => {
      expect(navIconClasses(true)).toContain('text-[var(--rail-active)]');
      expect(navIconClasses(false)).toContain('text-[var(--rail-text)]');
      expect(navIconClasses(false)).not.toContain('text-[var(--rail-active)]');
    });
  });

  describe('toggleGlyph', { tags: ['smoke'] }, () => {
    it('shows the collapse glyph when expanded, expand glyph when collapsed', () => {
      expect(toggleGlyph(false)).toBe('icon_-Tb_layout_sidebar_left_collapse');
      expect(toggleGlyph(true)).toBe('icon_-Tb_layout_sidebar_left_expand');
    });
  });

  describe('resolveRailColors', { tags: ['sidebar', 'important'] }, () => {
    it('uses the built-in dark palette when not inverted and no override', () => {
      expect(resolveRailColors(NO_OVERRIDE, false)).toEqual({
        bg: '#1C1B20',
        text: '#C9CACD',
        active: '#BCA04F',
        // Unset → the active label reuses the accent (all-gold dark rail).
        activeInk: '#BCA04F',
      });
    });

    it('paints from the brand ramp when the tenant theme inverts (PHX-5283)', () => {
      expect(resolveRailColors(NO_OVERRIDE, true)).toEqual({
        bg: 'var(--color-primary-500)',
        text: 'var(--color-grayscale-100)',
        active: 'var(--color-secondary-500)',
        activeInk: 'var(--color-secondary-500)',
      });
    });

    it('an explicit App.Layout override wins over both palettes', { tags: ['edge-case'] }, () => {
      const overridden = {
        sidebarColor: '#123456',
        sidebarTextColor: '#abcdef',
        sidebarActiveColor: '#0f0f0f',
      };
      expect(resolveRailColors(overridden, true)).toEqual({
        bg: '#123456',
        text: '#abcdef',
        active: '#0f0f0f',
        activeInk: '#0f0f0f',
      });
    });

    it('lets a light rail set an ink label distinct from the gold accent', () => {
      // Forge's rail: gold icon + near-black label on the gold-50 pill.
      const light = {
        sidebarColor: '#FFFFFF',
        sidebarTextColor: '#2B2F36',
        sidebarActiveColor: '#9E7B19',
        sidebarActiveInkColor: '#1C1C1C',
      };
      expect(resolveRailColors(light, false)).toEqual({
        bg: '#FFFFFF',
        text: '#2B2F36',
        active: '#9E7B19',
        activeInk: '#1C1C1C',
      });
    });

    it('mixes an explicit bg override with inverted defaults for the rest', { tags: ['edge-case'] }, () => {
      expect(
        resolveRailColors({ ...NO_OVERRIDE, sidebarColor: '#123456' }, true),
      ).toEqual({
        bg: '#123456',
        text: 'var(--color-grayscale-100)',
        active: 'var(--color-secondary-500)',
        activeInk: 'var(--color-secondary-500)',
      });
    });
  });

  describe('isNavItemVisible', { tags: ['permissions', 'important'] }, () => {
    it('always shows an ungated item', () => {
      expect(isNavItemVisible(undefined, null, false)).toBe(true);
      expect(isNavItemVisible(undefined, {}, false)).toBe(true);
    });

    it('fails open while permissions load (gated, no cached map)', { tags: ['edge-case'] }, () => {
      expect(isNavItemVisible('ClientListPage', null, true)).toBe(true);
    });

    it('shows a gated item the user is allowed to access', () => {
      const key = getScreenResourceKey('ClientListPage');
      expect(isNavItemVisible('ClientListPage', { [key]: ['read'] }, false)).toBe(true);
    });

    it('hides a gated item the user cannot access', () => {
      expect(isNavItemVisible('ClientListPage', {}, false)).toBe(false);
      const otherKey = getScreenResourceKey('OtherPage');
      expect(
        isNavItemVisible('ClientListPage', { [otherKey]: ['read'] }, false),
      ).toBe(false);
    });
  });
});
