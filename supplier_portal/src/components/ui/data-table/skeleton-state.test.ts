import { describe, it, expect } from 'vitest';
import {
  shouldShowInitialSkeleton,
  computeSkeletonShape,
  MAX_SKELETON_ROWS,
  DEFAULT_SKELETON_COLS,
} from './skeleton-state';

describe('DataTable skeleton-state', { tags: ['data-table', 'logic'] }, () => {
  describe('shouldShowInitialSkeleton', { tags: ['important'] }, () => {
    const base = {
      isLoading: true,
      hasMounted: false,
      gatedMessage: undefined,
      hasRows: false,
    };

    it('shows on the initial load (loading, unmounted, no rows, ungated)', { tags: ['smoke'] }, () => {
      expect(shouldShowInitialSkeleton(base)).toBe(true);
    });

    it('hides once the grid has mounted, even while loading', { tags: ['important'] }, () => {
      expect(shouldShowInitialSkeleton({ ...base, hasMounted: true })).toBe(false);
    });

    it('hides when not loading', () => {
      expect(shouldShowInitialSkeleton({ ...base, isLoading: false })).toBe(false);
    });

    it('hides when rows are already present', { tags: ['edge-case'] }, () => {
      expect(shouldShowInitialSkeleton({ ...base, hasRows: true })).toBe(false);
    });

    it('gated message takes precedence over the skeleton', { tags: ['edge-case'] }, () => {
      expect(
        shouldShowInitialSkeleton({ ...base, gatedMessage: 'Provide: tenant' }),
      ).toBe(false);
    });

    it('stays hidden after mount regardless of other flags', () => {
      expect(
        shouldShowInitialSkeleton({
          isLoading: true,
          hasMounted: true,
          gatedMessage: undefined,
          hasRows: false,
        }),
      ).toBe(false);
    });
  });

  describe('computeSkeletonShape', { tags: ['logic'] }, () => {
    it('tracks column count and page size within bounds', { tags: ['smoke'] }, () => {
      expect(computeSkeletonShape(5, 3)).toEqual({ rows: 3, cols: 5 });
    });

    it('clamps rows to MAX_SKELETON_ROWS', { tags: ['edge-case'] }, () => {
      expect(computeSkeletonShape(4, 100)).toEqual({
        rows: MAX_SKELETON_ROWS,
        cols: 4,
      });
    });

    it('falls back to default cols when colCount is 0 or invalid', { tags: ['edge-case'] }, () => {
      expect(computeSkeletonShape(0, 5).cols).toBe(DEFAULT_SKELETON_COLS);
      expect(computeSkeletonShape(Number.NaN, 5).cols).toBe(DEFAULT_SKELETON_COLS);
      expect(computeSkeletonShape(-3, 5).cols).toBe(DEFAULT_SKELETON_COLS);
    });

    it('floors at least one row when page size is 0 or invalid', { tags: ['edge-case'] }, () => {
      expect(computeSkeletonShape(4, 0).rows).toBe(1);
      expect(computeSkeletonShape(4, Number.NaN).rows).toBe(1);
      expect(computeSkeletonShape(4, -10).rows).toBe(1);
    });

    it('floors fractional inputs', () => {
      expect(computeSkeletonShape(5.9, 3.9)).toEqual({ rows: 3, cols: 5 });
    });
  });
});
