import { describe, it, expect } from 'vitest';
import {
  clampScale,
  clampPage,
  clampToolbarOffset,
  isPdfFile,
  pageWidthFor,
  pickCurrentPage,
  ZOOM_MIN,
  ZOOM_MAX,
  type PageRect,
} from './pdf-viewer-utils';

/** Rect helper: page of `height` starting at `top`. */
function rect(top: number, height: number): PageRect {
  return { top, bottom: top + height, height };
}

describe('pdf-viewer-utils', { tags: ['signatures', 'doc-viewer', 'logic'] }, () => {
  describe('clampScale', { tags: ['important', 'edge-case'] }, () => {
    it('clamps into [MIN, MAX] and rounds to 2 decimals', () => {
      expect(clampScale(1)).toBe(1);
      expect(clampScale(0.1)).toBe(ZOOM_MIN);
      expect(clampScale(9)).toBe(ZOOM_MAX);
      expect(clampScale(1.2349)).toBe(1.23);
    });
    it('falls back to 1 for non-finite input', () => {
      expect(clampScale(Number.NaN)).toBe(1);
      expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
      expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(1);
    });
  });

  describe('clampPage', { tags: ['edge-case'] }, () => {
    it('clamps into [1, numPages] and rounds', () => {
      expect(clampPage(0, 5)).toBe(1);
      expect(clampPage(3, 5)).toBe(3);
      expect(clampPage(99, 5)).toBe(5);
      expect(clampPage(2.6, 5)).toBe(3);
    });
    it('returns 1 when there are no pages', () => {
      expect(clampPage(3, 0)).toBe(1);
    });
  });

  describe('isPdfFile', { tags: ['important', 'edge-case'] }, () => {
    it('detects via mimeType (case-insensitive)', () => {
      expect(isPdfFile({ mimeType: 'application/pdf' })).toBe(true);
      expect(isPdfFile({ mimeType: 'APPLICATION/PDF' })).toBe(true);
    });
    it('detects via .pdf path, ignoring query/fragment', () => {
      expect(isPdfFile({ url: 'https://x/y/doc.PDF' })).toBe(true);
      expect(isPdfFile({ url: 'https://x/y/doc.pdf?token=1#p2' })).toBe(true);
      expect(isPdfFile({ url: 'https://x/y/image.png' })).toBe(false);
    });
    it('is false for blob URLs with no extension and for null/undefined', () => {
      expect(isPdfFile({ url: 'blob:https://x/abc-123' })).toBe(false);
      expect(isPdfFile({})).toBe(false);
      expect(isPdfFile(null)).toBe(false);
      expect(isPdfFile(undefined)).toBe(false);
    });
  });

  describe('pickCurrentPage', { tags: ['important', 'logic'] }, () => {
    // Container: top 0, bottom 600 → probe at 200 (top-third).
    it('picks the page whose top is nearest the top-third probe', () => {
      const pages: Array<[number, PageRect]> = [
        [1, rect(-700, 800)],
        [2, rect(150, 800)], // top 150 → nearest to probe 200
        [3, rect(990, 800)],
      ];
      expect(pickCurrentPage(700, 0, 600, pages)).toBe(2);
    });

    it('returns page 1 at the top of the scroll container, regardless of rects', () => {
      // The "opens showing 7 / 9" bug: on open scrollTop is 0 but the page
      // wrappers are placeholder-sized, so probing them picks an arbitrary
      // page. At the top the current page is 1 by definition.
      const placeholders: Array<[number, PageRect]> = Array.from(
        { length: 9 },
        (_, i) => [i + 1, rect(i * 20, 16)],
      );
      expect(pickCurrentPage(0, 0, 600, placeholders)).toBe(1);
      expect(pickCurrentPage(1, 0, 600, placeholders)).toBe(1);
    });

    it('ignores pages that have not laid out (zero-height rects)', { tags: ['edge-case'] }, () => {
      const pages: Array<[number, PageRect]> = [
        [7, rect(190, 0)], // closest to probe but unlaid-out → skipped
        [1, rect(20, 800)],
      ];
      expect(pickCurrentPage(500, 0, 600, pages)).toBe(1);
    });

    it('ignores fully offscreen pages', { tags: ['edge-case'] }, () => {
      const pages: Array<[number, PageRect]> = [
        [1, rect(-900, 800)], // bottom above container top
        [2, rect(100, 800)],
        [3, rect(700, 800)], // top below container bottom
      ];
      expect(pickCurrentPage(900, 0, 600, pages)).toBe(2);
    });

    it('returns 0 (keep previous) when no page qualifies', { tags: ['edge-case'] }, () => {
      expect(pickCurrentPage(500, 0, 600, [])).toBe(0);
      expect(pickCurrentPage(500, 0, 600, [[1, rect(300, 0)]])).toBe(0);
    });
  });

  describe('pageWidthFor', { tags: ['logic', 'edge-case'] }, () => {
    it('scales the container width', () => {
      expect(pageWidthFor(800, 1)).toBe(800);
      expect(pageWidthFor(800, 1.5)).toBe(1200);
    });
    it('returns undefined before the container is measured', () => {
      expect(pageWidthFor(undefined, 1)).toBeUndefined();
      expect(pageWidthFor(0, 1)).toBeUndefined();
    });
  });

  describe('clampToolbarOffset', { tags: ['doc-viewer', 'logic'] }, () => {
    // A 200-wide bar centered in a 1000-wide / 600-tall pane, pinned 12px down.
    const base = {
      rootWidth: 1000,
      rootHeight: 600,
      barWidth: 200,
      barHeight: 40,
      baseLeft: (1000 - 200) / 2, // 400
      baseTop: 12,
    };

    it('passes a small in-bounds offset through unchanged', () => {
      expect(clampToolbarOffset(50, 30, base)).toEqual({ x: 50, y: 30 });
    });

    it('clamps to the right / bottom edges (minus margin)', { tags: ['edge-case'] }, () => {
      // maxX = 1000 - 200 - 8 - 400 = 392 ; maxY = 600 - 40 - 8 - 12 = 540
      expect(clampToolbarOffset(10_000, 10_000, base)).toEqual({ x: 392, y: 540 });
    });

    it('clamps to the left / top edges (minus margin)', { tags: ['edge-case'] }, () => {
      // minX = 8 - 400 = -392 ; minY = 8 - 12 = -4
      expect(clampToolbarOffset(-10_000, -10_000, base)).toEqual({ x: -392, y: -4 });
    });

    it('honours a custom margin', () => {
      const { x } = clampToolbarOffset(10_000, 0, { ...base, margin: 20 });
      expect(x).toBe(1000 - 200 - 20 - 400); // 380
    });

    it('pins to the min edge when the pane is narrower than the bar', { tags: ['edge-case'] }, () => {
      const tiny = { ...base, rootWidth: 100, baseLeft: (100 - 200) / 2 }; // baseLeft = -50
      // maxX (-50 + ...) < minX → pin to minX = 8 - (-50) = 58
      expect(clampToolbarOffset(0, 0, tiny).x).toBe(58);
    });
  });
});
