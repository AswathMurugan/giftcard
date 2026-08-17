import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __testing } from './applications';

const { cacheKeyFor, readSessionCache, writeSessionCache, CACHE_TTL_MS } = __testing;

/** Minimal in-memory sessionStorage — the vitest env is `node`, so there is none. */
function installSessionStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  vi.stubGlobal('sessionStorage', mock);
  return store;
}

const APP = [
  { name: 'advisorworkstation', app_definition_key: 'aw_123', application_url: 'https://aw.prod' },
];

describe('applications cache', { tags: ['config', 'logic'] }, () => {
  beforeEach(() => {
    installSessionStorage();
  });

  describe('cacheKeyFor', { tags: ['important'] }, () => {
    // application_url is environment-specific. Sharing a key across
    // environments would hand prod a develop URL — the PHX-5724 failure mode,
    // relocated into the cache.
    it('separates environments', () => {
      expect(cacheKeyFor('acme', 'prod')).not.toBe(cacheKeyFor('acme', 'develop'));
    });

    it('separates tenants', () => {
      expect(cacheKeyFor('acme', 'prod')).not.toBe(cacheKeyFor('globex', 'prod'));
    });
  });

  describe('round-trip', { tags: ['important'] }, () => {
    it('reads back what it wrote for the same tenant+env', () => {
      writeSessionCache('acme', 'prod', APP);
      expect(readSessionCache('acme', 'prod')).toEqual(APP);
    });

    it('does NOT leak across environments', { tags: ['important', 'edge-case'] }, () => {
      writeSessionCache('acme', 'develop', APP);
      expect(readSessionCache('acme', 'prod')).toBeNull();
    });

    it('does NOT leak across tenants', { tags: ['edge-case'] }, () => {
      writeSessionCache('acme', 'prod', APP);
      expect(readSessionCache('globex', 'prod')).toBeNull();
    });
  });

  describe('expiry + corruption', { tags: ['edge-case'] }, () => {
    it('treats an entry older than the TTL as a miss', () => {
      vi.useFakeTimers();
      try {
        writeSessionCache('acme', 'prod', APP);
        vi.advanceTimersByTime(CACHE_TTL_MS + 1);
        expect(readSessionCache('acme', 'prod')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns null on a malformed entry rather than throwing', () => {
      sessionStorage.setItem(cacheKeyFor('acme', 'prod'), '{not json');
      expect(readSessionCache('acme', 'prod')).toBeNull();
    });

    it('returns null when the payload is the wrong shape', () => {
      sessionStorage.setItem(
        cacheKeyFor('acme', 'prod'),
        JSON.stringify({ applications: 'nope', _cachedAt: Date.now() }),
      );
      expect(readSessionCache('acme', 'prod')).toBeNull();
    });

    it('survives sessionStorage being unavailable', () => {
      vi.stubGlobal('sessionStorage', {
        getItem: () => {
          throw new Error('disabled');
        },
        setItem: () => {
          throw new Error('disabled');
        },
        removeItem: () => {
          throw new Error('disabled');
        },
      });
      expect(() => writeSessionCache('acme', 'prod', APP)).not.toThrow();
      expect(readSessionCache('acme', 'prod')).toBeNull();
    });
  });
});
