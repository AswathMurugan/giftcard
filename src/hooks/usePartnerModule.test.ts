import { describe, it, expect } from 'vitest';
import {
  buildPartnerCategoryMethodUrl,
  buildPartnerModuleBody,
  buildPartnerModuleUrl,
} from '@/lib/partner-modules-codegen';

/**
 * The React Query plumbing inside `usePartnerModule` /
 * `usePartnerCategoryMethod` is exercised live in the preview iframe.
 * Here we lock down the pure URL + body builders that the hooks
 * compose with so the wire contract can't regress silently.
 */
describe(
  'usePartnerModule wire contract',
  { tags: ['partner-module', 'logic'] },
  () => {
    describe('direct proxy URL', { tags: ['important'] }, () => {
      it('matches the canonical example URL', () => {
        // From the user's example: api/proxy/addausertoagroup/default.
        expect(buildPartnerModuleUrl('addausertoagroup')).toBe(
          '/api/proxy/addausertoagroup/default',
        );
      });

      it('honours an explicit variant override', () => {
        expect(
          buildPartnerModuleUrl('addausertoagroup', 'sandbox'),
        ).toBe('/api/proxy/addausertoagroup/sandbox');
      });
    });

    describe('category-routed URL', { tags: ['important'] }, () => {
      it('matches the canonical category-method example URL', () => {
        // From the user's example:
        // api/proxy/execute-partner-category/portfolio-management/getPerformanceSummary
        expect(
          buildPartnerCategoryMethodUrl(
            'portfolio-management',
            'getPerformanceSummary',
          ),
        ).toBe(
          '/api/proxy/execute-partner-category/portfolio-management/getPerformanceSummary',
        );
      });
    });

    describe('body envelope', { tags: ['important', 'logic'] }, () => {
      it(
        'wraps inputs under `inputs` key — never `body`',
        { tags: ['important'] },
        () => {
          const input = { account_id: 'A', partnerModuleName: 'B' };
          const body = buildPartnerModuleBody(input);
          expect(body).toEqual({
            inputs: { account_id: 'A', partnerModuleName: 'B' },
          });
          // Explicit guard against the earlier draft that wrapped in `body`.
          expect((body as Record<string, unknown>).body).toBeUndefined();
        },
      );

      it('preserves the input reference inside the envelope', () => {
        const input = { a: 1 };
        const body = buildPartnerModuleBody(input);
        expect(body.inputs).toBe(input);
      });

      it('handles null/undefined/non-object input as { inputs: {} }', { tags: ['edge-case'] }, () => {
        expect(buildPartnerModuleBody(null)).toEqual({ inputs: {} });
        expect(buildPartnerModuleBody(undefined)).toEqual({ inputs: {} });
        expect(buildPartnerModuleBody(42)).toEqual({ inputs: {} });
        expect(buildPartnerModuleBody([1, 2])).toEqual({ inputs: {} });
      });
    });
  },
);
