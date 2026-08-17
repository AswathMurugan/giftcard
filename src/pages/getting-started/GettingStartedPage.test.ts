import { describe, it, expect } from 'vitest';
import { APPLICATION } from '@/types/app.generated';
import {
  PROMPT_EXAMPLES,
  PROMPTING_TIPS,
  QUICK_LINKS,
  appDescription,
  appName,
} from './GettingStartedPage';

describe('GettingStartedPage', { tags: ['getting-started', 'logic'] }, () => {
  describe('content arrays', { tags: ['smoke'] }, () => {
    it('ships at least one prompt example, all non-empty', () => {
      expect(PROMPT_EXAMPLES.length).toBeGreaterThan(0);
      for (const p of PROMPT_EXAMPLES) {
        expect(p.trim().length).toBeGreaterThan(0);
      }
    });

    it('ships prompting tips with both a do and an instead', () => {
      expect(PROMPTING_TIPS.length).toBeGreaterThan(0);
      for (const tip of PROMPTING_TIPS) {
        expect(tip.do.trim().length).toBeGreaterThan(0);
        expect(tip.instead.trim().length).toBeGreaterThan(0);
      }
    });

    it('quick links point at the known helper routes with metadata', () => {
      const paths = QUICK_LINKS.map((l) => l.path);
      expect(paths).toEqual(['/showcase', '/test-results', '/logs']);
      for (const link of QUICK_LINKS) {
        expect(link.label.trim().length).toBeGreaterThan(0);
        expect(link.description.trim().length).toBeGreaterThan(0);
        expect(link.icon).toBeTruthy();
      }
    });

    it('has no duplicate quick-link paths', { tags: ['edge-case'] }, () => {
      const paths = QUICK_LINKS.map((l) => l.path);
      expect(new Set(paths).size).toBe(paths.length);
    });
  });

  describe('appName', { tags: ['important'] }, () => {
    it('uses the application label when present, else the starter default', () => {
      // app.generated.ts is regenerated per tenant: APPLICATION may be null
      // (cold checkout) or populated. Assert the fallback chain holds either way
      // rather than hard-coding an environment-specific string.
      const expected = APPLICATION?.label || APPLICATION?.name || 'Codegen Starter';
      expect(appName()).toBe(expected);
    });

    it('returns a non-empty string', { tags: ['edge-case'] }, () => {
      expect(appName().length).toBeGreaterThan(0);
    });
  });

  describe('appDescription', { tags: ['important'] }, () => {
    it('prefers the application metadata description when set', () => {
      // Mirror the source's preference: real APPLICATION.description wins,
      // otherwise the generic fallback that embeds the app name.
      const meta = APPLICATION?.description?.trim();
      const result = appDescription('My App');
      if (meta) {
        expect(result).toBe(meta);
      } else {
        // Fallback uses the passed name and never hardcodes another app's name.
        expect(result).toContain('My App');
        expect(result).not.toContain('FinPlan Babu Test');
      }
    });

    it('never returns an empty string', { tags: ['edge-case'] }, () => {
      expect(appDescription(appName()).trim().length).toBeGreaterThan(0);
    });
  });
});
