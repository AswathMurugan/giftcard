import { describe, it, expect } from 'vitest';
import {
  normalizeCookieHost,
  isCookieDomainSettable,
  deriveCookieDomainFromHostname,
  resolveCookieDomain,
  resolveCookieRemovalDomains,
} from './auth-cookie-domain';

const PROD_HOST = 'jiffywealth.us.prod.phoenix.jiffy.ai';
const PROD_COOKIE_HOST = 'us.prod.phoenix.jiffy.ai';

describe('auth-cookie-domain', { tags: ['auth', 'logic'] }, () => {
  describe('normalizeCookieHost', { tags: ['edge-case'] }, () => {
    it('trims, lowercases, and strips a leading dot', () => {
      expect(normalizeCookieHost(' .US.Prod.Phoenix.Jiffy.ai ')).toBe(
        'us.prod.phoenix.jiffy.ai',
      );
      expect(normalizeCookieHost('us.prod.phoenix.jiffy.ai')).toBe(
        'us.prod.phoenix.jiffy.ai',
      );
    });

    it('rejects non-strings and empty values', () => {
      expect(normalizeCookieHost(undefined)).toBeNull();
      expect(normalizeCookieHost(null)).toBeNull();
      expect(normalizeCookieHost(42)).toBeNull();
      expect(normalizeCookieHost('')).toBeNull();
      expect(normalizeCookieHost('   ')).toBeNull();
      expect(normalizeCookieHost('.')).toBeNull();
    });
  });

  describe('isCookieDomainSettable', { tags: ['important'] }, () => {
    it('accepts the exact host and any parent domain', () => {
      expect(isCookieDomainSettable(PROD_HOST, PROD_HOST)).toBe(true);
      expect(isCookieDomainSettable(PROD_HOST, PROD_COOKIE_HOST)).toBe(true);
      expect(isCookieDomainSettable(PROD_HOST, 'jiffy.ai')).toBe(true);
      expect(isCookieDomainSettable(PROD_HOST, '.jiffy.ai')).toBe(true);
    });

    it('rejects a cookie_host from a different environment', () => {
      // A sandbox cookie_host must never be used on a prod host — the browser
      // would drop the cookie and login would silently break.
      expect(
        isCookieDomainSettable(PROD_HOST, 'us.sandbox.phoenix.jiffy.ai'),
      ).toBe(false);
      // Suffix match must be segment-aligned, not substring.
      expect(isCookieDomainSettable('evil-jiffy.ai', 'jiffy.ai')).toBe(false);
      expect(isCookieDomainSettable(PROD_HOST, '')).toBe(false);
      expect(isCookieDomainSettable(PROD_HOST, '.')).toBe(false);
    });
  });

  describe('deriveCookieDomainFromHostname', () => {
    it('keeps the legacy derivations', () => {
      expect(deriveCookieDomainFromHostname(PROD_HOST)).toBe('.jiffy.ai');
      expect(deriveCookieDomainFromHostname('app.local.jiffy.ai')).toBe(
        '.local.jiffy.ai',
      );
      expect(deriveCookieDomainFromHostname('localhost')).toBe('');
      expect(deriveCookieDomainFromHostname('127.0.0.1')).toBe('');
      expect(deriveCookieDomainFromHostname('tenant.localhost')).toBe('');
      expect(deriveCookieDomainFromHostname('example.com')).toBe('');
    });
  });

  describe('resolveCookieDomain', { tags: ['important'] }, () => {
    it('prefers a valid server cookie_host (PHX-3328)', () => {
      expect(resolveCookieDomain(PROD_HOST, PROD_COOKIE_HOST)).toBe(
        PROD_COOKIE_HOST,
      );
    });

    it('falls back to the legacy domain when cookie_host is absent or invalid', () => {
      expect(resolveCookieDomain(PROD_HOST, null)).toBe('.jiffy.ai');
      expect(
        resolveCookieDomain(PROD_HOST, 'us.sandbox.phoenix.jiffy.ai'),
      ).toBe('.jiffy.ai');
      expect(resolveCookieDomain('localhost', PROD_COOKIE_HOST)).toBe('');
    });
  });

  describe('resolveCookieRemovalDomains', { tags: ['important', 'smoke'] }, () => {
    it('targets BOTH the active cookie_host and the legacy domain (PHXSR-228)', () => {
      // The core of the logout bug: the platform writes tokens on cookie_host,
      // older sessions wrote on .jiffy.ai — a delete must expire both.
      expect(resolveCookieRemovalDomains(PROD_HOST, PROD_COOKIE_HOST)).toEqual([
        PROD_COOKIE_HOST,
        '.jiffy.ai',
      ]);
    });

    it('dedupes when active and legacy coincide', () => {
      expect(resolveCookieRemovalDomains(PROD_HOST, null)).toEqual([
        '.jiffy.ai',
      ]);
      expect(resolveCookieRemovalDomains('app.local.jiffy.ai', null)).toEqual([
        '.local.jiffy.ai',
      ]);
    });

    it('returns no domains on plain localhost (host-only cookies)', () => {
      expect(resolveCookieRemovalDomains('localhost', null)).toEqual([]);
      expect(resolveCookieRemovalDomains('localhost', PROD_COOKIE_HOST)).toEqual(
        [],
      );
    });
  });
});
