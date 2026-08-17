import { describe, it, expect } from 'vitest';
import { sandboxBlocksDownloads, DOWNLOAD_FAILED_MESSAGE } from './download-guard';

describe('download-guard', { tags: ['doc-viewer', 'logic'] }, () => {
  describe('sandboxBlocksDownloads', { tags: ['important'] }, () => {
    it('blocks when sandbox omits allow-downloads', () => {
      expect(sandboxBlocksDownloads("sandbox allow-scripts allow-same-origin")).toBe(true);
    });

    it('allows when allow-downloads is present', () => {
      expect(sandboxBlocksDownloads("sandbox allow-scripts allow-downloads")).toBe(false);
    });

    it('allows when there is no sandbox directive', () => {
      expect(sandboxBlocksDownloads("default-src 'self'; frame-ancestors *")).toBe(false);
    });

    it('never blocks on an unreadable CSP', { tags: ['edge-case'] }, () => {
      expect(sandboxBlocksDownloads(null)).toBe(false);
      expect(sandboxBlocksDownloads(undefined)).toBe(false);
      expect(sandboxBlocksDownloads('')).toBe(false);
    });

    it('blocks if ANY comma-separated policy sandboxes without allow-downloads', { tags: ['edge-case'] }, () => {
      expect(sandboxBlocksDownloads("default-src 'self', sandbox allow-scripts")).toBe(true);
    });
  });

  it('exposes a non-empty failure message', () => {
    expect(DOWNLOAD_FAILED_MESSAGE.length).toBeGreaterThan(0);
  });
});
