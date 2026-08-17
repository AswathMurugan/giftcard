/**
 * OrgContextProvider — the page-level org-scoping boundary.
 *
 * A page is org-scoped IFF it is wrapped in this provider (the agent adds it
 * when the user asks to "add org" to a page). The provider:
 *   - seeds the org hierarchy once from the `user-org-context-v3` platform
 *     saved query,
 *   - holds the user's current org/advisor selection (driven by
 *     `<OrgHierarchySelector/>`),
 *   - exposes the combined `_org` CEL filter via `useOrgScopeFilter()`.
 *
 * The saved-query read hooks call `useOrgScopeFilter()` and auto-apply `_org`
 * when a selection exists. NO provider on a page ⇒ `useOrgScopeFilter()`
 * returns `null` ⇒ hooks add no `_org`. That is the structural enablement
 * boundary — there is no global flag.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { buildOrgScopeFilter } from '@/hooks/saved-query-request';
import {
  EMPTY_ORG_SELECTION,
  selectedAdvisorIds,
  selectedOrgIds,
  type OrgHierarchy,
  type OrgSelection,
} from './types';

interface OrgContextValue {
  /** Hierarchy seeded from user-org-context-v3 (null until loaded). */
  hierarchy: OrgHierarchy | null;
  setHierarchy: (h: OrgHierarchy | null) => void;
  /** Current selection (orgs per level + advisors + resource). */
  selection: OrgSelection;
  setSelection: (s: OrgSelection) => void;
  /** Reset to the empty selection. */
  clearSelection: () => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgContextProvider({ children }: { children: ReactNode }) {
  const [hierarchy, setHierarchy] = useState<OrgHierarchy | null>(null);
  const [selection, setSelection] = useState<OrgSelection>(EMPTY_ORG_SELECTION);

  const clearSelection = useCallback(
    () => setSelection(EMPTY_ORG_SELECTION),
    [],
  );

  const value = useMemo<OrgContextValue>(
    () => ({ hierarchy, setHierarchy, selection, setSelection, clearSelection }),
    [hierarchy, selection, clearSelection],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

/**
 * Read the org context. Returns `null` when called outside a provider — the
 * signal that the page is NOT org-scoped.
 */
export function useOrgContext(): OrgContextValue | null {
  return useContext(OrgContext);
}

/**
 * The combined `_org` CEL filter for the current page's selection, or `null`
 * when the page isn't org-scoped or nothing is selected. Saved-query read
 * hooks call this and pass it as `orgFilter`.
 */
export function useOrgScopeFilter(): string | null {
  const ctx = useContext(OrgContext);
  return useMemo(() => {
    if (!ctx) return null;
    return buildOrgScopeFilter({
      orgIds: selectedOrgIds(ctx.selection),
      advisorIds: selectedAdvisorIds(ctx.selection),
    });
  }, [ctx]);
}
