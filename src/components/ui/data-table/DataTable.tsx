import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { AgGridReactProps } from 'ag-grid-react';
// ag-grid module + license registration (side-effect). Colocated here — NOT in
// main.tsx — so ag-grid (community + enterprise) only enters the bundle when a
// page renders a <DataTable>, keeping it off the app-boot path. This module
// side-effect runs before any <AgGridReact> below mounts. See PHX-4455.
import './register-ag-grid';
import type {
  ColDef,
  ColumnMenuTab,
  FilterModel,
  GridApi,
  GridReadyEvent,
  IDatasource,
  IGetRowsParams,
  PaginationChangedEvent,
  SideBarDef,
  SortModelItem,
} from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import {
  ChevronDownIcon,
  CircleChevronLeftIcon,
  CircleChevronRightIcon,
  Columns3Icon,
  SearchIcon,
  XIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import { RowActionsCell } from './RowActionsCell';
import type { RowActionsSource } from './normalize-row-actions';
import { sanitizeColumnDefs } from './sanitize-column-defs';
import { shouldResolveBlockInline } from './should-resolve-block-inline';
import { shouldShowPaginationFooter } from './should-show-pagination-footer';
import {
  shouldShowInitialSkeleton,
  computeSkeletonShape,
} from './skeleton-state';
import { resolveCacheBlockSize } from './cache-block-size';

import './DataTable.css';

/**
 * Payload emitted whenever AG Grid needs a different slice of rows in
 * server-side mode — i.e. on initial load, page change, sort change, or
 * filter change.
 *
 * The consumer is expected to re-run its data query with these params and
 * update the `rowData` / `count` props on the DataTable.
 */
export interface ServerParams {
  /** 0-based page index. */
  page: number;
  pageSize: number;
  sortModel: SortModelItem[];
  filterModel: FilterModel | null;
  /**
   * Optional global search string from the DataTable's top-toolbar search
   * input. Populated only when the toolbar's search is visible AND has a
   * non-empty value; otherwise `undefined`.
   *
   * The DataTable does NOT translate this into a `filterModel` entry —
   * the consumer decides how to turn it into a server-side query (e.g.
   * for `useSavedQueryTable` callers, convert into a
   * `stringContainsIgnoreCase(<column>, <value>)` CEL string and pass via
   * `useSavedQueryList`'s `filter` option).
   */
  search?: string;
}

export interface DataTableProps<TData = any>
  extends Omit<AgGridReactProps<TData>, 'rowModelType' | 'datasource' | 'rowData'> {
  /** Extra classes on the grid container div. */
  className?: string;
  /** Stable test selector applied to the outer table container. */
  'data-testid'?: string;
  /** Hide the custom pagination bar. */
  hidePagination?: boolean;
  /**
   * Rows to display.
   *
   * - Server-side mode (`onParamsChange` provided): the rows for the
   *   **current page** only. Will be handed to AG Grid as the block that
   *   resolves the most recent `onParamsChange` request.
   * - Client-side mode (no `onParamsChange`): the **full** dataset; AG
   *   Grid handles pagination internally.
   */
  rowData?: TData[] | null;
  /**
   * Total row count across all pages. In server-side mode this drives both
   * the footer and AG Grid's last-row index (`api.setRowCount`). Leave
   * undefined while loading.
   */
  count?: number;
  /**
   * Server-side mode only. When true, DataTable holds AG Grid's pending
   * block request open instead of resolving it with whatever `rowData`
   * happens to be at that moment. Set this to your query's `isLoading`
   * so the grid keeps its loading state until fresh rows actually arrive
   * (prevents resolving a block with a stale or previous page's data).
   */
  isLoading?: boolean;
  /**
   * Server-side data fetcher. Providing this prop flips DataTable into
   * server-side mode: DataTable wires up an internal AG Grid datasource,
   * calls `onParamsChange` whenever AG Grid needs a different slice
   * (page / sort / filter change), and resolves AG Grid when the consumer
   * pushes fresh `rowData` + `count` back through props.
   *
   * @example
   * const [rows, setRows] = useState<Account[]>([]);
   * const [total, setTotal] = useState<number>();
   *
   * const handleParams = useCallback(({ page, pageSize, sortModel, filterModel }: ServerParams) => {
   *   // build Phoenix DSL query from sortModel/filterModel, fetch, then:
   *   setRows(fetched); setTotal(count);
   * }, []);
   *
   * <DataTable rowData={rows} count={total} onParamsChange={handleParams} columnDefs={cols} />
   */
  onParamsChange?: (params: ServerParams) => void;
  /**
   * Optional table heading rendered in the toolbar's left slot at 18px / 600
   * (DS Heading 4, `.jf-dt__heading`). When omitted, the left slot stays
   * empty (reserved for future tabs / view switchers).
   */
  title?: string;
  /**
   * Custom content for the toolbar's LEFT slot — e.g. a saved-view switcher
   * (a pill/dropdown + "Save as New View"). Renders alongside `title`.
   *
   * Build views on top of AG Grid's own state API, all of which this
   * component forwards to `<AgGridReact>`:
   *   - capture the live `GridApi` via `onGridReady={(e) => …e.api}`,
   *   - persist a view with `api.getState()` (columns/order/width/pinned +
   *     sort + column filters + pagination),
   *   - restore one by passing it back through the `initialState` prop
   *     (re-mount the DataTable with a `key` to re-apply), and/or react to
   *     user edits via `onStateUpdated`.
   */
  toolbarLeft?: ReactNode;
  /**
   * Custom content for the toolbar's RIGHT slot — rendered after the built-in
   * search + columns controls (rightmost). Use for a status segmented toggle
   * (e.g. Open / Closed), a filter control, or a primary action button
   * (e.g. "+ Add New").
   */
  toolbarRight?: ReactNode;
  /**
   * Hide the entire top toolbar (search + columns button). When true, no
   * toolbar div is rendered above the grid. Defaults to false.
   */
  hideToolbar?: boolean;
  /**
   * Hide just the search input in the top toolbar. Defaults to false.
   */
  hideSearch?: boolean;
  /**
   * Placeholder text shown inside the expanded search input. Defaults to
   * `'Search…'`.
   */
  searchPlaceholder?: string;
  /**
   * Hide just the column-visibility toggle in the top toolbar. Defaults to
   * false. The toggle opens AG Grid's built-in `agColumnsToolPanel` side
   * panel — checkboxes + drag-handles + searchable column list.
   */
  hideColumnsToggle?: boolean;
  /**
   * Debounce (ms) before the search input fires `quickFilterText` /
   * `onParamsChange.search`. Defaults to 300ms.
   */
  searchDebounceMs?: number;
  /**
   * When `false`, the toolbar search button is hidden regardless of
   * `hideSearch`. Provided so `useSavedQueryTable` can opt out when the
   * saved query has no searchable column wired (catalog reported
   * `searchColumns: []`).
   */
  searchEnabled?: boolean;
  /**
   * When present, the grid body is hidden and replaced with this message
   * shown center-stage. Used by `useSavedQueryTable` to surface
   * "Provide: …" when required saved-query inputs are missing, so the
   * user sees what's missing instead of an empty/loading table.
   */
  gatedMessage?: string;
  /**
   * When present, the grid body is hidden and replaced with this error
   * message center-stage, and the pagination bar is suppressed. Used by
   * `useSavedQueryTable` when the LIST fetch fails — without it AG Grid would
   * render placeholder `—` rows for a phantom total returned by the (separate)
   * count companion. Takes precedence over the grid; `gatedMessage` (missing
   * inputs) takes precedence over this.
   */
  errorMessage?: string;
  /**
   * Height of the grid container. AG Grid's body measures this to decide
   * how many rows to render and to size its scroll viewport, so it is
   * applied internally as a DEFINITE `height` (the name is historical —
   * it behaves as a fixed height, not a CSS `min-height`). The page itself
   * scrolls; the grid renders at this height and scrolls its own rows when
   * the page has more than fit.
   *
   * A `number` is treated as pixels; a `string` is passed through as-is
   * (e.g. `'24rem'`, `'50vh'`). Defaults to `'32rem'` (≈ a 10-row page).
   * Set a larger value for a taller table — do NOT wrap the table in your
   * own fixed-height div.
   */
  minHeight?: number | string;
  /**
   * Opt-in per-row actions. When provided, DataTable appends a standardized,
   * pinned-right kebab (⋮) column whose menu lists these actions — identical
   * button size, alignment, and row height on every table (don't hand-roll an
   * actions `cellRenderer`). Omit the prop and no actions column renders
   * (default off).
   *
   * Pass either one static list applied to every row, or a function that
   * returns the list for a specific row (for per-row visibility / disabling).
   * Destructive actions (`variant: 'destructive'`) render the DS red menu
   * item; any confirm step (e.g. an AlertDialog before a delete) is owned by
   * the action's `onSelect`, not the table.
   *
   * @example
   * <DataTable
   *   rowData={rows}
   *   columnDefs={cols}
   *   rowActions={[
   *     { label: 'View', icon: 'icon_-Tb_eye', onSelect: (r) => open(r) },
   *     { label: 'Edit', icon: 'icon_-Tb_pencil', onSelect: (r) => edit(r) },
   *     { label: 'Delete', icon: 'icon_-Tb_trash', variant: 'destructive',
   *       onSelect: (r) => confirmDelete(r) },
   *   ]}
   * />
   */
  rowActions?: RowActionsSource<TData>;
  /** Width (px) of the appended actions column. Defaults to 56. */
  rowActionsWidth?: number;
}

/**
 * Project theme built on top of AG Grid's Quartz theme.
 */
// JiffyAI DS data-table (PHX-3941, data-table.html .jf-dt): gold header
// (primary-50 bg, ink text 16px/600), no zebra stripes (hover only), 46px
// rows, 16px body text in fg-1, gold table-wrap border (primary-200).
const appTheme = themeQuartz.withParams({
  backgroundColor: 'var(--background)',
  // Semantic tokens (not fixed ramp points) so text/border flip in dark mode.
  // `--color-grayscale-800/100/50` don't invert, which left dark-gray body
  // text on a near-black background in dark mode.
  foregroundColor: 'var(--foreground)',
  borderColor: 'var(--border)',
  wrapperBorder: true,
  headerRowBorder: { color: 'var(--color-primary-100)', width: 1 },
  // DS .jf-dt thead: Primary-50 fill. Pin to the ramp token directly (not the
  // tenant-overridable `--accent`) so the gold header is consistent.
  headerBackgroundColor: 'var(--color-primary-50)',
  // `--color-primary-50` flips in dark mode (cream → dark brown via the `.dark`
  // ramp override), so `--foreground` gives correct contrast in BOTH modes:
  // dark ink on the cream header (light), light ink on the dark header (dark).
  headerTextColor: 'var(--foreground)',
  headerFontSize: 16,
  // DS .jf-dt thead: 600. Body cells: 400 (DS .jf-dt tbody td). Both pinned
  // via CSS vars (with a literal fallback) instead of a bare number so a
  // tenant / page can override the weights without re-building the theme —
  // e.g. set `--jf-table-header-font-weight` / `--jf-table-cell-font-weight`
  // on `.ui-data-table`. `cellFontWeight` is set explicitly because AG Grid
  // leaves `--ag-cell-font-weight` empty otherwise (body weight would only
  // coincidentally inherit 400).
  headerFontWeight: 'var(--jf-table-header-font-weight, 600)',
  cellFontWeight: 'var(--jf-table-cell-font-weight, 400)',
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: 'var(--muted)',
  selectedRowBackgroundColor: 'var(--muted)',
  rangeSelectionBackgroundColor: 'var(--primary-50)',
  accentColor: 'var(--primary)',
  checkboxCheckedBackgroundColor: 'var(--primary)',
  inputFocusBorder: 'var(--ring)',
  fontFamily: 'var(--font-sans)',
  fontSize: '1rem',
  rowHeight: '2.875rem',
  headerHeight: '2.875rem',
  cellHorizontalPadding: '1rem',
  borderRadius: 'var(--radius)',
  wrapperBorderRadius: '0.625rem',
});

// ── Server-side request signature ────────────────────────────────────────────
//
// A stable string identifying one AG-Grid block request: the global search,
// the block range, and the sort/filter models. Two requests with the same
// signature ask for identical data, so if we already have settled rows for one
// we can resolve the other inline instead of orphaning it (AG Grid re-requests
// block 0 after `setRowCount`, producing a duplicate request while the deps of
// our resolution effect stay unchanged — that block would otherwise hang as
// `—` placeholders).
export function makeServerRequestSig(
  search: string | undefined,
  req: {
    startRow: number;
    endRow: number;
    sortModel?: SortModelItem[] | null;
    filterModel?: unknown;
  },
): string {
  return JSON.stringify({
    s: search ?? '',
    start: req.startRow,
    end: req.endRow,
    sort: req.sortModel ?? [],
    filter: req.filterModel ?? null,
  });
}

// ── Pagination state ────────────────────────────────────────────────────────

interface PaginationState {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalRows: number;
  rangeStart: number;
  rangeEnd: number;
}

const INITIAL_PAGINATION: PaginationState = {
  currentPage: 0,
  totalPages: 0,
  pageSize: 25,
  totalRows: 0,
  rangeStart: 0,
  rangeEnd: 0,
};

// ── Pagination bar ──────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

function PaginationBar({
  state,
  onPageChange,
  onPageSizeChange,
}: {
  state: PaginationState;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const { currentPage, totalPages, pageSize, totalRows, rangeStart, rangeEnd } =
    state;

  const isFirst = currentPage <= 0;
  const isLast = currentPage >= totalPages - 1;

  const handlePageSizeSelect = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onPageSizeChange(Number(e.target.value));
    },
    [onPageSizeChange],
  );

  return (
    <div className="flex items-center justify-between bg-background px-4 py-2 text-base text-muted-foreground">
      {/* Left — total count */}
      <div>
        Total: <span className="font-semibold text-foreground">{totalRows.toLocaleString()}</span> records
      </div>

      {/* Right — controls */}
      <div className="flex items-center gap-4">
        {/* Prev / page / next — DS .jf-dt__pager uses borderless circular
            chevron buttons (ti-circle-chevron-*), not bordered squares. */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
            className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <CircleChevronLeftIcon className="size-[1.375rem]" />
          </button>

          <span>Page</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Page number"
            className="h-7 w-10 rounded-md border border-input bg-transparent text-center text-base font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            value={currentPage + 1}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n) && n >= 1 && n <= totalPages) {
                onPageChange(n - 1);
              }
            }}
          />
          <span>of {totalPages.toLocaleString()}</span>

          <button
            type="button"
            disabled={isLast}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
            className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <CircleChevronRightIcon className="size-[1.375rem]" />
          </button>
        </div>

        {/* DS .jf-dt__sep — 1px vertical divider between footer groups. */}
        <span aria-hidden="true" className="h-[1.375rem] w-px bg-border" />

        {/* Page size */}
        <div className="flex items-center gap-2.5">
          <span>Rows per page</span>
          {/* `appearance-none` strips the native arrow, so render our own
              chevron and pad the select's right edge to make room for it
              (DS .jf-dt__perpage-select uses a ti-chevron-down). */}
          <div className="relative">
            <select
              className="h-7 appearance-none rounded-md border border-input bg-transparent pl-2 pr-7 text-base font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              value={pageSize}
              onChange={handlePageSizeSelect}
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-1.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {/* DS .jf-dt__sep — 1px vertical divider before the range readout. */}
        <span aria-hidden="true" className="h-[1.375rem] w-px bg-border" />

        {/* Range */}
        <span className="tabular-nums">
          {rangeStart.toLocaleString()} - {rangeEnd.toLocaleString()} of{' '}
          {totalRows.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ── TopBar (search + columns toggle) ────────────────────────────────────────

/**
 * Whether the DataTable toolbar should render at all. It shows when the
 * toolbar isn't force-hidden AND at least one of its slots has content:
 * a title, the search affordance, or the columns toggle. Pure for testing.
 */
export function shouldShowToolbar(opts: {
  hideToolbar?: boolean;
  hasTitle: boolean;
  hasToolbarLeft?: boolean;
  hasToolbarRight?: boolean;
  hideSearch: boolean;
  hideColumnsToggle?: boolean;
}): boolean {
  if (opts.hideToolbar) return false;
  return (
    opts.hasTitle ||
    !!opts.hasToolbarLeft ||
    !!opts.hasToolbarRight ||
    !opts.hideSearch ||
    !opts.hideColumnsToggle
  );
}

interface TopBarProps {
  title?: string;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onToggleColumnsPanel: () => void;
  searchPlaceholder?: string;
  hideSearch?: boolean;
  hideColumnsToggle?: boolean;
}

/**
 * Compact toolbar rendered above the grid. Currently hosts:
 *
 *   - An expanding search button (click → input opens; Esc / clear → collapses).
 *   - A columns visibility toggle (click → opens the right-side AG Grid panel).
 *
 * Left half is intentionally empty for now — reserved for tabs / view
 * switchers in a future iteration.
 */
function TopBar({
  title,
  toolbarLeft,
  toolbarRight,
  searchValue,
  onSearchChange,
  onToggleColumnsPanel,
  searchPlaceholder,
  hideSearch,
  hideColumnsToggle,
}: TopBarProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
    }
  }, [expanded]);

  const collapseIfEmpty = useCallback(() => {
    if (searchValue === '') {
      setExpanded(false);
    }
  }, [searchValue]);

  const handleClear = useCallback(() => {
    onSearchChange('');
    inputRef.current?.focus();
  }, [onSearchChange]);

  return (
    <div className="flex items-center justify-between gap-2 pb-4">
      {/* Left slot — optional table heading (DS Heading 4: 18px / 600) and/or
          caller-provided content (e.g. a saved-view switcher). */}
      <div className="flex min-w-0 items-center gap-2">
        {title && (
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        )}
        {toolbarLeft}
      </div>

      {/* Right slot — search + columns. */}
      <div className="flex items-center gap-1">
        {!hideSearch && (
          expanded ? (
            <div className="relative flex items-center">
              <SearchIcon className="pointer-events-none absolute left-2 size-5 text-muted-foreground" />
              <input
                ref={inputRef}
                // type="text" (not "search") so the browser doesn't add
                // its own native clear button alongside our custom × icon.
                type="text"
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                onBlur={collapseIfEmpty}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchValue) {
                      onSearchChange('');
                    } else {
                      setExpanded(false);
                    }
                  }
                }}
                placeholder={searchPlaceholder ?? 'Search…'}
                className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-7 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Search"
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-1.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Clear search"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex size-8 items-center justify-center rounded-md text-grayscale-600 transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Open search"
              title="Search"
            >
              <SearchIcon className="size-5" />
            </button>
          )
        )}
        {!hideColumnsToggle && (
          <button
            type="button"
            onClick={onToggleColumnsPanel}
            className="inline-flex size-8 items-center justify-center rounded-md text-grayscale-600 transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Toggle columns panel"
            title="Columns"
          >
            <Columns3Icon className="size-5" />
          </button>
        )}
        {toolbarRight && <div className="flex items-center gap-2 pl-1">{toolbarRight}</div>}
      </div>
    </div>
  );
}

