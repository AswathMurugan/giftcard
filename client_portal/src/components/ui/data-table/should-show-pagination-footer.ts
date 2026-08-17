/**
 * Decide whether DataTable should render its custom pagination footer.
 *
 * Two conditions must both hold:
 *
 *   1. Pagination is enabled for this table (`hidePagination` is not set and
 *      the caller didn't pass `pagination={false}` to AG-Grid).
 *   2. There is at least one record to page through.
 *
 * The record check is deliberately `totalRows > 0` rather than
 * "a count is known". A count companion query can legitimately resolve to
 * `0` for an empty table; in that case `count != null` is `true` but there
 * is nothing to paginate, and a footer reading "0 of 0" is noise. Gating on
 * the synced `totalRows` hides the footer whenever the table has no rows —
 * whether the emptiness comes from a `0` count or an empty grid — and shows
 * it again as soon as rows arrive (`syncPagination` keeps `totalRows` in
 * step with both the count companion and AG-Grid's own row count).
 *
 * @param showPagination Whether pagination is enabled for the table.
 * @param totalRows      The synced total row count from `PaginationState`.
 */
export function shouldShowPaginationFooter(
  showPagination: boolean,
  totalRows: number,
): boolean {
  return showPagination && totalRows > 0;
}
