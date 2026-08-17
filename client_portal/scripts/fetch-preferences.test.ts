import { describe, it, expect } from 'vitest';
import {
  refToId,
  selectBrandingPreferences,
  renderPreferencesTs,
  resolveFirstPaintTenantTheme,
  type GeneratedPreference,
} from './fetch-preferences';

const themeRec = (
  org: string | null,
  value = `{"themes":[],"org":"${org}"}`,
): GeneratedPreference => ({
  name: 'Tenant.Theme',
  value,
  category: 'branding',
  app_definition_key: 'platform',
  org,
});

describe('fetch-preferences', { tags: ['preferences', 'codegen', 'logic'] }, () => {
  describe('refToId', { tags: ['important'] }, () => {
    it('returns null for null/undefined', { tags: ['edge-case'] }, () => {
      expect(refToId(null)).toBeNull();
      expect(refToId(undefined)).toBeNull();
    });

    it('passes a bare id string through', { tags: ['smoke'] }, () => {
      expect(refToId('4939959e-d3f3-4c4b-ac6b-fd74f33af705')).toBe(
        '4939959e-d3f3-4c4b-ac6b-fd74f33af705',
      );
    });

    it(
      'flattens a { id } link object to its id (the TS2322 bug)',
      { tags: ['important', 'edge-case'] },
      () => {
        expect(refToId({ id: '4939959e-d3f3-4c4b-ac6b-fd74f33af705' })).toBe(
          '4939959e-d3f3-4c4b-ac6b-fd74f33af705',
        );
      },
    );

    it('returns null for an object without a string id', { tags: ['edge-case'] }, () => {
      expect(refToId({})).toBeNull();
      expect(refToId({ id: 123 })).toBeNull();
      expect(refToId(42)).toBeNull();
    });
  });

  describe('selectBrandingPreferences', { tags: ['important'] }, () => {
    const records = [
      {
        name: 'Tenant.Favicon',
        value: 'PUBLIC_ASSETS/x/favicon.png',
        category: 'Branding',
        app_definition_key: 'platform',
        org: { id: '4939959e-d3f3-4c4b-ac6b-fd74f33af705' },
        user: null,
        disabled: false,
      },
      {
        name: 'App.Logo',
        value: 'PUBLIC_ASSETS/x/logo.png',
        category: 'branding',
        app_definition_key: 'servicing_abc',
        org: '11111111-2222-3333-4444-555555555555',
        user: null,
      },
      // Filtered out: wrong category.
      { name: 'App.Other', value: 'x', category: 'general', app_definition_key: 'servicing_abc' },
      // Filtered out: different app + not Tenant.*
      { name: 'App.Logo', value: 'y', category: 'branding', app_definition_key: 'other_app' },
    ];

    it('normalizes org/user link objects to id strings', () => {
      const out = selectBrandingPreferences(records, 'servicing_abc');
      expect(out).toHaveLength(2);
      // Tenant.* kept regardless of app; org object → id string.
      expect(out[0].org).toBe('4939959e-d3f3-4c4b-ac6b-fd74f33af705');
      expect(out[0].user).toBeNull();
      // App.* for the current app; bare-string org passes through.
      expect(out[1].org).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('returns [] for non-array input', { tags: ['edge-case'] }, () => {
      expect(selectBrandingPreferences(null, 'x')).toEqual([]);
      expect(selectBrandingPreferences(undefined, null)).toEqual([]);
    });
  });

  describe('resolveFirstPaintTenantTheme (PHX-5283)', { tags: ['important', 'branding'] }, () => {
    const favicon: GeneratedPreference = {
      name: 'Tenant.Favicon',
      value: 'PUBLIC_ASSETS/x/favicon.png',
      category: 'branding',
      app_definition_key: 'platform',
      org: 'org-1',
    };

    it('leaves records untouched when there is 0 or 1 Tenant.Theme', () => {
      const one = [favicon, themeRec('org-1')];
      expect(resolveFirstPaintTenantTheme(one)).toEqual(one);
      const none = [favicon];
      expect(resolveFirstPaintTenantTheme(none)).toEqual(none);
    });

    it('keeps ONLY the tenant-wide (org == null) theme when several orgs have one', () => {
      const wide = themeRec(null);
      const out = resolveFirstPaintTenantTheme([
        favicon,
        themeRec('org-1'),
        wide,
        themeRec('org-2'),
      ]);
      const themes = out.filter((r) => r.name === 'Tenant.Theme');
      expect(themes).toEqual([wide]);
      // Non-theme branding is preserved.
      expect(out).toContainEqual(favicon);
    });

    it('drops ALL Tenant.Theme when only org-scoped ones exist (org unknown at bake)', () => {
      const out = resolveFirstPaintTenantTheme([
        favicon,
        themeRec('org-1'),
        themeRec('org-2'),
      ]);
      expect(out.some((r) => r.name === 'Tenant.Theme')).toBe(false);
      expect(out).toEqual([favicon]);
    });
  });

  describe('renderPreferencesTs', { tags: ['smoke'] }, () => {
    it('emits org/user as string|null so the baked data typechecks', () => {
      const ts = renderPreferencesTs([
        {
          name: 'Tenant.Favicon',
          value: 'x',
          category: 'branding',
          app_definition_key: 'platform',
          org: '4939959e-d3f3-4c4b-ac6b-fd74f33af705',
          user: null,
          disabled: false,
        },
      ]);
      expect(ts).toContain('org?: string | null;');
      // No raw link object survives into the baked literal.
      expect(ts).not.toContain('"org": {');
      expect(ts).toContain('"org": "4939959e-d3f3-4c4b-ac6b-fd74f33af705"');
    });
  });
});
