import { describe, it, expect } from 'vitest';
import {
  buildCrossAppUrl,
  findRelatedApp,
  resolveCrossAppTarget,
  deriveAppBaseUrl,
  type RelatedApplicationConfig,
} from './cross-app-nav';

const APPS: RelatedApplicationConfig[] = [
  {
    application_name: 'workstation',
    app_definition_key: 'workstation_abc',
    application_url: 'https://aiwithdata.jiffy.ai/workstation',
  },
  {
    application_name: 'servicing',
    app_definition_key: 'servicing_xyz',
    // no application_url → not yet resolvable
  },
];

describe('cross-app-nav', { tags: ['cross-app', 'logic'] }, () => {
  describe('buildCrossAppUrl', { tags: ['important'] }, () => {
    it('joins base + screen without double slashes', () => {
      expect(buildCrossAppUrl('https://x.ai/app/', '/accounts')).toBe(
        'https://x.ai/app/accounts',
      );
      expect(buildCrossAppUrl('https://x.ai/app', 'accounts')).toBe(
        'https://x.ai/app/accounts',
      );
    });

    it('appends nav vars as query params', () => {
      expect(
        buildCrossAppUrl('https://x.ai/app', 'account-detail', { accountId: '123' }),
      ).toBe('https://x.ai/app/account-detail?accountId=123');
    });

    it('skips null/undefined/empty values', { tags: ['edge-case'] }, () => {
      expect(
        buildCrossAppUrl('https://x.ai/app', 's', {
          a: '1',
          b: null,
          c: undefined,
          d: '',
        }),
      ).toBe('https://x.ai/app/s?a=1');
    });

    it('repeats array values', () => {
      expect(
        buildCrossAppUrl('https://x.ai/app', 's', { id: ['a', 'b'] }),
      ).toBe('https://x.ai/app/s?id=a&id=b');
    });

    it('stringifies numbers/booleans', { tags: ['edge-case'] }, () => {
      expect(
        buildCrossAppUrl('https://x.ai/app', 's', { n: 42, ok: true }),
      ).toBe('https://x.ai/app/s?n=42&ok=true');
    });

    it('handles empty screen (links to app root)', { tags: ['edge-case'] }, () => {
      expect(buildCrossAppUrl('https://x.ai/app/', '')).toBe('https://x.ai/app');
    });
  });

  describe('findRelatedApp', { tags: ['smoke'] }, () => {
    it('finds by app_definition_key', () => {
      expect(findRelatedApp(APPS, 'workstation_abc')?.application_name).toBe(
        'workstation',
      );
    });
    it('returns undefined for unknown key', { tags: ['edge-case'] }, () => {
      expect(findRelatedApp(APPS, 'nope')).toBeUndefined();
    });
  });

  describe('resolveCrossAppTarget', { tags: ['important'] }, () => {
    it('resolves a full URL when app + application_url exist', () => {
      const r = resolveCrossAppTarget(APPS, 'workstation_abc', 'accounts', {
        view: 'all',
      });
      expect(r.url).toBe(
        'https://aiwithdata.jiffy.ai/workstation/accounts?view=all',
      );
      expect(r.reason).toBeUndefined();
    });

    it('reports app-not-related for an unknown app', { tags: ['edge-case'] }, () => {
      const r = resolveCrossAppTarget(APPS, 'ghost', 'x');
      expect(r.url).toBeNull();
      expect(r.reason).toBe('app-not-related');
    });

    it('reports no-application-url when missing AND no fallback', { tags: ['edge-case'] }, () => {
      const r = resolveCrossAppTarget(APPS, 'servicing_xyz', 'cases');
      expect(r.url).toBeNull();
      expect(r.reason).toBe('no-application-url');
    });

    it('falls back to a derived host when application_url is absent', () => {
      const r = resolveCrossAppTarget(APPS, 'servicing_xyz', 'cases', {}, {
        tenant: 'aiwithdata',
        env: 'sandbox',
      });
      expect(r.url).toBe(
        'https://servicing-aiwithdata.us.sandbox.phoenix.jiffy.ai/cases',
      );
    });

    it('prefers application_url over the fallback', () => {
      const r = resolveCrossAppTarget(APPS, 'workstation_abc', 'accounts', {}, {
        tenant: 'aiwithdata',
        env: 'sandbox',
      });
      expect(r.url).toBe('https://aiwithdata.jiffy.ai/workstation/accounts');
    });
  });

  describe('deriveAppBaseUrl', { tags: ['logic'] }, () => {
    it('builds the Phoenix host pattern', () => {
      expect(
        deriveAppBaseUrl(
          { application_name: 'AdvisorWorkstation', app_definition_key: 'x' },
          'aiwithdata',
          'sandbox',
        ),
      ).toBe('https://advisorworkstation-aiwithdata.us.sandbox.phoenix.jiffy.ai');
    });
    it('returns null without name/tenant/env', { tags: ['edge-case'] }, () => {
      expect(deriveAppBaseUrl({ application_name: '', app_definition_key: 'x' }, 't', 'e')).toBeNull();
      expect(deriveAppBaseUrl({ application_name: 'a', app_definition_key: 'x' }, '', 'e')).toBeNull();
    });
  });
});
