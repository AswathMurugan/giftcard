import { describe, it, expect } from 'vitest';
import { fetchAllPreferencePages, mergePreferences, type Preference } from './use-preferences';

const pref = (partial: Partial<Preference> & { name: string }): Preference => ({
  id: partial.name,
  app_definition_key: '',
  app_definition: '',
  value: '',
  category: 'branding',
  org: null,
  user: null,
  disabled: false,
  draft: false,
  is_secret: false,
  ...partial,
});

describe('use-preferences', { tags: ['preferences', 'branding', 'logic'] }, () => {
  describe('fetchAllPreferencePages', { tags: ['important'] }, () => {
    it('collects later pages so preferences beyond the default limit remain visible', async () => {
      const calls: Array<[number, number]> = [];
      const pages = [
        [pref({ name: 'first' }), pref({ name: 'second' })],
        [pref({ name: 'App.Screen.service-requests.sr_requests', type: 'table_preference' })],
      ];
      const result = await fetchAllPreferencePages(async (offset, limit) => {
        calls.push([offset, limit]);
        return pages.shift() ?? [];
      }, 2);

      expect(calls).toEqual([[0, 2], [2, 2]]);
      expect(result.map((preference) => preference.name)).toContain(
        'App.Screen.service-requests.sr_requests',
      );
    });

    it('fails instead of looping when an endpoint ignores offset', async () => {
      const repeated = [pref({ name: 'first' }), pref({ name: 'second' })];
      await expect(fetchAllPreferencePages(async () => repeated, 2)).rejects.toThrow(
        'ignored offset pagination',
      );
    });
  });

  describe('mergePreferences (PHX-5283)', { tags: ['important'] }, () => {
    it('appends the platform Tenant.* prefs AFTER the app prefs (last-match wins)', () => {
      const app = [pref({ name: 'App.Theme', value: '{}' })];
      const tenant = [pref({ name: 'Tenant.Theme', value: '{"themes":[]}' })];
      const merged = mergePreferences(app, tenant);
      expect(merged.map((p) => p.name)).toEqual(['App.Theme', 'Tenant.Theme']);
      // Tenant.Theme is the LAST record, so extractBranding's last-match picks it.
      expect(merged[merged.length - 1].name).toBe('Tenant.Theme');
    });

    it('returns the app prefs unchanged when there are no tenant prefs', { tags: ['edge-case'] }, () => {
      const app = [pref({ name: 'App.Theme' })];
      const merged = mergePreferences(app, []);
      expect(merged).toBe(app);
    });

    it('returns the tenant prefs when the app list is empty', { tags: ['edge-case'] }, () => {
      const tenant = [pref({ name: 'Tenant.Theme' })];
      expect(mergePreferences([], tenant)).toEqual(tenant);
    });
  });
});
