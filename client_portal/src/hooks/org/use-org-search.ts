/**
 * Per-level org search.
 *
 * v1 sources orgs from the hierarchy's `accessibleOrgs` (returned by
 * user-org-context-v3) and filters client-side by level + selected parent +
 * query. This covers the common shallow hierarchy without an extra round-trip.
 *
 * (If a tenant has levels deeper than what `accessibleOrgs` returns, a
 * server-backed org-search query can be slotted in here later — the selector
 * calls `search(levelOrder, parentIds, query)` and reads `resultsFor`.)
 */
import { useCallback, useMemo, useState } from 'react';
import { useOrgContext, type Organization } from '@/config/org';
import { filterOrgs } from './org-data-mappers';

export function useOrgSearch(): {
  resultsFor: (
    levelOrder: number,
    parentIds: string[] | null,
    query: string,
  ) => Organization[];
  /** Debounced query state per level (the selector drives the input). */
  queryByLevel: Record<number, string>;
  setQuery: (levelOrder: number, query: string) => void;
} {
  const ctx = useOrgContext();
  const accessible = ctx?.hierarchy?.accessibleOrgs ?? [];
  const [queryByLevel, setQueryByLevel] = useState<Record<number, string>>({});

  const setQuery = useCallback((levelOrder: number, query: string) => {
    setQueryByLevel((prev) => ({ ...prev, [levelOrder]: query }));
  }, []);

  const resultsFor = useCallback(
    (levelOrder: number, parentIds: string[] | null, query: string) =>
      filterOrgs(accessible, levelOrder, parentIds, query),
    [accessible],
  );

  return useMemo(
    () => ({ resultsFor, queryByLevel, setQuery }),
    [resultsFor, queryByLevel, setQuery],
  );
}
