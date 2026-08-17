/**
 * Decide whether DataTable should resolve AG-Grid's pending infinite-row
 * block INLINE, from the **warm-cache fast path** inside `datasource.getRows`.
 *
 * This fires on back-nav remount when React Query already has cached data on
 * the very first render. AG-Grid's first `getRows` arrives *after* the
 * deps-driven resolution effect has already executed once (with `pendingRef`
 * still null at that moment), so the effect won't re-run on the subsequent
 * setParams round-trip because none of its deps actually change. Resolving
 * inline breaks that deadlock.
 *
 * NOTE: this helper is used ONLY by the first-getRows inline path. The
 * cold-cache / search / sort / page resolution happens in the effect, which
 * gates on `pendingRef` + `isLoading` instead of data-reference novelty — a
 * `data === lastResolved` reference guard there wrongly blocked resolving a
 * repeated search whose cached data is reference-equal to the prior resolve,
 * leaving rows stuck as `—` placeholders.
 *
 * The reference comparison below is meaningful only for the warm-cache case:
 * on the very first getRows it distinguishes genuinely-new cached data from
 * something already handed to AG-Grid.
 *
 * @param data         Current `rowData` (the saved-query list result).
 * @param isLoading    Either the list or the count fetch in flight.
 * @param lastResolved Reference of the data we most recently handed to
 *                     AG-Grid's `successCallback`. Stored in a ref so
 *                     we don't re-resolve the same array twice (would
 *                     cause AG-Grid to thrash its block cache).
 */
export function shouldResolveBlockInline(
  data: unknown,
  isLoading: boolean | undefined,
  lastResolved: unknown,
): boolean {
  if (data == null) return false;
  if (isLoading) return false;
  if (data === lastResolved) return false;
  return true;
}
