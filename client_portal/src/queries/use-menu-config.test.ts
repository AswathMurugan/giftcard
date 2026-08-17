import { describe, it, expect } from 'vitest';
import {
  parseMenuConfig,
  mapMenuRow,
  isUsableMenuItem,
  filterSidebarItems,
  buildMenuConfigExecuteRequest,
} from './use-menu-config';
import type { MenuConfigItem } from '@/routes/nav-routes-context';

const CURRENT_APP = 'servicing_x';

/** A menu-config-merged row (typed snake_case columns). */
const SCREEN_ROW = {
  item_key: 'sr',
  app_definition_key: CURRENT_APP,
  name: 'Service Requests',
  icon: 'icon_-Tb_clipboard_list',
  screen: 'service-requests',
  link_type: 'screen',
  open_in: 'current_tab',
  parent_key: '',
  sort_order: 1,
  hidden: false,
};
const LINK_ROW = {
  item_key: 'support',
  app_definition_key: CURRENT_APP,
  name: 'Support',
  url: 'https://support.jiffy.ai',
  link_type: 'link',
  open_in: 'new_tab',
  sort_order: 2,
};
const FLYOUT_ROW = {
  item_key: 'srq',
  app_definition_key: CURRENT_APP,
  name: 'SR Quick',
  flyout_ref: 'sr-quick',
  screen: 'service-requests',
  link_type: 'flyout',
  window_width: '800',
  window_height: '600',
  sort_order: 3,
};

