import { describe, it, expect } from 'vitest';
import {
  isNavVariable,
  toNavVariable,
  normalizeScreen,
  buildRelatedApps,
  renderRelatedScreensCatalog,
  renderRelatedScreensGenerated,
  type RawScreen,
} from './related-screens-codegen';

function screen(over: Partial<RawScreen> = {}): RawScreen {
  return {
    app_definition_key: 'app_a',
    app_definition: 'AppA__V0_0_1',
    name: 'accounts',
    label: 'Accounts',
    description: 'Accounts list',
    component_type: 'screen',
    ...over,
  };
}

describe('related-screens-codegen', { tags: ['cross-app', 'logic'] }, () => {
  describe('isNavVariable', { tags: ['important'] }, () => {
    it('accepts only nav.* names', () => {
      expect(isNavVariable({ name: 'nav.accountId' })).toBe(true);
      expect(isNavVariable({ name: 'response.kpiValue' })).toBe(false);
      expect(isNavVariable({ name: 'page.tab' })).toBe(false);
    });
    it('rejects nullish / missing name', { tags: ['edge-case'] }, () => {
      expect(isNavVariable(null)).toBe(false);
      expect(isNavVariable(undefined)).toBe(false);
      expect(isNavVariable({})).toBe(false);
    });
  });

  describe('toNavVariable', { tags: ['logic'] }, () => {
    it('strips the nav. prefix and fills defaults', () => {
      const v = toNavVariable({ name: 'nav.accountId', label: 'Account', type: 'string' });
      expect(v.param).toBe('accountId');
      expect(v.fullName).toBe('nav.accountId');
      expect(v.label).toBe('Account');
      expect(v.type).toBe('string');
      expect(v.isArray).toBe(false);
    });
    it('marks required when no meaningful default', { tags: ['edge-case'] }, () => {
      expect(toNavVariable({ name: 'nav.id' }).required).toBe(true);
      expect(toNavVariable({ name: 'nav.id', default_value: {} }).required).toBe(true);
      expect(toNavVariable({ name: 'nav.id', default_value: '' }).required).toBe(true);
    });
    it('marks optional when a real default exists', () => {
      expect(toNavVariable({ name: 'nav.id', default_value: 'x' }).required).toBe(false);
      expect(toNavVariable({ name: 'nav.id', default_value: { text: '[]' } }).required).toBe(false);
    });
    it('carries is_array', () => {
      expect(toNavVariable({ name: 'nav.ids', is_array: true }).isArray).toBe(true);
    });
  });

  describe('normalizeScreen', { tags: ['important'] }, () => {
    it('returns null without app key or name', { tags: ['edge-case'] }, () => {
      expect(normalizeScreen(null)).toBeNull();
      expect(normalizeScreen(screen({ app_definition_key: '' }))).toBeNull();
      expect(normalizeScreen(screen({ name: '' }))).toBeNull();
    });
    it('keeps only nav.* variables', () => {
      const s = normalizeScreen(
        screen({
          variables: [
            { name: 'nav.accountId', type: 'string' },
            { name: 'response.kpi', type: 'string' },
            { name: 'page.tab' },
          ],
        }),
      );
      expect(s?.navVariables.map((v) => v.param)).toEqual(['accountId']);
    });
    it('dedupes repeated nav vars by param', { tags: ['edge-case'] }, () => {
      const s = normalizeScreen(
        screen({ variables: [{ name: 'nav.id' }, { name: 'nav.id' }] }),
      );
      expect(s?.navVariables.map((v) => v.param)).toEqual(['id']);
    });
    it('is sidebar-eligible only with no required nav vars', () => {
      expect(normalizeScreen(screen({ variables: [] }))?.sidebarEligible).toBe(true);
      expect(
        normalizeScreen(screen({ variables: [{ name: 'nav.id' }] }))?.sidebarEligible,
      ).toBe(false);
      expect(
        normalizeScreen(
          screen({ variables: [{ name: 'nav.id', default_value: 'x' }] }),
        )?.sidebarEligible,
      ).toBe(true);
    });
  });

  describe('buildRelatedApps', { tags: ['important'] }, () => {
    const rows = [
      screen({ app_definition_key: 'app_a', name: 'accounts' }),
      screen({ app_definition_key: 'app_a', name: 'account-detail', variables: [{ name: 'nav.id' }] }),
      screen({ app_definition_key: 'app_b', name: 'home' }),
      screen({ app_definition_key: 'current', name: 'self' }),
    ];

    it('excludes the current app', () => {
      const apps = buildRelatedApps(rows, [], 'current');
      expect(apps.map((a) => a.appKey)).toEqual(['app_a', 'app_b']);
    });
    it('filters to relatedAppKeys when provided', () => {
      const apps = buildRelatedApps(rows, ['app_b'], 'current');
      expect(apps.map((a) => a.appKey)).toEqual(['app_b']);
    });
    it('keeps all non-current apps when relatedAppKeys empty', () => {
      const apps = buildRelatedApps(rows, [], '');
      expect(apps.map((a) => a.appKey)).toEqual(['app_a', 'app_b', 'current']);
    });
    it('sorts apps + screens and dedupes screens', { tags: ['edge-case'] }, () => {
      const dup = [
        screen({ app_definition_key: 'z', name: 'b' }),
        screen({ app_definition_key: 'z', name: 'a' }),
        screen({ app_definition_key: 'z', name: 'a' }),
      ];
      const apps = buildRelatedApps(dup, [], '');
      expect(apps[0].screens.map((s) => s.name)).toEqual(['a', 'b']);
    });
  });

  describe('renderers', { tags: ['smoke'] }, () => {
    const apps = buildRelatedApps(
      [
        screen({ app_definition_key: 'app_a', name: 'accounts' }),
        screen({ app_definition_key: 'app_a', name: 'account-detail', variables: [{ name: 'nav.id', type: 'string' }] }),
      ],
      [],
      '',
    );

    it('catalog markdown lists screens + sidebar eligibility', () => {
      const md = renderRelatedScreensCatalog(apps);
      expect(md).toContain('Related application screens');
      expect(md).toContain('`accounts`');
      expect(md).toContain('`account-detail`');
      expect(md).toContain('id*:string'); // required nav var marked with *
    });
    it('catalog handles empty input', { tags: ['edge-case'] }, () => {
      expect(renderRelatedScreensCatalog([])).toContain('No related-application screens');
    });
    it('generated registry includes RELATED_APPS + lookup', () => {
      const ts = renderRelatedScreensGenerated(apps);
      expect(ts).toContain('export const RELATED_APPS');
      expect(ts).toContain('RELATED_SCREENS_BY_KEY');
      expect(ts).toContain('"accounts"');
    });
  });
});
