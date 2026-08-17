/**
 * Merge the tenant's menu config (v3) onto the app's code-declared nav.
 *
 * v3 is **config-authoritative** for the rail (v2's additive-only is
 * superseded). The rail is:
 *
 *     [ resolved config block, in config sortOrder ]
 *   + [ code items the config did NOT consume, in code order ]
 *
 * Per resolved config item (a `MenuTreeNode` from `buildMenuTree`):
 *
 *  | Kind (linkType / shape)                          | Result                                                    |
 *  |--------------------------------------------------|-----------------------------------------------------------|
 *  | `flyout` (flyoutRef in registry)                 | flyout rail item (`flyoutRef`); config label/icon/pos win |
 *  | `flyout` (flyoutRef NOT in registry)             | fallback to its screen/url target (+ warn)                |
 *  | `link` (url)                                     | `<a href>` item (`href`, `openIn`)                        |
 *  | `screen`, appDefinitionKey ≠ current app         | cross-app item (`external`, `navigateCrossApp`)           |
 *  | `screen`, current app, slug ∈ allSlugs           | local `NavLink`; CONSUMES the code entry (label/icon: config wins, per-field fallback; permission inherited) |
 *  | `screen`, current app, slug ∉ allSlugs           | drop + warn                                               |
 *  | any, `hidden: true`                              | consume the matching code entry, render nothing           |
 *
 * A consumed code entry does not reappear in the appended tail. `hidden` on a
 * self-app screen consumes without rendering. Permission gates are inherited
 * from the consumed code entry — config cannot set or bypass them in v1.
 *
 * Pure (no globals beyond `logger`) → unit-testable like `resolveRailColors`.
 */
import { logger } from '@/utils/logger';
import { BUILT_IN_LOCAL_ROUTE_SLUGS } from './built-in-routes';
import type { MenuTreeNode } from './build-menu-tree';
import type { NavRouteEntry } from './nav-routes-context';

/** A route `path` reduced to its slug (the `path` without a leading `/`). */
export function slugOf(path: string): string {
  return path.replace(/^\/+/, '');
}

/** Stable identity for a cross-app target — dedupes config items vs. code ones. */
export function externalKey(appKey: string, screen: string): string {
  return `${appKey}\u0000${screen}`;
}

/** Synthetic sidebar path (React key) for a cross-app screen item. */
export function externalPath(appKey: string, screen: string): string {
  return `__external__/${appKey}/${screen}`;
}

/** Synthetic sidebar path (React key) for a plain-URL link item. */
export function linkPath(url: string): string {
  return `__link__/${url}`;
}

/** Synthetic sidebar path (React key) for a quick-panel (flyout) item. */
export function flyoutPath(ref: string): string {
  return `__flyout__/${ref}`;
}

/** Synthetic sidebar path (React key) for a collapsible group node. */
export function groupPath(itemKey: string): string {
  return `__group__/${itemKey}`;
}

/**
 * Build the `window.open` features string for an `openIn: 'new_window'` item.
 * Always carries `noopener`. Pure + exported for testing.
 */
export function buildWindowFeatures(width?: number, height?: number): string {
  const parts: string[] = [];
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    parts.push(`width=${Math.round(width)}`);
  }
  if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
    parts.push(`height=${Math.round(height)}`);
  }
  parts.push('noopener');
  return parts.join(',');
}

export interface MergeMenuOptions {
  /** This app's `app_definition_key` — for self-app vs cross-app screen items. */
  currentAppKey?: string;
  /** ALL local route slugs (incl. hideFromNav) — for self-app slug validation. */
  allSlugs?: ReadonlySet<string>;
  /** Registered flyout ids — for resolving `flyoutRef` items. */
  flyoutIds?: ReadonlySet<string>;
}

/** The outcome of resolving one leaf config item. */
interface LeafResolution {
  /** Rail entry to render, or null (dropped / hidden). */
  entry: NavRouteEntry | null;
  /** A code map key (slug or externalKey) this item consumes, or null. */
  consume: string | null;
}

/** Common per-item fields threaded onto every produced entry. */
function baseFields(item: MenuTreeNode): Partial<NavRouteEntry> {
  return {
    openIn: item.openIn,
    windowWidth: item.windowWidth,
    windowHeight: item.windowHeight,
    order: item.sortOrder,
  };
}

