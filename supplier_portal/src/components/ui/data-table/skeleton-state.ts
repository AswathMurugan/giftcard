/*
 * Pure helpers for the DataTable initial-load skeleton.
 *
 * Mirrors the renderer's behaviour (libs/composite/table table-grid.tsx):
 * the full skeleton replacement renders ONLY on the very first load, before
 * AG Grid has ever mounted. Once mounted, AG Grid stays alive and its own
 * loading overlay covers subsequent fetches — unmounting it would destroy
 * custom headers / filter popovers / cell state.
 */

/** Inputs that decide whether the first-load skeleton should render. */
export interface InitialSkeletonInput {
  /** The consumer's query loading flag (e.g. useSavedQueryTable's isLoading). */
  isLoading: boolean;
  /** True once AG Grid has mounted at least once (onGridReady fired). */
  hasMounted: boolean;
  /** A required-inputs "Provide: …" message takes precedence when present. */
  gatedMessage?: string;
  /** Whether any rows are already available to show. */
  hasRows: boolean;
}

/**
 * Show the full shimmer skeleton only on the INITIAL load: we're loading,
 * the grid has never mounted, nothing is gated, and there are no rows yet.
 * After the grid mounts once this returns false forever (the caller flips
 * `hasMounted` true), so refetches defer to AG Grid's built-in overlay.
 */
export function shouldShowInitialSkeleton({
  isLoading,
  hasMounted,
  gatedMessage,
  hasRows,
}: InitialSkeletonInput): boolean {
  if (gatedMessage) return false;
  if (hasMounted) return false;
  if (hasRows) return false;
  return isLoading;
}

/** Max skeleton rows — never render a huge placeholder for a big page size. */
export const MAX_SKELETON_ROWS = 8;
/** Fallback column count when the table has no columns defined yet. */
export const DEFAULT_SKELETON_COLS = 4;

export interface SkeletonShape {
  rows: number;
  cols: number;
}

/**
 * Derive the placeholder grid dimensions. Rows track the page size but are
 * clamped to [1, MAX_SKELETON_ROWS]; cols track the column count with a
 * sensible fallback and a floor of 1.
 */
export function computeSkeletonShape(
  colCount: number,
  pageSize: number,
): SkeletonShape {
  const safeCols =
    Number.isFinite(colCount) && colCount > 0
      ? Math.floor(colCount)
      : DEFAULT_SKELETON_COLS;

  const rawRows =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 1;
  const rows = Math.min(MAX_SKELETON_ROWS, Math.max(1, rawRows));

  return { rows, cols: Math.max(1, safeCols) };
}
