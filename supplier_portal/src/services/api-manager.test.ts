import { describe, it, expect } from 'vitest';
import { isLoginPath } from './api-manager';

describe('api-manager', { tags: ['auth', 'logic'] }, () => {
  // The guard that stops handleAuthFailure() from hard-redirecting to /login
  // when the user is ALREADY there — the redirect is a full page reload, so an
  // unauthenticated 401 (stale cookie token, pre-login authenticated call)
  // would otherwise reload-loop the login screen and clear in-progress
  // sign-in state on every pass.
  describe('isLoginPath', { tags: ['important'] }, () => {
    it('matches the login route and its subpaths', () => {
      expect(isLoginPath('/login')).toBe(true);
      expect(isLoginPath('/login/')).toBe(true);
      expect(isLoginPath('/login/sso-callback')).toBe(true);
    });

    it('does not match private routes', () => {
      expect(isLoginPath('/')).toBe(false);
      expect(isLoginPath('/dashboard')).toBe(false);
      expect(isLoginPath('/logout')).toBe(false);
    });

    it('does not match lookalike prefixes', { tags: ['edge-case'] }, () => {
      expect(isLoginPath('/login-help')).toBe(false);
      expect(isLoginPath('/loginx')).toBe(false);
      expect(isLoginPath('')).toBe(false);
    });
  });
});
