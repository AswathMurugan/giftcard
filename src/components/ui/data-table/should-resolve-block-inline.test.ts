import { describe, it, expect } from 'vitest';
import { shouldResolveBlockInline } from './should-resolve-block-inline';

describe(
  'shouldResolveBlockInline',
  { tags: ['data-table', 'logic'] },
  () => {
    describe('positive cases', { tags: ['important'] }, () => {
      it(
        'resolves on warm-cache mount (data ready, never resolved before)',
        () => {
          // This is the back-nav remount scenario the helper exists to
          // unstick: React Query has cached rowData on the very first
          // render, lastResolved ref is fresh (null), not loading.
          const arrayA = [{ id: 1 }, { id: 2 }];
          expect(shouldResolveBlockInline(arrayA, false, null)).toBe(true);
        },
      );

      it(
        'resolves when refetch produces a different array reference',
        () => {
          const arrayA = [{ id: 1 }];
          const arrayB = [{ id: 2 }];
          expect(shouldResolveBlockInline(arrayB, false, arrayA)).toBe(true);
        },
      );

      it(
        'resolves an empty result set (legitimately zero rows)',
        { tags: ['edge-case'] },
        () => {
          // An empty page after filter/search should still resolve the
          // pending block so AG-Grid renders the "no rows" overlay
          // instead of placeholders indefinitely.
          expect(shouldResolveBlockInline([], false, null)).toBe(true);
        },
      );
    });

    describe('skip cases', { tags: ['important'] }, () => {
      it('skips when data is null (still loading initial fetch)', () => {
        expect(shouldResolveBlockInline(null, false, null)).toBe(false);
      });

      it(
        'skips when data is undefined',
        { tags: ['edge-case'] },
        () => {
          expect(shouldResolveBlockInline(undefined, false, null)).toBe(
            false,
          );
        },
      );

      it('skips while isLoading is true (in-flight fetch)', () => {
        // Even if rowData defaults to [] from useSavedQueryList while
        // the fetch is in flight, we must not resolve — would briefly
        // paint "no rows" before the real data arrives.
        const arrayA = [{ id: 1 }];
        expect(shouldResolveBlockInline(arrayA, true, null)).toBe(false);
        expect(shouldResolveBlockInline([], true, null)).toBe(false);
      });

      it(
        'skips when data is the same reference we already resolved',
        () => {
          // Guards against double-resolution: the inline fast path and
          // the resolution effect can both fire for the same data on
          // a single mount; the second caller must no-op.
          const arrayA = [{ id: 1 }];
          expect(shouldResolveBlockInline(arrayA, false, arrayA)).toBe(false);
        },
      );

      it(
        'skips empty array that we already resolved',
        { tags: ['edge-case'] },
        () => {
          const empty: unknown[] = [];
          expect(shouldResolveBlockInline(empty, false, empty)).toBe(false);
        },
      );
    });

    describe('reference vs value semantics', { tags: ['logic'] }, () => {
      it(
        'distinguishes references, not deep equality (intentional)',
        { tags: ['important'] },
        () => {
          // React Query produces a new array reference on each fetch
          // even when contents are identical — that IS the "fresh
          // data" signal we want to react to. Deep-equal arrays must
          // therefore be treated as different.
          const a = [{ id: 1 }];
          const b = [{ id: 1 }];
          expect(shouldResolveBlockInline(b, false, a)).toBe(true);
        },
      );
    });
  },
);
