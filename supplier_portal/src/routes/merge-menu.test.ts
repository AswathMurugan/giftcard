import { describe, it, expect, vi } from 'vitest';
import {
  mergeMenu,
  buildWindowFeatures,
  externalPath,
  linkPath,
  flyoutPath,
  slugOf,
} from './merge-menu';
import { buildMenuTree } from './build-menu-tree';
import type { MenuConfigItem, NavRouteEntry } from './nav-routes-context';
import { logger } from '@/utils/logger';

const CODE_NAV: NavRouteEntry[] = [
  { path: '/clients', label: 'Clients', icon: 'icon_-Tb_users', permission: 'clients' },
  { path: '/accounts', label: 'Accounts', icon: 'icon_-Tb_wallet' },
];
const CURRENT = 'servicing_x';

/** Build the tree the layout would pass to mergeMenu. */
function tree(items: MenuConfigItem[]) {
  return buildMenuTree(items);
}
function mi(itemKey: string, extra: Partial<MenuConfigItem> = {}): MenuConfigItem {
  return { itemKey, appDefinitionKey: CURRENT, name: itemKey, ...extra };
}

describe('merge-menu v3', { tags: ['layout', 'menu-config', 'logic'] }, () => {
  describe('helpers', { tags: ['smoke'] }, () => {
    it('slugOf strips leading slashes', () => {
      expect(slugOf('/service-requests')).toBe('service-requests');
    });
    it('buildWindowFeatures builds a noopener feature string', () => {
      expect(buildWindowFeatures(800, 600)).toBe('width=800,height=600,noopener');
      expect(buildWindowFeatures()).toBe('noopener');
      expect(buildWindowFeatures(0, -5)).toBe('noopener');
      expect(buildWindowFeatures(640.7)).toBe('width=641,noopener');
    });
  });

  describe('no config → code nav unchanged', { tags: ['important'] }, () => {
    it('returns the SAME array for empty tree', { tags: ['edge-case'] }, () => {
      expect(mergeMenu(CODE_NAV, [])).toBe(CODE_NAV);
      expect(mergeMenu(CODE_NAV, null)).toBe(CODE_NAV);
      expect(mergeMenu(CODE_NAV, undefined)).toBe(CODE_NAV);
    });
  });

  describe('link items', { tags: ['important'] }, () => {
    it('renders a link as an href entry carrying openIn + window dims', () => {
      const items = [
        mi('support', {
          appDefinitionKey: 'support_app',
          name: 'Support',
          url: 'https://support.jiffy.ai',
          icon: 'icon_-Tb_help',
          linkType: 'link',
          openIn: 'new_window',
          windowWidth: 900,
          windowHeight: 700,
          sortOrder: 1,
        }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT });
      const link = result[0];
      expect(link.path).toBe(linkPath('https://support.jiffy.ai'));
      expect(link.href).toBe('https://support.jiffy.ai');
      expect(link.openIn).toBe('new_window');
      expect(link.windowWidth).toBe(900);
      expect(link.external).toBeUndefined();
      // Config block first, then all (unconsumed) code items.
      expect(result.map((r) => r.path)).toEqual([
        linkPath('https://support.jiffy.ai'),
        '/clients',
        '/accounts',
      ]);
    });
  });

  describe('cross-app screen', { tags: ['important'] }, () => {
    it('renders a screen for another app as a cross-app external item', () => {
      const items = [
        mi('onb', {
          name: 'Onboarding',
          screen: 'account-onboarding',
          appDefinitionKey: 'onboard_abc',
          linkType: 'screen',
        }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT });
      expect(result[0].path).toBe(externalPath('onboard_abc', 'account-onboarding'));
      expect(result[0].external).toEqual({ appKey: 'onboard_abc', screen: 'account-onboarding' });
    });

    it('consumes a code ExternalNavItem with the same (appKey, screen)', () => {
      const codeNav: NavRouteEntry[] = [
        { path: '/dash', label: 'Dash', icon: 'i' },
        {
          path: externalPath('onboard_abc', 'account-onboarding'),
          label: 'Onboarding (code)',
          icon: 'i',
          external: { appKey: 'onboard_abc', screen: 'account-onboarding' },
        },
      ];
      const items = [
        mi('onb', {
          name: 'Onboarding (config)',
          screen: 'account-onboarding',
          appDefinitionKey: 'onboard_abc',
        }),
      ];
      const result = mergeMenu(codeNav, tree(items), { currentAppKey: CURRENT });
      const onb = result.filter((r) => r.external?.appKey === 'onboard_abc');
      expect(onb).toHaveLength(1);
      expect(onb[0].label).toBe('Onboarding (config)');
      expect(result.map((r) => r.path)).toEqual([
        externalPath('onboard_abc', 'account-onboarding'),
        '/dash',
      ]);
    });
  });

  describe('self-app screen (consume semantics)', { tags: ['important'] }, () => {
    const allSlugs = new Set(['clients', 'accounts', 'service-requests']);

    it('renders a self-app screen as a local NavLink and consumes the code entry', () => {
      const items = [mi('c', { name: 'My Clients', screen: 'clients', sortOrder: 1 })];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT, allSlugs });
      // config item first (position from config), code /clients consumed (not re-appended)
      expect(result.map((r) => r.path)).toEqual(['/clients', '/accounts']);
      expect(result[0].label).toBe('My Clients');
    });

    it('inherits icon (per-field fallback) + permission from the consumed code entry', () => {
      const items = [mi('c', { name: 'Clients', screen: 'clients' })]; // no icon in config
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT, allSlugs });
      const entry = result.find((r) => r.path === '/clients')!;
      expect(entry.icon).toBe('icon_-Tb_users'); // fell back to code icon
      expect(entry.permission).toBe('clients'); // inherited (config can't set/bypass)
    });

    it('treats appDefinitionKey === current app as self-app local', () => {
      const items = [mi('c', { name: 'Clients', screen: 'clients' })];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT, allSlugs });
      expect(result[0].path).toBe('/clients');
      expect(result[0].external).toBeUndefined();
    });

    it('uses allSlugs for a targetless legacy item while the current app key is unavailable', () => {
      const items = [
        mi('c', {
          appDefinitionKey: '',
          name: 'Clients',
          screen: 'clients',
        }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), { allSlugs });
      expect(result[0].path).toBe('/clients');
      expect(result[0].external).toBeUndefined();
    });

    it('keeps an explicit preference target cross-app until currentAppKey resolves', () => {
      const items = [
        mi('preferences', {
          appDefinitionKey: 'another_app',
          name: 'Other Preferences',
          screen: 'preference',
        }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), {
        allSlugs: new Set(['preference']),
      });
      expect(result[0].external).toEqual({
        appKey: 'another_app',
        screen: 'preference',
      });
    });

    it('preserves the row app as cross-app when current app key and local slug evidence are absent', () => {
      const items = [
        mi('onb', {
          appDefinitionKey: 'onboard_abc',
          name: 'Onboarding',
          screen: 'account-onboarding',
        }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), { allSlugs });
      expect(result[0].external).toEqual({
        appKey: 'onboard_abc',
        screen: 'account-onboarding',
      });
    });

    it('validates against ALL slugs incl. hideFromNav (service-requests not in code nav)', () => {
      const items = [mi('sr', { name: 'Service Requests', screen: 'service-requests' })];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT, allSlugs });
      expect(result[0].path).toBe('/service-requests');
    });

    it('recognizes the starter-owned preference route without a PrivateApp slug', () => {
      const items = [mi('preferences', { name: 'Preferences', screen: 'preference' })];
      const result = mergeMenu(CODE_NAV, tree(items), {
        currentAppKey: CURRENT,
        allSlugs: new Set(),
      });
      expect(result[0]).toMatchObject({
        path: '/preference',
        label: 'Preferences',
      });
    });

    it('drops + warns a self-app screen whose slug is unknown', { tags: ['edge-case'] }, () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      const items = [mi('x', { name: 'Ghost', screen: 'does-not-exist' })];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT, allSlugs });
      expect(result).toBe(CODE_NAV); // nothing configured, nothing consumed
      expect(warn).toHaveBeenCalledWith('menu-config:unknown-slug', {
        itemKey: 'x',
        screen: 'does-not-exist',
      });
      warn.mockRestore();
    });

    it('hidden: true consumes the code entry and renders nothing', () => {
      const items = [mi('c', { name: 'Clients', screen: 'clients', hidden: true })];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT, allSlugs });
      // /clients consumed + not rendered; only /accounts remains.
      expect(result.map((r) => r.path)).toEqual(['/accounts']);
    });
  });

  describe('hidden for link + flyout kinds', { tags: ['important', 'edge-case'] }, () => {
    it('a hidden LINK renders nothing (no consume)', () => {
      const items = [mi('s', { name: 'Support', url: 'https://x.dev', hidden: true })];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT });
      expect(result).toBe(CODE_NAV); // nothing added, nothing consumed
    });

    it('a hidden FLYOUT renders nothing even when its ref is registered', () => {
      const items = [mi('q', { name: 'Quick', flyoutRef: 'sr-quick', hidden: true })];
      const result = mergeMenu(CODE_NAV, tree(items), {
        currentAppKey: CURRENT,
        flyoutIds: new Set(['sr-quick']),
      });
      expect(result).toBe(CODE_NAV);
    });
  });

  describe('flyout items', { tags: ['important'] }, () => {
    const allSlugs = new Set(['service-requests']);
    it('renders a flyout entry when the ref is registered', () => {
      const items = [
        mi('srq', {
          appDefinitionKey: 'servicing_elsewhere',
          name: 'Service Requests',
          icon: 'icon_-Tb_clipboard_list',
          flyoutRef: 'sr-quick',
          linkType: 'flyout',
        }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), {
        currentAppKey: CURRENT,
        allSlugs,
        flyoutIds: new Set(['sr-quick']),
      });
      expect(result[0].path).toBe(flyoutPath('sr-quick'));
      expect(result[0].flyoutRef).toBe('sr-quick');
      expect(result[0].external).toBeUndefined();
    });

    it('falls back to the screen target when the flyout ref is unregistered', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      const items = [
        mi('srq', { name: 'Service Requests', flyoutRef: 'sr-quick', screen: 'service-requests' }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), {
        currentAppKey: CURRENT,
        allSlugs,
        flyoutIds: new Set(), // not registered
      });
      expect(result[0].path).toBe('/service-requests'); // fell back to screen
      expect(result[0].flyoutRef).toBeUndefined();
      expect(warn).toHaveBeenCalledWith('menu-config:flyout-unresolved', {
        itemKey: 'srq',
        flyoutRef: 'sr-quick',
      });
      warn.mockRestore();
    });

    it('uses appDefinitionKey for a cross-app screen fallback', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      const items = [
        mi('onb', {
          appDefinitionKey: 'onboard_abc',
          name: 'Onboarding',
          flyoutRef: 'onboarding-quick',
          screen: 'account-onboarding',
        }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), {
        currentAppKey: CURRENT,
        allSlugs,
        flyoutIds: new Set(),
      });
      expect(result[0].external).toEqual({
        appKey: 'onboard_abc',
        screen: 'account-onboarding',
      });
      warn.mockRestore();
    });
  });

  describe('groups (2-level)', { tags: ['important'] }, () => {
    it('renders a parent with children as a group node', () => {
      const allSlugs = new Set(['a', 'b']);
      const items = [
        mi('grp', { name: 'Group', icon: 'icon_-Tb_folder' }),
        mi('a', { name: 'A', screen: 'a', parentKey: 'grp', sortOrder: 1 }),
        mi('b', { name: 'B', screen: 'b', parentKey: 'grp', sortOrder: 2 }),
      ];
      const result = mergeMenu(CODE_NAV, tree(items), { currentAppKey: CURRENT, allSlugs });
      const group = result[0];
      expect(group.label).toBe('Group');
      expect(group.children?.map((c) => c.path)).toEqual(['/a', '/b']);
    });
  });
});