/** Resolve ONE leaf menu item to a rail entry + the code key it consumes. */
function resolveLeaf(
  item: MenuTreeNode,
  opts: MergeMenuOptions,
  codeBySlug: Map<string, NavRouteEntry>,
): LeafResolution {
  const base = baseFields(item);

  // FLYOUT — render via the registry; fall back to screen/url if unregistered.
  if (item.flyoutRef) {
    // hidden → render nothing (a flyout is not a code nav entry, nothing to
    // consume). Checked before the registry lookup + fallthrough.
    if (item.hidden) return { entry: null, consume: null };
    if (opts.flyoutIds?.has(item.flyoutRef)) {
      return {
        entry: {
          path: flyoutPath(item.flyoutRef),
          label: item.name,
          icon: item.icon ?? '',
          flyoutRef: item.flyoutRef,
          ...base,
        },
        consume: null,
      };
    }
    logger.warn('menu-config:flyout-unresolved', {
      itemKey: item.itemKey,
      flyoutRef: item.flyoutRef,
    });
    // fall through to screen/url target
  }

  // LINK — plain external URL.
  if (item.url) {
    // hidden → render nothing (a link has no code entry to consume).
    if (item.hidden) return { entry: null, consume: null };
    return {
      entry: {
        path: linkPath(item.url),
        label: item.name || item.url,
        icon: item.icon ?? '',
        href: item.url,
        ...base,
      },
      consume: null,
    };
  }

  // SCREEN — cross-app or self-app local.
  if (item.screen) {
    const slug = slugOf(item.screen);
    const target = item.appDefinitionKey;
    const hasDeclaredLocalRoute = opts.allSlugs?.has(slug) === true;
    const hasLocalRoute =
      hasDeclaredLocalRoute || BUILT_IN_LOCAL_ROUTE_SLUGS.has(slug);
    // currentAppKey is normally present after auth. If it is temporarily absent,
    // an EXPLICIT target must remain cross-app: local route evidence cannot prove
    // that target is this app until its key resolves. A targetless legacy row may
    // still use the local slug as evidence.
    const isLocal = opts.currentAppKey
      ? target === opts.currentAppKey
      : !target && hasDeclaredLocalRoute;

    if (!isLocal) {
      const consume = externalKey(target, slug);
      if (item.hidden) return { entry: null, consume };
      return {
        entry: {
          path: externalPath(target, slug),
          label: item.name || slug,
          icon: item.icon ?? '',
          external: { appKey: target, screen: slug },
          ...base,
        },
        consume,
      };
    }

    // Self-app local screen — must match a known route slug (incl. hideFromNav).
    if (!hasLocalRoute) {
      logger.warn('menu-config:unknown-slug', { itemKey: item.itemKey, screen: slug });
      return { entry: null, consume: null };
    }
    const code = codeBySlug.get(slug);
    if (item.hidden) return { entry: null, consume: slug };
    return {
      entry: {
        path: `/${slug}`,
        // Config wins; fall back per-field to the consumed code entry.
        label: item.name || code?.label || slug,
        icon: item.icon || code?.icon || '',
        // Permission gate + helper-menu flag are inherited from code (v1).
        permission: code?.permission,
        hideFromHelper: code?.hideFromHelper,
        ...base,
      },
      consume: slug,
    };
  }

  // Nothing renderable (e.g. an unregistered flyout with no screen/url target).
  return { entry: null, consume: null };
}

/**
 * Merge the code-declared nav with the tenant's menu tree. Returns a new
 * `NavRouteEntry[]` (or the original `codeNav` when there's nothing to apply);
 * never mutates its inputs. See the module doc for the full semantics.
 */
export function mergeMenu(
  codeNav: NavRouteEntry[],
  tree: MenuTreeNode[] | null | undefined,
  opts: MergeMenuOptions = {},
): NavRouteEntry[] {
  if (!tree || tree.length === 0) return codeNav;

  // Index local code entries by slug (for self-app consume + field inheritance).
  const codeBySlug = new Map<string, NavRouteEntry>();
  for (const route of codeNav) {
    if (!route.external && !route.href) codeBySlug.set(slugOf(route.path), route);
  }

  const consumed = new Set<string>();
  const configEntries: NavRouteEntry[] = [];

  for (const node of tree) {
    if (node.children.length > 0) {
      // A parent with children renders as a group HEADER only — its own
      // screen/url/flyout target is ignored. Debug-log so authors aren't
      // mystified when a group's own target does nothing.
      if (node.screen || node.url || node.flyoutRef) {
        logger.debug('menu-config:group-target-ignored', { itemKey: node.itemKey });
      }
      // Collapsible group: resolve children (each may consume a code entry).
      const childEntries: NavRouteEntry[] = [];
      for (const child of node.children) {
        const { entry, consume } = resolveLeaf(child, opts, codeBySlug);
        if (consume) consumed.add(consume);
        if (entry) childEntries.push(entry);
      }
      if (childEntries.length > 0) {
        configEntries.push({
          path: groupPath(node.itemKey),
          label: node.name,
          icon: node.icon ?? '',
          children: childEntries,
        });
      }
      continue;
    }

    const { entry, consume } = resolveLeaf(node, opts, codeBySlug);
    if (consume) consumed.add(consume);
    if (entry) configEntries.push(entry);
  }

  // Unconsumed code items follow the config block, in code order.
  const appended = codeNav.filter((route) => {
    const key = route.external
      ? externalKey(route.external.appKey, route.external.screen)
      : slugOf(route.path);
    return !consumed.has(key);
  });

  if (configEntries.length === 0 && appended.length === codeNav.length) return codeNav;
  return [...configEntries, ...appended];
}
