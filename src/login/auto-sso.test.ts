import { describe, it, expect } from 'vitest';
import { resolveAutoSsoTarget } from './auto-sso';
import type { SsoProvider } from '@/services/auth-service';

const okta: SsoProvider = { provider_name: 'Okta', provider_type: 'SAML' };
const google: SsoProvider = { provider_name: 'Google', provider_type: 'Google' };
const defaultAzure: SsoProvider = {
  provider_name: 'AzureAD',
  provider_type: 'AzureAD',
  is_default: true,
};

describe('resolveAutoSsoTarget', { tags: ['login', 'sso', 'logic'] }, () => {
  describe('callback detection', { tags: ['important'] }, () => {
    it('returns callback for ?code=', () => {
      expect(resolveAutoSsoTarget('?code=abc', [])).toEqual({ kind: 'callback' });
    });

    it('returns callback for ?error=', () => {
      expect(resolveAutoSsoTarget('?error=access_denied', [okta])).toEqual({
        kind: 'callback',
      });
    });

    it('callback takes precedence over a default provider', { tags: ['edge-case'] }, () => {
      expect(resolveAutoSsoTarget('?code=x', [defaultAzure])).toEqual({
        kind: 'callback',
      });
    });
  });

  describe('idp param routing', { tags: ['smoke'] }, () => {
    it('?idp=none forces the form even with a default provider', () => {
      expect(resolveAutoSsoTarget('?idp=none', [defaultAzure])).toEqual({
        kind: 'form',
      });
    });

    it('?idp=none is case-insensitive', { tags: ['edge-case'] }, () => {
      expect(resolveAutoSsoTarget('?idp=NONE', [defaultAzure])).toEqual({
        kind: 'form',
      });
    });

    it('?idp=<name> redirects to a matching provider (case-insensitive)', () => {
      expect(resolveAutoSsoTarget('?idp=okta', [okta, google])).toEqual({
        kind: 'redirect',
        provider: okta,
      });
    });

    it('?idp=<name> with no match → unknown', { tags: ['edge-case'] }, () => {
      expect(resolveAutoSsoTarget('?idp=ping', [okta])).toEqual({
        kind: 'unknown',
        idp: 'ping',
      });
    });
  });

  describe('default-provider auto-redirect', { tags: ['logic'] }, () => {
    it('redirects to the default provider when no params', () => {
      expect(resolveAutoSsoTarget('', [okta, defaultAzure])).toEqual({
        kind: 'redirect',
        provider: defaultAzure,
      });
    });

    it('falls back to the form when no default and no params', () => {
      expect(resolveAutoSsoTarget('', [okta, google])).toEqual({ kind: 'form' });
    });

    it('returns form for empty providers + empty search', { tags: ['edge-case'] }, () => {
      expect(resolveAutoSsoTarget('', [])).toEqual({ kind: 'form' });
    });
  });
});
