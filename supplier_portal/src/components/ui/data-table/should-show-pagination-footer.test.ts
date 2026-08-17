import { describe, it, expect } from 'vitest';
import { shouldShowPaginationFooter } from './should-show-pagination-footer';

describe(
  'shouldShowPaginationFooter',
  { tags: ['data-table', 'logic'] },
  () => {
    describe('hidden when no records', { tags: ['important'] }, () => {
      it('hides the footer for an empty table (0 rows)', { tags: ['edge-case'] }, () => {
        expect(shouldShowPaginationFooter(true, 0)).toBe(false);
      });

      it('hides the footer when a count companion resolved to 0', () => {
        // count == 0 used to keep the footer visible via `count != null`;
        // gating on totalRows fixes that.
        expect(shouldShowPaginationFooter(true, 0)).toBe(false);
      });
    });

    describe('shown when records exist', { tags: ['smoke'] }, () => {
      it('shows the footer for a single record', { tags: ['edge-case'] }, () => {
        expect(shouldShowPaginationFooter(true, 1)).toBe(true);
      });

      it('shows the footer for many records', () => {
        expect(shouldShowPaginationFooter(true, 250)).toBe(true);
      });
    });

    describe('respects the pagination toggle', { tags: ['important'] }, () => {
      it('stays hidden when pagination is disabled, even with rows', () => {
        expect(shouldShowPaginationFooter(false, 250)).toBe(false);
      });

      it('stays hidden when pagination is disabled and empty', () => {
        expect(shouldShowPaginationFooter(false, 0)).toBe(false);
      });
    });
  },
);
