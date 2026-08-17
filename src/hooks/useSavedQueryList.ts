/**
 * Hook for executing a list-shaped saved query.
 *
 * Saved queries are server-stored, named, READ-ONLY parameterized queries
 * (see `src/queries/SAVED-QUERY.md`). This hook is the runtime entry point
 * when the security policy disallows direct dynamic queries
 * (`POST /query/{entity}`) — saved queries are the only read path.
 *
 * The generic `N extends SavedQueryName` is the saved-query name as it
 * appears in the auto-generated registry at
 * `src/types/saved-queries.generated.ts`. The input shape is derived from
 * that registry, so passing the wrong input field is a compile-time error.
 *
 * Use `useSavedQuerySingle` for `is_single_output: true` saved queries —
 * the server has a dedicated `/execute/single` endpoint for those that
 * surfaces NO_RESULTS_FOUND and MULTIPLE_RESULTS cleanly.
 *
 * @example
 * const { data, isLoading, hasMore } = useSavedQueryList(
 *   'get_client_documents',
 *   { input: { clientId }, page: 0, pageSize: 20 },
 * );
 *
 * NOTE on pagination: the saved-query backend does NOT return a total
 * count. `hasMore` is a heuristic: true when the response filled the
 * requested page size (so there are likely more pages). Use it for
 * Next/Prev controls or AG-Grid's infinite row model; do not show
 * "N of M" pagination. See `src/queries/SAVED-QUERY.md` for the
 * DataTable wiring recipe.
 */
import { useQuery } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeaders } from '@/config/api-config';
import { logger } from '@/utils/logger';
import {
  buildSavedQueryRequest,
  normaliseSavedQueryListResponse,
  resolveAppDefinitionKey,
  DEFAULT_SAVED_QUERY_PAGE_SIZE,
} from './saved-query-request';
import { useOrgScopeFilter } from '@/config/org';
import {
  SAVED_QUERY_APP_KEYS,
  SAVED_QUERY_TYPES,
  type SavedQueryName,
  type SavedQueryInputOf,
  type SavedQueryRowOf,
} from '@/types/saved-queries.generated';

export interface SavedQueryListOptions<N extends SavedQueryName> {
  /** Saved-query input parameters (typed via the registry). */
  input?: SavedQueryInputOf<N>;
  /**
   * Zero-based page index. Dynamic queries: body `page` (offset mode).
   * Non-dynamic queries: legacy `_page` URL param.
   */
  page?: number;
  /**
   * Page size. Dynamic queries: body `page.size`. Non-dynamic queries:
   * legacy `_size` URL param.
   */
  pageSize?: number;
  /**
   * Sort expression: comma-separated, `-` prefix for descending (e.g.
   * `status,-balance`). Dynamic queries: body `sort`. Non-dynamic:
   * legacy `_sort` URL param.
   */
  sort?: string;
  /**
   * CEL filter. Dynamic queries: body `filterExpression`. Non-dynamic:
   * legacy `_filter` URL param.
   */
  filter?: string;
  /**
   * Override the saved query's target app-definition key. RARELY needed —
   * the hook auto-resolves it from the codegen registry
   * (`SAVED_QUERY_APP_KEYS`), so cross-app queries hit the right app
   * automatically. Only set this for an unusual cross-app override.
   */
  appDefinitionKey?: string;
  /** Whether the query is enabled. Defaults to `true`. */
  enabled?: boolean;
  /**
   * Whether to auto-apply the page's org scope (`_org`) from OrgContext.
   * Defaults to `true`. Set `false` to exclude a query — e.g. its target
   * entity has no `org` link, or it should read across all orgs.
   * No-op on pages not wrapped in `<OrgContextProvider>`.
   */
  orgScoped?: boolean;
}

export interface SavedQueryListResult<N extends SavedQueryName> {
  data: SavedQueryRowOf<N>[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  /**
   * True when the response filled the requested page size — more pages
   * likely exist. Heuristic only: the saved-query backend does not
   * surface a `hasMore` flag or total count, so this compares
   * `data.length` against `pageSize`. Final page is detected when the
   * server returns fewer rows than requested.
   */
  hasMore: boolean;
  /** Echo of `options.page ?? 0` so the caller can pass it to the DataTable. */
  page: number;
  /**
   * Echo of `options.pageSize ?? DEFAULT_SAVED_QUERY_PAGE_SIZE` — useful
   * when the caller didn't set pageSize and wants to know what default
   * the server applied.
   */
  pageSize: number;
}

export function useSavedQueryList<N extends SavedQueryName>(
  name: N,
  options: SavedQueryListOptions<N> = {},
): SavedQueryListResult<N> {
  const { enabled = true } = options;
  // Default to the query's own app key from the codegen registry so cross-app
  // saved queries target the correct app; allow an explicit override.
  const appDefinitionKey = resolveAppDefinitionKey(
    name,
    SAVED_QUERY_APP_KEYS,
    options.appDefinitionKey,
  );

  // Auto-apply the page's org scope unless opted out. `null` on non-org pages.
  const orgFilter = useOrgScopeFilter();
  const appliedOrgFilter = options.orgScoped === false ? null : orgFilter;

  const { url, body } = buildSavedQueryRequest(name, 'list', {
    input: options.input as Record<string, unknown> | undefined,
    page: options.page,
    pageSize: options.pageSize,
    sort: options.sort,
    filter: options.filter,
    orgFilter: appliedOrgFilter,
    // Routes pagination/sort/filter into the body (dynamic) or the legacy
    // URL params (sql / composite / unknown platform queries).
    queryType: SAVED_QUERY_TYPES[name],
  });

  const headers = getDataHeaders(appDefinitionKey);

  const queryResult = useQuery({
    queryKey: [
      'saved-query-list',
      name,
      url,
      body,
      appDefinitionKey,
    ],
    queryFn: async () => {
      logger.log('saved-query:list:request', {
        name,
        url,
        body,
        appDefinitionKey,
      });
      try {
        const response = await apiManager.post('data', url, body, headers);
        const rows = normaliseSavedQueryListResponse<SavedQueryRowOf<N>>(
          response.data,
        );
        logger.log('saved-query:list:success', {
          name,
          count: rows.length,
        });
        return rows;
      } catch (error) {
        logger.error('saved-query:list:error', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    enabled,
  });

  const rows = (queryResult.data as SavedQueryRowOf<N>[] | undefined) ?? [];
  const effectivePage = options.page ?? 0;
  const effectivePageSize =
    options.pageSize ?? DEFAULT_SAVED_QUERY_PAGE_SIZE;
  // Heuristic: if the server returned at least `pageSize` rows, assume
  // there's another page. When the server runs out of rows mid-page,
  // `rows.length < pageSize` and we're on the last page.
  const hasMore = rows.length >= effectivePageSize;

  return {
    data: rows,
    isLoading: queryResult.isLoading,
    error: queryResult.error,
    refetch: queryResult.refetch,
    hasMore,
    page: effectivePage,
    pageSize: effectivePageSize,
  };
}
