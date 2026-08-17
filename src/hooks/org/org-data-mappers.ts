/**
 * Pure mappers for the platform org saved-query responses → the selector's
 * domain types. Extracted so they're unit-testable without React/network.
 *
 * Backing platform saved queries (x-jiffy-app-name: platform):
 *   - user-org-context-v3  → hierarchy (primaryOrg, orgLevels, accessibleOrgs)
 *   - advisor_user_list    → advisors (scoped by `_org`)
 */
import type {
  Advisor,
  OrgHierarchy,
  OrgLevel,
  Organization,
} from '@/config/org';

type Json = Record<string, unknown>;

function asArray(v: unknown): Json[] {
  return Array.isArray(v) ? (v as Json[]) : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Map one org record (camelCase from user-org-context-v3). */
export function mapOrganization(o: Json): Organization {
  return {
    id: str(o.id),
    name: str(o.name),
    code: str(o.code),
    level: num(o.level),
    levelName: o.levelName != null ? str(o.levelName) : undefined,
    parentOrgId:
      o.parentOrgId == null ? null : str(o.parentOrgId),
    uniqueCode: o.uniqueCode != null ? str(o.uniqueCode) : undefined,
    uniquePath: o.uniquePath != null ? str(o.uniquePath) : undefined,
  };
}

/** Map one level record (camelCase `levelOrder` → snake `level_order`). */
export function mapOrgLevel(l: Json): OrgLevel {
  return {
    id: str(l.id),
    name: str(l.name),
    description: str(l.description),
    level_order: num(l.levelOrder ?? l.level_order),
  };
}

/**
 * Map the `user-org-context-v3` single-output response into OrgHierarchy.
 * The response is `[{ result: { ... } }]` or `{ result: {...} }` or the bare
 * object — tolerate all three.
 */
export function mapOrgContext(raw: unknown): OrgHierarchy {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const result =
    (first as Json)?.result != null
      ? ((first as Json).result as Json)
      : ((first as Json) ?? {});

  const primaryRaw = result.primaryOrg as Json | undefined;
  return {
    primaryOrg: primaryRaw ? mapOrganization(primaryRaw) : null,
    orgLevels: asArray(result.orgLevels).map(mapOrgLevel),
    accessibleOrgs: asArray(result.accessibleOrgs).map(mapOrganization),
    rootAccessLevel: num(result.rootAccessLevel),
  };
}

/** Map one `advisor_user_list` row → Advisor. */
export function mapAdvisor(a: Json): Advisor {
  const rolesRaw = asArray(a.roles);
  const roles = rolesRaw
    .map((r) => {
      const role = (r.role as Json) ?? r;
      return { id: str(role.id), name: str(role.name) };
    })
    .filter((r) => r.id !== '');
  return {
    userId: str(a.id ?? a.userId),
    firstName: str(a.first_name ?? a.firstName),
    lastName: str(a.last_name ?? a.lastName),
    fullName: a.full_name != null ? str(a.full_name) : undefined,
    roles,
  };
}

/** Map the `advisor_user_list` array response → Advisor[]. */
export function mapAdvisors(raw: unknown): Advisor[] {
  return asArray(raw).map(mapAdvisor);
}

/**
 * Filter accessible orgs to those directly under one of `parentIds`, plus a
 * case-insensitive substring match on the query. Used for level-1 (and as a
 * client-side narrowing for deeper levels seeded from accessibleOrgs).
 */
export function filterOrgs(
  orgs: Organization[],
  levelOrder: number,
  parentIds: string[] | null,
  query: string,
): Organization[] {
  const q = query.trim().toLowerCase();
  return orgs.filter((o) => {
    if (o.level !== levelOrder) return false;
    if (parentIds && parentIds.length > 0) {
      if (!o.parentOrgId || !parentIds.includes(o.parentOrgId)) return false;
    }
    if (q && !`${o.name} ${o.code}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
