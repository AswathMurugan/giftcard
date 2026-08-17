/**
 * Org-hierarchy selection types.
 *
 * Mirrors the platform org-context contract (the `user-org-context-v3` saved
 * query response + the orghierarchy component spec). Reads stay data-agnostic:
 * the selector writes a selection into OrgContext, and the saved-query hooks
 * read it to auto-apply the `_org` filter.
 */

/** A level definition. `level_order` 0 = root (not selectable), 1+ = selectable. */
export interface OrgLevel {
  id: string;
  name: string;
  description: string;
  /** From the API as `levelOrder`; normalised to snake here. */
  level_order: number;
}

/** An organization record (from `accessibleOrgs` / org search). */
export interface Organization {
  id: string;
  name: string;
  code: string;
  level: number;
  levelName?: string;
  parentOrgId: string | null;
  uniqueCode?: string;
  uniquePath?: string;
}

/** An advisor (user with the Advisor role). */
export interface Advisor {
  userId: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  roles: { id: string; name: string }[];
}

/** A resource / rep-code (rep-code selection — wiring deferred). */
export interface Resource {
  resourceId: string;
  resourceType: string | null;
}

/** The hierarchy context seeded from `user-org-context-v3`. */
export interface OrgHierarchy {
  primaryOrg: Organization | null;
  orgLevels: OrgLevel[];
  accessibleOrgs: Organization[];
  rootAccessLevel: number;
}

/** Per-level selection state (keyed by level id). */
export interface LevelSelection {
  levelId: string;
  levelName: string;
  items: Organization[];
}

/** The complete org selection a page operates under. */
export interface OrgSelection {
  /** Per-level selections, keyed by level id. */
  levels: Record<string, LevelSelection>;
  advisors: Advisor[];
  resource: Resource | null;
}

export const EMPTY_ORG_SELECTION: OrgSelection = Object.freeze({
  levels: {},
  advisors: [],
  resource: null,
});

/** Flatten a selection to the org ids used for `_org` scoping (deepest wins). */
export function selectedOrgIds(selection: OrgSelection): string[] {
  const ids: string[] = [];
  for (const lvl of Object.values(selection.levels)) {
    for (const item of lvl.items) ids.push(item.id);
  }
  return ids;
}

/** Flatten a selection to the advisor user ids used for `_org` scoping. */
export function selectedAdvisorIds(selection: OrgSelection): string[] {
  return selection.advisors.map((a) => a.userId);
}
