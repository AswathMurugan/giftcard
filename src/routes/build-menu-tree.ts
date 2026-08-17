/**
 * Build the 2-level menu tree from the flat `menu-config` rows.
 *
 * Items link via `parentKey` → `itemKey`; siblings order by `sortOrder`
 * (NULLS LAST, then original position). The rendered rail supports exactly two
 * levels — a top-level item and, when it has descendants, a single collapsible
 * group of children. This module enforces that:
 *
 *  - **Orphans** (a `parentKey` that resolves to no item, directly or up the
 *    chain) are dropped with a `menu-config:orphan` warn.
 *  - **Cycles** (a `parentKey` chain that loops) are dropped with a
 *    `menu-config:cycle` warn.
 *  - **Depth clamp to 2:** any node deeper than level 2 is promoted to level 2
 *    under its depth-1 ancestor, positioned immediately after its former parent
 *    (a pre-order flatten of the sub-tree). One `menu-config:depth-clamped` warn
 *    per clamped sub-tree root (the first node past level 2), not per node.
 *
 * Pure + exported for unit testing.
 */
import { logger } from '@/utils/logger';
import type { MenuConfigItem } from './nav-routes-context';

/** A menu item plus its (already-clamped, depth-2) children. */
export interface MenuTreeNode extends MenuConfigItem {
  children: MenuTreeNode[];
}

const INF = Number.POSITIVE_INFINITY;

export function buildMenuTree(items: MenuConfigItem[]): MenuTreeNode[] {
  // Index by itemKey (first wins; warn on duplicate).
  const byKey = new Map<string, MenuConfigItem>();
  const indexOf = new Map<string, number>();
  items.forEach((item, i) => {
    if (byKey.has(item.itemKey)) {
      logger.warn('menu-config:duplicate-key', { itemKey: item.itemKey });
      return;
    }
    byKey.set(item.itemKey, item);
    indexOf.set(item.itemKey, i);
  });

  // Resolve each node's depth + top-level ancestor; classify orphan / cycle by
  // walking the parentKey chain. A node whose chain passes through a dropped
  // ancestor is naturally flagged too (the walk hits the same break).
  const depthOf = new Map<string, number>();
  for (const key of byKey.keys()) {
    const seen = new Set<string>([key]);
    let cur = byKey.get(key)!.parentKey;
    let depth = 1;
    let bad: 'orphan' | 'cycle' | null = null;
    while (cur) {
      if (seen.has(cur)) {
        bad = 'cycle';
        break;
      }
      const parent = byKey.get(cur);
      if (!parent) {
        bad = 'orphan';
        break;
      }
      seen.add(cur);
      depth += 1;
      cur = parent.parentKey;
    }
    if (bad) {
      logger.warn(`menu-config:${bad}`, { itemKey: key });
      continue;
    }
    depthOf.set(key, depth);
  }

  // Adjacency among surviving nodes (parent → children keys).
  const childrenOf = new Map<string, string[]>();
  for (const key of depthOf.keys()) {
    const parentKey = byKey.get(key)!.parentKey;
    if (parentKey && depthOf.has(parentKey)) {
      const arr = childrenOf.get(parentKey);
      if (arr) arr.push(key);
      else childrenOf.set(parentKey, [key]);
    }
  }

  const sortKeys = (keys: string[]): string[] =>
    keys.slice().sort((a, b) => {
      const sa = byKey.get(a)!.sortOrder ?? INF;
      const sb = byKey.get(b)!.sortOrder ?? INF;
      return sa - sb || (indexOf.get(a)! - indexOf.get(b)!);
    });

  const nodeFor = (key: string, children: MenuTreeNode[]): MenuTreeNode => ({
    ...byKey.get(key)!,
    children,
  });

  // Top-level = surviving depth-1 nodes, ordered.
  const topKeys = sortKeys([...depthOf.keys()].filter((k) => depthOf.get(k) === 1));

  return topKeys.map((topKey) => {
    const flat: MenuTreeNode[] = [];
    // Pre-order over descendants: each becomes a depth-2 leaf; a node at depth 3
    // (the clamp sub-tree root) warns once, deeper descendants flatten silently.
    const walk = (key: string) => {
      for (const child of sortKeys(childrenOf.get(key) ?? [])) {
        if (depthOf.get(child) === 3) {
          logger.warn('menu-config:depth-clamped', { itemKey: child });
        }
        flat.push(nodeFor(child, []));
        walk(child);
      }
    };
    walk(topKey);
    return nodeFor(topKey, flat);
  });
}
