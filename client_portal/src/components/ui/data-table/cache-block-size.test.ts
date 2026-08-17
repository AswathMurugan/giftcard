import { describe, expect, it } from 'vitest';
import { resolveCacheBlockSize } from './cache-block-size';

describe('resolveCacheBlockSize', { tags: ['data-table', 'logic'] }, () => {
  it('omits the server-only option for client-side tables', { tags: ['important'] }, () => {
    expect(resolveCacheBlockSize(false, 100, 25)).toBeUndefined();
  });

  it('defaults to the page size for server-side tables', { tags: ['smoke'] }, () => {
    expect(resolveCacheBlockSize(true, undefined, 25)).toBe(25);
  });

  it('preserves a server-side caller override', { tags: ['edge-case'] }, () => {
    expect(resolveCacheBlockSize(true, 100, 25)).toBe(100);
  });
});
