import { describe, it, expect } from 'vitest';
import { resolveAppEnv } from './api-config';
import { LOCAL_DEV_CONFIG } from './local-dev';

describe('api-config', { tags: ['config', 'logic'] }, () => {
  describe('resolveAppEnv', { tags: ['important'] }, () => {
    it('uses the environment the server assigned', () => {
      expect(resolveAppEnv('prod')).toBe('prod');
      expect(resolveAppEnv('staging')).toBe('staging');
      expect(resolveAppEnv('sandbox')).toBe('sandbox');
    });

    // PHX-5724. app-manager marks `env` omitempty, so a host it cannot classify
    // returns NO env field. The old code fell back to a hardcoded 'develop',
    // which made a published app assert `X-Jiffy-Env: develop` and read
    // DEVELOPMENT data from a higher environment — silently, with real data and
    // no error. The fallback must come from config, never a literal.
    it(
      'never falls back to a hardcoded environment when the server omits env',
      { tags: ['important', 'edge-case'] },
      () => {
        for (const missing of [undefined, null, '']) {
          expect(resolveAppEnv(missing)).toBe(LOCAL_DEV_CONFIG.env);
        }
      },
    );

    it(
      'keeps the fallback consistent with the host LOCAL_DEV_DERIVED builds',
      { tags: ['important'] },
      () => {
        // Both must read the same value, or local dev would authenticate
        // against one environment and query another.
        expect(resolveAppEnv(undefined)).toBe(LOCAL_DEV_CONFIG.env);
      },
    );

    it('does not treat a server value as missing just because it is unusual', { tags: ['edge-case'] }, () => {
      // Environments are tenant-created rows in app-manager, not a fixed enum —
      // any non-empty string the server sends must be forwarded verbatim.
      expect(resolveAppEnv('qa')).toBe('qa');
      expect(resolveAppEnv('uat2')).toBe('uat2');
    });
  });
});
