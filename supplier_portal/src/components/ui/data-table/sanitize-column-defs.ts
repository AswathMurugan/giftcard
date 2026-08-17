/**
 * Strip filter + sort affordances from `columnDefs` whose identity
 * AG-Grid would otherwise have to auto-generate.
 *
 * **Why this exists.** When a column declaration has neither `field`
 * nor `colId`, AG-Grid assigns a colId based on the column's index in
 * the array — first column gets `"0"`, second `"1"`, etc. AG-Grid's
 * `filterModel` and `sortModel` are then keyed by those auto-numeric
 * colIds. The saved-query CEL builder uses those keys as backend field
 * names directly, producing wire payloads like:
 *
 *   `_filter=ilike(0, '%foo%')`     (numeric literal, matches nothing)
 *   `_sort=0`                       (not a real backend field)
 *
 * Neither targets a real column on the data-manager side, so the
 * filter/sort silently returns the wrong rows.
 *
 * The CEL builders in `useSavedQueryTable.ts` already reject those
 * keys as a last line of defence, but a column whose funnel + sort
 * affordances visibly do nothing is a UX bug. This sanitiser removes
 * the affordances upstream so the user never sees the funnel icon for
 * a column we can't filter.
 *
 * **Compatibility.**
 *   - Columns with a usable `field` or `colId` are returned unchanged.
 *   - Column groups (`children: [...]`) are returned unchanged; group
 *     identity is irrelevant to filter/sort.
 *   - Columns that already declare `filter: false` AND `sortable: false`
 *     are returned unchanged (already opted out — no need to clone).
 *   - The sanitiser does NOT recurse into column groups' children. If a
 *     tenant ships nested groups with identity-less children, those
 *     children would still hit the CEL builder's safety net.
 *
 * Pure function, no DOM access, so it can be tested in the starter's
 * node vitest environment.
 */
export interface SanitizeColumnDefsOptions {
  /**
   * Called once for each column whose identity was missing and got
   * neutered. Receives the column's `headerName` (or `undefined` when
   * none was declared) so the caller can surface a console warning
   * pointing the author at the offending column.
   */
  onSuppress?: (headerName: string | undefined) => void;
}

/**
 * Strip filter + sort affordances from `columnDefs` whose identity
 * AG-Grid would otherwise have to auto-generate.
 *
 * Returns `undefined` when the input is `undefined` or `null` (AG-Grid
 * accepts both). Returns a new array; original column-def objects are
 * not mutated (a shallow clone is made when a column needs neutering).
 */
export function sanitizeColumnDefs<T>(
  columnDefs: readonly T[] | null | undefined,
  options: SanitizeColumnDefsOptions = {},
): T[] | undefined {
  if (!columnDefs) return undefined;
  return columnDefs.map((c) => sanitizeOne(c, options));
}

function sanitizeOne<T>(
  col: T,
  options: SanitizeColumnDefsOptions,
): T {
  if (!col || typeof col !== 'object') return col;
  const def = col as Record<string, unknown>;

  // Column group — pass through. AG-Grid uses the group as a header
  // container; filter/sort happens on children, not on the group.
  if ('children' in def && Array.isArray(def.children)) {
    return col;
  }

  const hasField =
    typeof def.field === 'string' && (def.field as string).length > 0;
  const hasColId =
    typeof def.colId === 'string' && (def.colId as string).length > 0;
  if (hasField || hasColId) return col;

  // Already opted out — no clone needed.
  if (def.filter === false && def.sortable === false) return col;

  options.onSuppress?.(
    typeof def.headerName === 'string' ? def.headerName : undefined,
  );

  return { ...def, filter: false, sortable: false } as T;
}
