/**
 * Pure cascade-selection logic for the org hierarchy. Extracted so the
 * cascade-reset rules are unit-testable without React.
 *
 * Rules (from the orghierarchy spec):
 *  - Selecting/toggling org(s) at level N clears all DEEPER level selections
 *    plus advisors (they depend on org scope).
 *  - Clearing level N clears everything at level >= N.
 *  - A child level is gated (disabled) until its parent has a selection.
 */
import type {
  LevelSelection,
  OrgLevel,
  OrgSelection,
  Organization,
} from '@/config/org';

/** Selectable levels (level_order >= 1), sorted ascending. */
export function selectableLevels(levels: OrgLevel[]): OrgLevel[] {
  return [...levels]
    .filter((l) => l.level_order >= 1)
    .sort((a, b) => a.level_order - b.level_order);
}

/** Items currently selected at a given level id. */
export function itemsAtLevel(
  selection: OrgSelection,
  levelId: string,
): Organization[] {
  return selection.levels[levelId]?.items ?? [];
}

/** True when `level` should be enabled (its parent level has a selection). */
export function isLevelEnabled(
  selection: OrgSelection,
  levels: OrgLevel[],
  level: OrgLevel,
): boolean {
  const ordered = selectableLevels(levels);
  const idx = ordered.findIndex((l) => l.id === level.id);
  if (idx <= 0) return true; // first selectable level is always enabled
  const parent = ordered[idx - 1];
  return itemsAtLevel(selection, parent.id).length > 0;
}

/** Parent org ids feeding a level's search (the prior level's selection). */
export function parentIdsFor(
  selection: OrgSelection,
  levels: OrgLevel[],
  level: OrgLevel,
): string[] | null {
  const ordered = selectableLevels(levels);
  const idx = ordered.findIndex((l) => l.id === level.id);
  if (idx <= 0) return null;
  const parent = ordered[idx - 1];
  const ids = itemsAtLevel(selection, parent.id).map((o) => o.id);
  return ids.length > 0 ? ids : null;
}

/** Drop selections for every level deeper than `levelOrder`, + advisors. */
function clearDeeper(
  selection: OrgSelection,
  levels: OrgLevel[],
  levelOrder: number,
): OrgSelection {
  const deeper = new Set(
    selectableLevels(levels)
      .filter((l) => l.level_order > levelOrder)
      .map((l) => l.id),
  );
  const nextLevels: Record<string, LevelSelection> = {};
  for (const [id, sel] of Object.entries(selection.levels)) {
    if (!deeper.has(id)) nextLevels[id] = sel;
  }
  return { levels: nextLevels, advisors: [], resource: null };
}

/**
 * Toggle one org at a level (multi-select). Adding/removing resets deeper
 * levels + advisors.
 */
export function toggleOrg(
  selection: OrgSelection,
  levels: OrgLevel[],
  level: OrgLevel,
  org: Organization,
  multiple: boolean,
): OrgSelection {
  const current = itemsAtLevel(selection, level.id);
  const exists = current.some((o) => o.id === org.id);
  const nextItems = exists
    ? current.filter((o) => o.id !== org.id)
    : multiple
      ? [...current, org]
      : [org];

  const base = clearDeeper(selection, levels, level.level_order);
  const nextLevels = { ...base.levels };
  if (nextItems.length === 0) {
    delete nextLevels[level.id];
  } else {
    nextLevels[level.id] = {
      levelId: level.id,
      levelName: level.name,
      items: nextItems,
    };
  }
  return { ...base, levels: nextLevels };
}

/**
 * Org ids of the DEEPEST level that has a selection (advisor scope is the
 * narrowest org context). Falls back to all selected ids if none ordered.
 */
export function selectedOrgIdsDeepest(
  selection: OrgSelection,
  levels: OrgLevel[],
): string[] {
  const ordered = selectableLevels(levels);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const items = itemsAtLevel(selection, ordered[i].id);
    if (items.length > 0) return items.map((o) => o.id);
  }
  return [];
}

/** Remove one org from a level (same cascade-reset as toggle-off). */
export function removeOrg(
  selection: OrgSelection,
  levels: OrgLevel[],
  level: OrgLevel,
  org: Organization,
): OrgSelection {
  return toggleOrg(selection, levels, level, org, true);
}
