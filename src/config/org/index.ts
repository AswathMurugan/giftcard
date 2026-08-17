/**
 * Org-scoping public API.
 *
 * Wrap an org-scoped page in `<OrgContextProvider>` and drop
 * `<OrgHierarchySelector/>` on it (from `@/components/org`). Saved-query read
 * hooks then auto-apply the `_org` filter from the user's selection. Pass
 * `orgScoped={false}` to a hook to exclude one query.
 */
export {
  OrgContextProvider,
  useOrgContext,
  useOrgScopeFilter,
} from './OrgContextProvider';
export {
  EMPTY_ORG_SELECTION,
  selectedOrgIds,
  selectedAdvisorIds,
  type OrgLevel,
  type Organization,
  type Advisor,
  type Resource,
  type OrgHierarchy,
  type LevelSelection,
  type OrgSelection,
} from './types';
