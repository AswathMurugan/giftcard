/**
 * Hook for executing a single-output saved query.
 *
 * Use this when the saved query's `is_single_output` flag is `true` (KPI
 * card, account-summary aggregate, etc.). It targets the server's dedicated
 * `/execute/single` endpoint which:
 *   - returns the result object directly (no array wrapper);
 *   - returns HTTP 404 with NO_RESULTS_FOUND when the underlying DynQL
 *     matches zero rows — this hook maps that to `data: null, error: null`
 *     so the UI can render "no data" without branching on errors;
 *   - returns HTTP 400 with MULTIPLE_RESULTS when the underlying DynQL
 *     matches more than one row — this surfaces as a normal error.
 *
 * The generic `N extends SavedQueryName` is the saved-query name. The
 * input shape and result shape are derived from the auto-generated
 * registry at `src/types/saved-queries.generated.ts`.
 *
 * @example
 * const { data, isLoading } = useSavedQuerySingle(
 *   'get_account_summary_details',
 *   { input: { accountId } },
 * );
 * // data?.account?.account_value
 */
import { useQuery } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { apiManager } from '@/services/api-manager';
import { getDataHeaders } from '@/config/api-config';
import { logger } from '@/utils/logger';
import {
  buildSavedQueryRequest,
  normaliseSavedQuerySingleResponse,
  resolveAppDefinitionKey,
} from './saved-query-request';
import { useOrgScopeFilter } from '@/config/org';
import {
  SAVED_QUERY_APP_KEYS,
  SAVED_QUERY_TYPES,
  type SavedQueryName,
  type SavedQueryInputOf,
  type SavedQueryRowOf,
} from '@/types/saved-queries.generated';

export interface SavedQuerySingleOptions<N extends SavedQueryName> {
  /** Saved-query input parameters (typed via the registry). */
  input?: SavedQueryInputOf<N>;
  /**
   * Sort expression: comma-separated, `-` prefix for descending (e.g.
   * `-created_date`). Dynamic queries: body `sort`. Non-dynamic: legacy
   * `_sort` URL param.
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
   * Defaults to `true`. Set `false` to exclude this query (e.g. its entity
   * has no `org` link). No-op outside `<OrgContextProvider>`.
   */
  orgScoped?: boolean;
}

export interface SavedQuerySingleResult<N extends SavedQueryName> {
  data: SavedQueryRowOf<N> | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Sentinel for "no results"; we return it from the queryFn so React Query
 * treats the 404 NO_RESULTS_FOUND case as a successful query with `data` of
 * the sentinel value rather than an error state. The cast back to `null` for
 * consumers happens once after the useQuery call.
 *
 * Using a frozen object (rather than `null`/`undefined`) so React Query
 * caches it correctly — `null` would trigger React Query's "no data yet"
 * branch on subsequent renders.
 */
const NO_RESULTS_SENTINEL = Object.freeze({
  __jiffySavedQueryNoResults: true as const,
});
type NoResults = typeof NO_RESULTS_SENTINEL;

export function useSavedQuerySingle<N extends SavedQueryName>(
  name: N,
  options: SavedQuerySingleOptions<N> = {},
): SavedQuerySingleResult<N> {
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

  const { url, body } = buildSavedQueryRequest(name, 'single', {
    input: options.input as Record<string, unknown> | undefined,
    sort: options.sort,
    filter: options.filter,
    orgFilter: appliedOrgFilter,
    // Routes sort/filter into the body (dynamic) or the legacy URL params
    // (sql / composite / unknown platform queries).
    queryType: SAVED_QUERY_TYPES[name],
  });

  const headers = getDataHeaders(appDefinitionKey);

  const queryResult = useQuery({
    queryKey: [
      'saved-query-single',
      name,
      url,
      body,
      appDefinitionKey,
    ],
    queryFn: async (): Promise<SavedQueryRowOf<N> | NoResults | null> => {
      logger.log('saved-query:single:request', {
        name,
        url,
        body,
        appDefinitionKey,
      });
      try {
        const response = await apiManager.post('data', url, body, headers);
        const single = normaliseSavedQuerySingleResponse<SavedQueryRowOf<N>>(
          response.data,
        );
        logger.log('saved-query:single:success', {
          name,
          hasResult: single !== null,
        });
        return single;
      } catch (error) {
        const axErr = error as AxiosError;
        if (axErr?.response?.status === 404) {
          // Server says NO_RESULTS_FOUND — treat as a successful "no data"
          // outcome rather than an error so callers don't have to special-
          // case it.
          logger.warn('saved-query:single:no-results', { name });
          return NO_RESULTS_SENTINEL;
        }
        logger.error('saved-query:single:error', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    enabled,
  });

  const raw = queryResult.data;
  const data: SavedQueryRowOf<N> | null =
    raw === NO_RESULTS_SENTINEL || raw === undefined
      ? null
      : (raw as SavedQueryRowOf<N> | null);

  return {
    data,
    isLoading: queryResult.isLoading,
    error: queryResult.error,
    refetch: queryResult.refetch,
  };
}