describe('use-menu-config parser', { tags: ['menu-config', 'logic'] }, () => {
  describe('mapMenuRow (snake → camel)', { tags: ['important'] }, () => {
    it('maps every column to its camelCase field with coercion', () => {
      const item = mapMenuRow(FLYOUT_ROW)!;
      expect(item).toMatchObject({
        itemKey: 'srq',
        appDefinitionKey: CURRENT_APP,
        name: 'SR Quick',
        flyoutRef: 'sr-quick',
        screen: 'service-requests',
        linkType: 'flyout',
        windowWidth: 800, // numeric string coerced
        windowHeight: 600,
        sortOrder: 3,
      });
    });

    it('maps a valid menu_type enum + description; drops an invalid menu_type', () => {
      const ok = mapMenuRow({
        item_key: 'k',
        app_definition_key: CURRENT_APP,
        name: 'K',
        screen: 's',
        menu_type: 'header',
        description: 'Top-nav entry',
      })!;
      expect(ok.menuType).toBe('header');
      expect(ok.description).toBe('Top-nav entry');
      // Unknown menu_type → undefined (defaults to sidebar downstream).
      expect(
        mapMenuRow({
          item_key: 'k',
          app_definition_key: CURRENT_APP,
          name: 'K',
          screen: 's',
          menu_type: 'group',
        })!.menuType,
      ).toBeUndefined();
    });

    it('requires both item_key and app_definition_key', { tags: ['edge-case'] }, () => {
      expect(mapMenuRow({ app_definition_key: CURRENT_APP, name: 'x', screen: 'y' })).toBeNull();
      expect(mapMenuRow({ item_key: 'x', name: 'x', screen: 'y' })).toBeNull();
    });

    it('defaults name to itemKey when name is blank', { tags: ['edge-case'] }, () => {
      expect(
        mapMenuRow({ item_key: 'k', app_definition_key: CURRENT_APP, screen: 's' })!.name,
      ).toBe('k');
    });
  });

  describe('isUsableMenuItem', { tags: ['important'] }, () => {
    it('requires itemKey and one of screen/url/flyoutRef', () => {
      const base = { appDefinitionKey: CURRENT_APP, name: 'a' };
      expect(isUsableMenuItem({ ...base, itemKey: 'a', screen: 's' })).toBe(true);
      expect(isUsableMenuItem({ ...base, itemKey: 'a', url: 'u' })).toBe(true);
      expect(isUsableMenuItem({ ...base, itemKey: 'a', flyoutRef: 'f' })).toBe(true);
      expect(isUsableMenuItem({ ...base, itemKey: 'a' })).toBe(false);
      expect(isUsableMenuItem({ ...base, itemKey: '', screen: 's' })).toBe(false);
      expect(
        isUsableMenuItem({ itemKey: 'a', name: 'a', screen: 's' } as MenuConfigItem),
      ).toBe(false);
      expect(
        isUsableMenuItem({
          itemKey: 'a',
          appDefinitionKey: 7,
          name: 'a',
          screen: 's',
        } as unknown as MenuConfigItem),
      ).toBe(false);
    });

    it('rejects screen + url together (mutually exclusive)', { tags: ['edge-case'] }, () => {
      expect(
        isUsableMenuItem({
          itemKey: 'a',
          appDefinitionKey: CURRENT_APP,
          name: 'a',
          screen: 's',
          url: 'u',
        }),
      ).toBe(false);
    });

    it('ignores link_type (not a reliable kind flag) — validates on fields only', { tags: ['edge-case'] }, () => {
      // Real seeded flyout: link_type "screen" but it's a flyout (flyout_ref set).
      expect(
        isUsableMenuItem({
          itemKey: 'sr',
          appDefinitionKey: CURRENT_APP,
          name: 'SR',
          linkType: 'screen',
          flyoutRef: 'sr-quick',
          screen: 's',
        }),
      ).toBe(true);
      // Real seeded cross-app: link_type "external" with a screen.
      expect(
        isUsableMenuItem({
          itemKey: 'o',
          appDefinitionKey: 'accountonboarding_x',
          name: 'O',
          linkType: 'external',
          screen: 'account-onboarding',
        }),
      ).toBe(true);
    });
  });

  describe('filterSidebarItems', { tags: ['important'] }, () => {
    it('keeps sidebar + unset menu_type, drops other surfaces', () => {
      const items: MenuConfigItem[] = [
        { itemKey: 'a', appDefinitionKey: CURRENT_APP, name: 'A', screen: 'a', menuType: 'sidebar' },
        { itemKey: 'b', appDefinitionKey: CURRENT_APP, name: 'B', screen: 'b' }, // unset → sidebar
        { itemKey: 'c', appDefinitionKey: CURRENT_APP, name: 'C', screen: 'c', menuType: 'header' },
        { itemKey: 'd', appDefinitionKey: CURRENT_APP, name: 'D', url: 'https://x', menuType: 'mobile' },
      ];
      expect(filterSidebarItems(items).map((i) => i.itemKey)).toEqual(['a', 'b']);
    });
  });

  describe('deployed menu-config-list rows', { tags: ['important', 'smoke'] }, () => {
    // Representative tenant-global rows returned by the deployed merged query.
    const DEPLOYED = [
      {
        item_key: 'sr-quick',
        app_definition_key: 'servicing_6a34ea6d30da3a9818bf1854',
        name: 'Service Requests',
        icon: 'icon_-Tb_clipboard_list',
        screen: 'service-requests',
        flyout_ref: 'sr-quick',
        link_type: 'screen',
        meta: { kind: 'flyout' },
        open_in: null,
        parent_key: null,
        sort_order: 1,
        hidden: false,
      },
      {
        item_key: 'sr-configure',
        app_definition_key: 'servicing_6a34ea6d30da3a9818bf1854',
        name: 'Configure Requests',
        icon: 'icon_-Tb_adjustments',
        screen: 'sr-configure',
        flyout_ref: null,
        link_type: 'screen',
        sort_order: 2,
        hidden: false,
      },
      {
        item_key: 'account-onboarding',
        app_definition_key: 'accountonboarding_6a3bdd50ada34bbb66f6948a',
        name: 'Account Onboarding',
        icon: 'icon_-Tb_user_plus',
        screen: 'account-onboarding',
        flyout_ref: null,
        link_type: 'external',
        sort_order: 3,
        hidden: false,
      },
    ];

    it('keeps all three real rows and maps every column', () => {
      const items = parseMenuConfig(DEPLOYED)!;
      expect(items.map((i) => i.itemKey)).toEqual(['sr-quick', 'sr-configure', 'account-onboarding']);
      // flyout row: flyoutRef drives kind (link_type "screen" ignored)
      expect(items[0].flyoutRef).toBe('sr-quick');
      expect(items[1].appDefinitionKey).toBe('servicing_6a34ea6d30da3a9818bf1854');
      expect(items[2].appDefinitionKey).toBe('accountonboarding_6a3bdd50ada34bbb66f6948a');
    });

    it('passes meta through under the camelCase `meta` field', () => {
      const items = parseMenuConfig(DEPLOYED)!;
      expect(items[0].meta).toEqual({ kind: 'flyout' });
      expect(items[1].meta).toBeUndefined();
    });
  });

  describe('parseMenuConfig', { tags: ['important', 'smoke'] }, () => {
    it('maps + keeps valid rows (screen, link, flyout)', () => {
      const items = parseMenuConfig([SCREEN_ROW, LINK_ROW, FLYOUT_ROW])!;
      expect(items.map((i) => i.itemKey)).toEqual(['sr', 'support', 'srq']);
      expect(items[0].appDefinitionKey).toBe(CURRENT_APP);
      expect(items[1].url).toBe('https://support.jiffy.ai');
    });

    it('parses the same rows delivered as a JSON string', () => {
      expect(parseMenuConfig(JSON.stringify([SCREEN_ROW]))).toHaveLength(1);
    });

    it('accepts an { items: [...] } envelope (defensive)', () => {
      expect(parseMenuConfig({ items: [LINK_ROW] })).toHaveLength(1);
    });

    it('drops invalid rows (no target / no item_key)', { tags: ['edge-case'] }, () => {
      const items = parseMenuConfig([
        SCREEN_ROW,
        { item_key: 'bad', name: 'no target' },
        { name: 'no key', screen: 's' },
      ])!;
      expect(items.map((i) => i.itemKey)).toEqual(['sr']);
    });

    it('returns [] for an empty payload, undefined for malformed structure', { tags: ['edge-case'] }, () => {
      expect(parseMenuConfig([])).toEqual([]);
      expect(parseMenuConfig({ items: [] })).toEqual([]);
      expect(parseMenuConfig(null)).toBeUndefined();
      expect(parseMenuConfig('{not json')).toBeUndefined();
      expect(parseMenuConfig({ foo: 'bar' })).toBeUndefined();
    });
  });

  describe('request construction', { tags: ['important', 'smoke'] }, () => {
    it('sends only the authenticated user in the JSON request body', () => {
      const request = buildMenuConfigExecuteRequest('user id/7');
      expect(request.url).toBe('/saved-queries/menu-config-merged/execute');
      expect(request.body).toEqual({ user: 'user id/7' });
    });
  });
});
