/**
 * Data hooks for the org-hierarchy selector.
 *
 * These call PLATFORM saved queries directly via apiManager (not the typed
 * `useSavedQuery*` hooks) because the platform queries
 * (`user-org-context-v3`, `advisor_user_list`) are tenant-bootstrapped and
 * not part of the typed registry the starter compiles against. They always
 * target `x-jiffy-app-name: platform` and are NEVER org-scoped themselves
 * (they SOURCE the org selection).
 *
 * Search is debounced and stale responses dropped via a per-call request id.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiManager } from '@/services/api-manager';
import { getDataHeaders } from '@/config/api-config';
import { getAuthService } from '@/config/auth-service-manager';
import { logger } from '@/utils/logger';
import { buildOrgScopeFilter } from '@/hooks/saved-query-request';
import type { Advisor, OrgHierarchy } from '@/config/org';
import {
  mapAdvisors,
  mapOrgContext,
} from './org-data-mappers';

const PLATFORM = 'platform';

/** Names of the platform saved queries (overridable via the selector props). */
export const ORG_CONTEXT_QUERY = 'user-org-context-v3';
export const ADVISOR_SEARCH_QUERY = 'advisor_user_list';

async function execSingle(name: string, params: URLSearchParams): Promise<unknown> {
  const qs = params.toString();
  const url = `/saved-queries/${encodeURIComponent(name)}/execute/single${qs ? `?${qs}` : ''}`;
  const res = await apiManager.post('data', url, {}, getDataHeaders(PLATFORM));
  return res.data;
}

async function execList(name: string, params: URLSearchParams): Promise<unknown> {
  const qs = params.toString();
  const url = `/saved-queries/${encodeURIComponent(name)}/execute${qs ? `?${qs}` : ''}`;
  const res = await apiManager.post('data', url, {}, getDataHeaders(PLATFORM));
  return res.data;
}

/**
 * Load the user's org hierarchy once (primaryOrg, orgLevels, accessibleOrgs).
 * Returns `{ data, isLoading, error }`. The selector seeds OrgContext from it.
 */
export function useOrgContextData(queryName: string = ORG_CONTEXT_QUERY): {
  data: OrgHierarchy | null;
  isLoading: boolean;
  error: unknown;
} {
  const [data, setData] = useState<OrgHierarchy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    const userId = getAuthService().getJiffyUserId();
    if (!userId) {
      setIsLoading(false);
      return;
    }
    const params = new URLSearchParams({ userId });
    setIsLoading(true);
    execSingle(queryName, params)
      .then((raw) => {
        if (cancelled) return;
        setData(mapOrgContext(raw));
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('org:context:error', { error: String(e) });
        setError(e);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryName]);

  return { data, isLoading, error };
}

const DEBOUNCE_EMPTY_MS = 100;
const DEBOUNCE_QUERY_MS = 400;

/**
 * Debounced advisor search scoped to the selected orgs (via `_org`).
 * Re-fires whenever `orgIds` change (empty query) or the user types.
 */
export function useAdvisorSearch(
  orgIds: string[],
  queryName: string = ADVISOR_SEARCH_QUERY,
): {
  results: Advisor[];
  isLoading: boolean;
  search: (query: string) => void;
} {
  const [results, setResults] = useState<Advisor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const reqIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orgKey = orgIds.join(',');

  const run = useCallback(
    (query: string) => {
      const myReq = ++reqIdRef.current;
      setIsLoading(true);
      const params = new URLSearchParams();
      const orgFilter = buildOrgScopeFilter({ orgIds });
      if (orgFilter) params.set('_org', orgFilter);
      if (query.trim()) params.set('q', query.trim());
      execList(queryName, params)
        .then((raw) => {
          if (myReq !== reqIdRef.current) return; // stale
          setResults(mapAdvisors(raw));
        })
        .catch((e) => {
          if (myReq !== reqIdRef.current) return;
          logger.error('org:advisor-search:error', { error: String(e) });
          setResults([]);
        })
        .finally(() => {
          if (myReq === reqIdRef.current) setIsLoading(false);
        });
    },
    [orgIds, queryName],
  );

  const search = useCallback(
    (query: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const delay = query.trim() ? DEBOUNCE_QUERY_MS : DEBOUNCE_EMPTY_MS;
      timerRef.current = setTimeout(() => run(query), delay);
    },
    [run],
  );

  // Re-fetch (empty query) whenever the selected orgs change.
  useEffect(() => {
    if (orgIds.length === 0) {
      setResults([]);
      return;
    }
    run('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgKey]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { results, isLoading, search };
}