// ── DataTable ───────────────────────────────────────────────────────────────

/**
 * Thin AG Grid wrapper with project-wide defaults.
 *
 * Two modes — picked automatically:
 *
 * - **Client-side** (default): pass `rowData` with the full dataset. AG Grid
 *   handles pagination, sort, and filter internally.
 * - **Server-side**: pass `onParamsChange` (and update `rowData` + `count`
 *   in response). DataTable builds AG Grid's datasource itself and calls
 *   your callback whenever AG Grid needs a different slice (page / sort /
 *   filter change). You never need to construct an `IDatasource` yourself.
 *
 * The container must have a defined height — either set it via `className`
 * (e.g. `className="h-[37.5rem]"`) or ensure the parent uses a flex/grid
 * layout that constrains height.
 */

// ── Initial-load skeleton ─────────────────────────────────────────────────────

/**
 * Shimmer placeholder shown on the table's first load (before AG Grid mounts).
 * A gold header strip over N×M shimmer cells; styling matches the DS gold-header
 * table. Shimmer keyframe lives in DataTable.css (`.ui-dt-skeleton-cell`).
 */
function DataTableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  const colKeys = Array.from({ length: cols });
  const rowKeys = Array.from({ length: rows });
  return (
    <div
      data-slot="data-table-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex h-full w-full flex-col overflow-hidden rounded-[0.625rem] border border-primary-200 bg-background"
    >
      <div className="flex gap-2 border-b border-primary-100 bg-primary-50 px-4 py-3">
        {colKeys.map((_, i) => (
          <div key={i} className="ui-dt-skeleton-cell h-6 flex-1" />
        ))}
      </div>
      {rowKeys.map((_, r) => (
        <div
          key={r}
          className="flex gap-2 border-b border-grayscale-100 px-4 py-3 last:border-b-0"
        >
          {colKeys.map((_, c) => (
            <div key={c} className="ui-dt-skeleton-cell h-6 flex-1" />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading table data…</span>
    </div>
  );
}

/**
 * Body overlay shown when the grid has zero rows. AG Grid renders this inside
 * the grid body, so the column header + footer stay visible. Shows the
 * DataTable's `errorMessage` (a failed fetch) in red when present, otherwise a
 * neutral "No results." The message is threaded via AG Grid `context`.
 */
function NoRowsOverlay(props: {
  context?: { dataTableErrorMessage?: string };
}) {
  const errorMessage = props.context?.dataTableErrorMessage;
  if (errorMessage) {
    return (
      <div role="alert" className="px-6 text-center text-sm text-destructive">
        {errorMessage}
      </div>
    );
  }
  return (
    <div role="status" className="px-6 text-center text-sm text-muted-foreground">
      No results.
    </div>
  );
}

function DataTable<TData = any>({
  className,
  'data-testid': dataTestId,
  defaultColDef,
  theme,
  hidePagination,
  count,
  rowData,
  isLoading,
  onParamsChange,
  onPaginationChanged: onPaginationChangedProp,
  paginationPageSize,
  cacheBlockSize,
  title,
  toolbarLeft,
  toolbarRight,
  hideToolbar,
  hideSearch,
  searchPlaceholder,
  hideColumnsToggle,
  searchDebounceMs,
  searchEnabled,
  gatedMessage,
  errorMessage,
  minHeight = '32rem',
  rowActions,
  rowActionsWidth,
  sideBar: sideBarProp,
  columnDefs,
  context: contextProp,
  ...agGridProps
}: DataTableProps<TData>) {
  const gridRef = useRef<AgGridReact<TData>>(null);

  // ── Initial-load skeleton tracking ──────────────────────────────────
  // The full shimmer skeleton renders ONLY before AG Grid has ever
  // mounted. Once it mounts, we keep it alive forever (a remount would
  // destroy custom headers / filter popovers / cell state) and defer to
  // AG Grid's own loading overlay for later fetches. `gridHasEverMountedRef`
  // is the synchronous source of truth; the state mirror just forces the
  // one re-render needed to swap the skeleton out for the grid.
  const gridHasEverMountedRef = useRef(false);
  const [gridHasEverMounted, setGridHasEverMounted] = useState(false);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<TData>) => {
      if (!gridHasEverMountedRef.current) {
        gridHasEverMountedRef.current = true;
        setGridHasEverMounted(true);
      }
      (agGridProps as { onGridReady?: (e: GridReadyEvent<TData>) => void })
        .onGridReady?.(event);
    },
    [agGridProps],
  );

  // ── Container sizing ─────────────────────────────────────────────────
  // No viewport measurement. The grid-body wrapper (below) carries this as
  // a DEFINITE `height` (not `min-height`, and NOT a flex item). It must be
  // a definite height because AG Grid's `.ag-root-wrapper.ag-layout-normal`
  // is `height: 100%`, and a percentage height only resolves against an
  // ancestor's definite `height` — NOT its `min-height`. Two pitfalls,
  // both verified in the browser:
  //   1. `min-height` alone → wrapper stays `height:auto` → the `100%`
  //      chain collapses to 0, `.ag-body-viewport` clips to 0px, rows
  //      render below the fold (in the DOM but off-screen).
  //   2. a definite `height` BUT with `flex-1` → `flex-basis:0%` overrides
  //      the height on the main axis → same 0/2px collapse.
  // So the wrapper is a plain `flex flex-col` with an inline `height`.
  const minHeightStyle =
    typeof minHeight === 'number' ? `${minHeight}px` : minHeight;

  const [pagination, setPagination] = useState<PaginationState>(INITIAL_PAGINATION);

  const isServerSide = typeof onParamsChange === 'function';
  const rowModelType = isServerSide ? 'infinite' : 'clientSide';

  // ── Top toolbar: search + columns panel ──────────────────────────────────
  //
  // Search has two debounced outputs depending on row-model:
  //   - client-side: feeds AG Grid's `quickFilterText` for in-memory filter
  //   - server-side: emits via `onParamsChange({ ..., search })`; the caller
  //     decides how to translate it into a server-side filter.
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const effectiveSearchDebounceMs = searchDebounceMs ?? 300;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, effectiveSearchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [searchInput, effectiveSearchDebounceMs]);

  // Default side-bar configuration — the column visibility panel. Callers
  // can override via the standard AG Grid `sideBar` prop (passed through
  // via `agGridProps`).
  const sideBar = useMemo<SideBarDef | undefined>(() => {
    if (sideBarProp !== undefined) {
      return sideBarProp as SideBarDef | undefined;
    }
    if (hideColumnsToggle) return undefined;
    return {
      toolPanels: [
        {
          id: 'columns',
          labelDefault: 'Columns',
          labelKey: 'columns',
          iconKey: 'columns',
          toolPanel: 'agColumnsToolPanel',
          toolPanelParams: {
            suppressRowGroups: true,
            suppressValues: true,
            suppressPivots: true,
            suppressPivotMode: true,
            suppressColumnFilter: false,
            suppressColumnSelectAll: false,
            suppressColumnExpandAll: true,
          },
        },
      ],
      position: 'right',
      defaultToolPanel: '',
    };
  }, [sideBarProp, hideColumnsToggle]);

  const handleToggleColumnsPanel = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const open = api.getOpenedToolPanel();
    if (open === 'columns') {
      api.closeToolPanel();
    } else {
      api.openToolPanel('columns');
    }
  }, []);

  // Client-side mode with a row count that matches the platform's saved-query
  // default page size (50) almost always means the caller called
  // `useSavedQueryList(name, { input: {} })` and dropped the result straight
  // into DataTable without `onParamsChange`. AG Grid renders exactly what
  // it's given — looking complete when it isn't. Render a visible red banner
  // above the grid so the agent inspecting the preview catches the bug
  // before shipping.
  const SAVED_QUERY_DEFAULT_PAGE = 50;
  const showClientSidePaginationWarning =
    !isServerSide &&
    Array.isArray(rowData) &&
    rowData.length === SAVED_QUERY_DEFAULT_PAGE;

  // Mirrors the renderer's defaultColDef (see
  // `/Users/sarathnk/Desktop/Projects/ui/libs/composite/table/src/lib/hooks/use-column-defs.ts:834-878`).
  // Using the explicit `'agTextColumnFilter'` instead of `filter: true`
  // avoids AG-Grid Enterprise's silent fallback to `agSetColumnFilter`
  // when the enterprise modules are registered — that fallback gave us
  // the "(Select All)" popup we don't want for text columns. The renderer
  // overrides per-column for boolean/enum-shaped columns; that mapping
  // is a follow-up plan.
  //
  // The merged object MUST be `useMemo`-stable across renders. AG-Grid
  // React detects prop changes by reference, not deep equality; a new
  // `defaultColDef` literal each render makes AG-Grid re-apply column
  // definitions, which tears down any open column popup — including a
  // half-typed filter input. That manifested as "filter popup closes
  // suddenly while typing" after the saved-query work added a
  // `setParams` round-trip on every filter Apply (re-render cascade
  // → new object literal → AG-Grid re-init → popup destroyed). Callers
  // passing their own `defaultColDef` are expected to memoise it on
  // their side; we can't paper over an unstable upstream reference
  // without masking real changes.
  const mergedDefaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      filter: 'agTextColumnFilter' as const,
      floatingFilter: false,
      filterParams: {
        debounceMs: 400,
        // Keep the popup open after the user clicks Apply so they can
        // see the filter take effect and tweak the value without
        // re-opening. It still closes on outside-click via AG-Grid's
        // normal popup semantics — this just removes the snap-shut on
        // Apply.
        closeOnApply: false,
        maxNumConditions: 1,
      },
      menuTabs: ['filterMenuTab', 'generalMenuTab', 'columnsMenuTab'] as ColumnMenuTab[],
      minWidth: 100,
      flex: 1,
      ...defaultColDef,
    }),
    [defaultColDef],
  );

  // All columns are filterable through the saved-query `_filter` CEL
  // contract. No per-column filter UI restriction at this layer; pages
  // that genuinely need to hide a column's funnel can set `filter: false`
  // on the relevant column def.

  // Sanitise incoming columnDefs: any column declared without `field`
  // AND without `colId` has no stable identity AG-Grid can key its
  // filter/sort models by, so AG-Grid silently auto-assigns numeric
  // colIds ("0", "1", …). The saved-query CEL builder then turns those
  // into `containsIgnoreCase(0, 'foo')` and a sort on `0` — both garbage
  // on the wire.
  // We strip the filter + sort affordances from those columns here so
  // the funnel/sort UI never appears for something we can't translate.
  // `useSavedQueryTable` has a redundant guard at the CEL layer.
  const sanitizedColumnDefs = useMemo(
    () =>
      sanitizeColumnDefs(columnDefs, {
        onSuppress: (headerName) => {
          if (
            typeof import.meta !== 'undefined' &&
            (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV
          ) {
            // eslint-disable-next-line no-console
            console.warn(
              `[DataTable] Column "${headerName ?? '(unnamed)'}" has no ` +
                `field or colId — filter/sort auto-disabled. Declare ` +
                `field: '<backend_field>' (with valueFormatter for derived ` +
                `display) or colId: '<backend_field>' to enable them.`,
            );
          }
        },
      }),
    [columnDefs],
  );

  // ── Opt-in row-actions column ─────────────────────────────────────────────
  // When `rowActions` is provided, append ONE standardized kebab (⋮) column.
  // Appended AFTER the sanitized caller columns so it never runs through the
  // filter/sort sanitizer and can't collide with a caller column. It is
  // pinned right, fixed-width, and has no sort/filter/menu/resize — it's a
  // pure UI affordance, not a data column. Threaded to `RowActionsCell` via
  // AG Grid's `context` (merged below).
  const effectiveColumnDefs = useMemo<ColDef<TData>[] | undefined>(() => {
    if (!rowActions) return sanitizedColumnDefs as ColDef<TData>[] | undefined;
    const base = (sanitizedColumnDefs ?? []) as ColDef<TData>[];
    const actionsCol: ColDef<TData> = {
      colId: '__row_actions__',
      headerName: '',
      cellRenderer: RowActionsCell,
      width: rowActionsWidth ?? 56,
      minWidth: rowActionsWidth ?? 56,
      maxWidth: rowActionsWidth ?? 56,
      pinned: 'right',
      sortable: false,
      filter: false,
      resizable: false,
      lockPinned: true,
      lockVisible: true,
      suppressColumnsToolPanel: true,
      suppressHeaderMenuButton: true,
      suppressMovable: true,
      // Zero the horizontal padding so the kebab sits flush to the right edge
      // (the cell renderer right-aligns its own content).
      cellStyle: { paddingLeft: 0, paddingRight: 4 },
    };
    return [...base, actionsCol];
  }, [sanitizedColumnDefs, rowActions, rowActionsWidth]);

  // Merge the row-actions source into AG Grid's `context` so RowActionsCell
  // can read it, preserving any caller-provided context.
  const mergedContext = useMemo(
    () => ({
      ...(contextProp as object | undefined),
      rowActions,
      // Read by NoRowsOverlay so a failed fetch shows in the grid BODY
      // (header + footer stay visible) instead of replacing the whole grid.
      dataTableErrorMessage: errorMessage,
    }),
    [contextProp, rowActions, errorMessage],
  );

  const effectivePageSize = paginationPageSize ?? DEFAULT_PAGE_SIZE;
  // Keep blocks aligned with pages so `startRow / pageSize` always gives a
  // clean page index. Caller can still override.
  const effectiveCacheBlockSize = resolveCacheBlockSize(
    isServerSide,
    cacheBlockSize,
    effectivePageSize,
  );

  const showPagination = !hidePagination && agGridProps.pagination !== false;
  // Footer is suppressed when the table has no records — an empty table (or a
  // count companion that resolved to 0) shows no "0 of 0" pagination bar.
  const showPaginationFooter = shouldShowPaginationFooter(
    showPagination,
    pagination.totalRows,
  );

  // ── Server-side bridge ────────────────────────────────────────────────────
  //
  // AG Grid asks our internal datasource for a block; we stash the request
  // and notify the consumer. When the consumer hands back fresh rowData via
  // props, we resolve the parked request.
  const pendingRef = useRef<IGetRowsParams | null>(null);
  const lastResolvedRowDataRef = useRef<unknown>(null);
  // Signature (search + block range + sort + filter) of the request the
  // currently-committed `rowData` was last resolved FOR. Lets `getRows`
  // distinguish a re-request of the SAME params (AG Grid re-asks for block 0
  // after `setRowCount` changes the count — data is already settled, resolve
  // inline) from a genuinely-new request (search/sort/page changed — the
  // committed data is stale, wait for the effect). `null` until first resolve.
  const lastResolvedSigRef = useRef<string | null>(null);
  // True until the FIRST `getRows` after (re)mount fires. The warm-cache inline
  // fast path is allowed to resolve ONLY on that first call — see the comment in
  // `getRows`. Every later block (search / sort / page) defers to the effect.
  const firstGetRowsRef = useRef(true);
  const onParamsChangeRef = useRef(onParamsChange);
  useEffect(() => {
    onParamsChangeRef.current = onParamsChange;
  }, [onParamsChange]);

  // Keep the latest debounced search value in a ref so the datasource
  // closure can read it without needing to rebuild when search changes
  // (rebuilding the datasource would discard AG Grid's row cache).
  const debouncedSearchRef = useRef(debouncedSearch);
  useEffect(() => {
    debouncedSearchRef.current = debouncedSearch;
  }, [debouncedSearch]);

  // Mirrors of the data signals so the datasource closure can peek at
  // the latest values without rebuilding. Used by the warm-cache fast
  // path inside `getRows` (see comment there). Same pattern as
  // `debouncedSearchRef` / `onParamsChangeRef`.
  const rowDataRef = useRef(rowData);
  const countRef = useRef(count);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    rowDataRef.current = rowData;
  }, [rowData]);
  useEffect(() => {
    countRef.current = count;
  }, [count]);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const datasource = useMemo<IDatasource | undefined>(() => {
    if (!isServerSide) return undefined;
    return {
      getRows(params: IGetRowsParams) {
        pendingRef.current = params;
        const pageSize = Math.max(params.endRow - params.startRow, 1);
        const page = Math.floor(params.startRow / pageSize);
        const search = debouncedSearchRef.current;
        const sig = makeServerRequestSig(search, params);
        // First getRows after (re)mount? Only that one is eligible for the
        // warm-cache inline resolve below; flip the flag before the early
        // returns so every subsequent block defers to the effect.
        const isFirstGetRows = firstGetRowsRef.current;
        firstGetRowsRef.current = false;

        onParamsChangeRef.current?.({
          page,
          pageSize,
          sortModel: params.sortModel ?? [],
          filterModel: (params.filterModel as FilterModel | null) ?? null,
          search: search ? search : undefined,
        });

        // ── Re-request inline resolve ──────────────────────────────
        // AG Grid re-asks for a block it already had (most often block 0,
        // right after our count effect calls `api.setRowCount(count, true)`).
        // The consumer's data is ALREADY settled for these exact params, but
        // `rowData` / `count` / `isLoading` don't change, so the resolution
        // effect's deps are stable and it never re-runs — the re-requested
        // block would hang as `—` placeholders. When this request's signature
        // matches the one we last resolved AND data is settled, resolve it
        // straight from the committed rows. The signature guard is what keeps
        // this safe: a genuinely-new request (search / sort / page changed)
        // has a different signature, so it correctly falls through to the
        // effect and waits for the fresh fetch instead of getting stale rows.
        const data = rowDataRef.current;
        if (
          !isFirstGetRows &&
          sig === lastResolvedSigRef.current &&
          !isLoadingRef.current &&
          data != null
        ) {
          pendingRef.current = null;
          lastResolvedRowDataRef.current = data;
          params.successCallback(data as TData[], countRef.current ?? -1);
          return;
        }

        // ── Warm-cache fast path (FIRST getRows only) ──────────────
        // On back-nav remount, React Query may already hold cached
        // rowData/count for these initial params — `rowData` is real
        // on the very first render, so our deps-driven resolution
        // effect runs once at mount with `pendingRef` still null and
        // bails. AG-Grid then fires this `getRows` shortly after, but
        // the consumer's `setParams` round-trip produces no change to
        // the effect's deps (`rowData`/`count`/`isLoading` are all
        // stable from the cache), so the effect never re-runs and the
        // block stays pending forever — cells render as `—`
        // placeholders. Resolve synchronously here when fresh cached
        // data is already available.
        //
        // Guarded to the FIRST getRows: on a later block (search / sort
        // / page) the committed `rowData` (via ref) still reflects the
        // PREVIOUS params at this instant — resolving inline would fill
        // the new block with stale rows. Those blocks defer to the
        // effect, which fires once fresh data for the new request has
        // settled.
        if (!isFirstGetRows) return;
        if (
          shouldResolveBlockInline(
            data,
            isLoadingRef.current,
            lastResolvedRowDataRef.current,
          )
        ) {
          pendingRef.current = null;
          lastResolvedRowDataRef.current = data;
          lastResolvedSigRef.current = sig;
          params.successCallback(
            data as TData[],
            countRef.current ?? -1,
          );
        }
      },
    };
  }, [isServerSide]);

  // When the debounced search value changes in server-side mode, purge AG
  // Grid's infinite cache and re-trigger `getRows` so the new search flows
  // through to the consumer's onParamsChange handler.
  useEffect(() => {
    if (!isServerSide) return;
    const api = gridRef.current?.api;
    if (!api) return;
    api.purgeInfiniteCache();
  }, [debouncedSearch, isServerSide]);

  useEffect(() => {
    if (!isServerSide) return;
    const pending = pendingRef.current;
    if (!pending) return;
    // Resolve the parked block as soon as the consumer's data has SETTLED for
    // the current request. Gate on `pendingRef` (cleared on resolve) — NOT on
    // data-reference novelty. React Query hands back the SAME array reference
    // for an identical repeated search (structural sharing / cache hit), so a
    // `data === lastResolved` guard would treat the fresh block as "already
    // resolved" and leave AG Grid's rows stuck as `—` placeholders on the
    // second search of the same term. `pendingRef` already prevents a
    // double-resolve (a new block re-arms it via getRows), and `isLoading`
    // prevents resolving with stale data before the new fetch settles.
    if (rowData == null) return;
    if (isLoading) return;

    pendingRef.current = null;
    lastResolvedRowDataRef.current = rowData;
    // Record the request signature this data satisfies so a later duplicate
    // block request (e.g. AG Grid re-asking for block 0 after setRowCount) is
    // recognised in getRows and resolved inline instead of hanging as `—`.
    lastResolvedSigRef.current = makeServerRequestSig(
      debouncedSearchRef.current,
      pending,
    );
    pending.successCallback(rowData as TData[], count ?? -1);
  }, [rowData, count, isServerSide, isLoading]);

  // ── Pagination footer sync ────────────────────────────────────────────────

  const syncPagination = useCallback(
    (api: GridApi) => {
      const currentPage = api.paginationGetCurrentPage();
      const pageSize = api.paginationGetPageSize();
      const totalRows = count ?? api.paginationGetRowCount();
      const totalPages =
        count != null
          ? Math.max(1, Math.ceil(count / Math.max(pageSize, 1)))
          : api.paginationGetTotalPages();
      const rangeStart = totalRows > 0 ? currentPage * pageSize + 1 : 0;
      const rangeEnd = Math.min((currentPage + 1) * pageSize, totalRows);

      setPagination((prev) => {
        if (
          prev.currentPage === currentPage &&
          prev.pageSize === pageSize &&
          prev.totalRows === totalRows &&
          prev.totalPages === totalPages
        ) {
          return prev;
        }
        return { currentPage, totalPages, pageSize, totalRows, rangeStart, rangeEnd };
      });
    },
    [count],
  );

  const onPaginationChanged = useCallback(
    (event: PaginationChangedEvent<TData>) => {
      syncPagination(event.api);
      onPaginationChangedProp?.(event);
    },
    [syncPagination, onPaginationChangedProp],
  );

  // Push the external count into AG Grid's infinite row model so it knows
  // the true last row index before all blocks load; then refresh the footer.
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api || count == null) return;
    if (isServerSide) {
      api.setRowCount(count, true);
    }
    syncPagination(api);
  }, [count, isServerSide, syncPagination]);

  // Re-show the no-rows overlay when the error state toggles so it picks up
  // the latest `errorMessage` from context (AG Grid does not re-render an
  // overlay component on a context change alone). Only acts when the grid has
  // no rows — exactly when the overlay is (or should be) visible.
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    if (api.getDisplayedRowCount() === 0) {
      api.showNoRowsOverlay();
    }
  }, [errorMessage]);

  const handlePageChange = useCallback((page: number) => {
    gridRef.current?.api?.paginationGoToPage(page);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    gridRef.current?.api?.setGridOption('paginationPageSize', size);
  }, []);

  // Only forward rowData to AG Grid in client-side mode; in server-side
  // mode it travels through the datasource bridge instead.
  const agRowData = isServerSide ? undefined : (rowData ?? undefined);

  // First-load shimmer skeleton (renderer parity). Only before AG Grid has
  // ever mounted; afterwards AG Grid's own overlay handles loading.
  const showInitialSkeleton = shouldShowInitialSkeleton({
    isLoading: !!isLoading,
    hasMounted: gridHasEverMounted,
    gatedMessage,
    hasRows: (rowData?.length ?? 0) > 0,
  });
  const skeletonShape = computeSkeletonShape(
    sanitizedColumnDefs?.length ?? 0,
    effectivePageSize,
  );

  // In-flight shimmer OVERLAY for server-side refetches (search / filter / sort
  // / page). AG Grid keeps the previous rows on screen during a
  // `purgeInfiniteCache` refetch — it does NOT put them into a "loading" state —
  // so `loadingCellRenderer` never fires and a search looked frozen. Instead we
  // lay a shimmer over the grid body (below the gold header) whenever the
  // consumer's query is loading, matching the initial-load skeleton's look.
  // Only after the grid has mounted (the first load uses the full skeleton) and
  // never over a gated/error state.
  const showLoadingOverlay =
    isServerSide &&
    !!isLoading &&
    gridHasEverMounted &&
    !gatedMessage &&
    !errorMessage;

  return (
    <div
      data-slot="data-table"
      data-testid={dataTestId}
      className={cn('ui-data-table flex h-full w-full flex-col', className)}
    >
      {showClientSidePaginationWarning && (
        <div
          role="alert"
          className="mb-2 rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <strong>Pagination not wired.</strong> DataTable received{' '}
          {SAVED_QUERY_DEFAULT_PAGE} rows in client-side mode — that's the
          saved-query default page size, so the list is almost certainly
          truncated. Switch this page to{' '}
          <code>useSavedQueryTable</code> from <code>@/hooks</code>; see{' '}
          <code>src/queries/SAVED-QUERY.md</code> for the recipe.
        </div>
      )}
      {/* The toolbar search button is hidden when:
            - the caller passed `hideSearch`, OR
            - the saved-query hook says no search field is wired
              (`searchEnabled === false`). */}
      {(() => {
        const effectiveHideSearch = hideSearch || searchEnabled === false;
        const showToolbar = shouldShowToolbar({
          hideToolbar,
          hasTitle: !!title,
          hasToolbarLeft: !!toolbarLeft,
          hasToolbarRight: !!toolbarRight,
          hideSearch: effectiveHideSearch,
          hideColumnsToggle,
        });
        if (!showToolbar) return null;
        return (
          <TopBar
            title={title}
            toolbarLeft={toolbarLeft}
            toolbarRight={toolbarRight}
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            onToggleColumnsPanel={handleToggleColumnsPanel}
            searchPlaceholder={searchPlaceholder}
            hideSearch={effectiveHideSearch}
            hideColumnsToggle={hideColumnsToggle}
          />
        );
      })()}
      {/* Grid body. The `minHeight` value is applied HERE as a DEFINITE
          `height` — this is the element AG Grid's `height:100%` chain resolves
          against (see the comment on `minHeightStyle` above for why
          `min-height` collapses the grid to 0).
          NOTE: deliberately NOT `flex-1`. A flex child's `flex-basis:0%`
          (what `flex-1` sets) overrides the `height` property on the main
          axis, so the box collapses to ~2px in an auto-height page and the
          grid never gets a height. Plain `flex flex-col` lets the definite
          `height` stand; the AG host below fills it via `flex-1 min-h-0`.
          `relative` is REQUIRED: AG renders a `position:absolute`
          `.ag-aria-description-container` (1px a11y live-region) as a sibling
          of `.ag-root-wrapper`. Without a positioned ancestor here its
          containing block is the document ICB, so it escapes the layout's
          `overflow` clip and sits ~22px below the fold — adding a spurious
          document-level scrollbar. `relative` scopes it to this box. */}
      <div
        className="relative flex flex-col"
        style={{ height: minHeightStyle }}
      >
        {gatedMessage ? (
          <div
            role="status"
            className="flex h-full w-full items-center justify-center rounded border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground"
          >
            {gatedMessage}
          </div>
        ) : showInitialSkeleton ? (
          <DataTableSkeleton rows={skeletonShape.rows} cols={skeletonShape.cols} />
        ) : (
          <AgGridReact<TData>
            ref={gridRef}
            className="min-h-0 flex-1"
            theme={theme ?? appTheme}
            pagination
            paginationPageSize={effectivePageSize}
            paginationPageSizeSelector={PAGE_SIZE_OPTIONS}
            cacheBlockSize={effectiveCacheBlockSize}
            suppressPaginationPanel
            suppressCellFocus
            animateRows
            rowModelType={rowModelType}
            rowData={agRowData}
            datasource={datasource}
            defaultColDef={mergedDefaultColDef}
            columnDefs={effectiveColumnDefs}
            onPaginationChanged={onPaginationChanged}
            quickFilterText={!isServerSide ? debouncedSearch : undefined}
            sideBar={sideBar}
            noRowsOverlayComponent={NoRowsOverlay}
            {...agGridProps}
            context={mergedContext}
            onGridReady={handleGridReady}
          />
        )}
        {showLoadingOverlay && (
          <div
            data-slot="data-table-loading-overlay"
            role="status"
            aria-live="polite"
            aria-busy="true"
            // Sits above the rows (z-10) but starts below the 46px gold header
            // so the column headers stay visible while the body shimmers.
            // Opaque background hides the stale rows AG Grid keeps painted
            // underneath during the refetch.
            className="pointer-events-none absolute inset-x-0 bottom-0 top-[2.875rem] z-10 flex flex-col overflow-hidden bg-background"
          >
            {Array.from({ length: skeletonShape.rows }).map((_, r) => (
              <div
                key={r}
                className="flex gap-2 border-b border-grayscale-100 px-4 py-3 last:border-b-0"
              >
                {Array.from({ length: skeletonShape.cols }).map((_, c) => (
                  <div key={c} className="ui-dt-skeleton-cell h-6 flex-1" />
                ))}
              </div>
            ))}
            <span className="sr-only">Loading table data…</span>
          </div>
        )}
      </div>
      {showPaginationFooter && (
        <PaginationBar
          state={pagination}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}
    </div>
  );
}

export { DataTable, appTheme };
