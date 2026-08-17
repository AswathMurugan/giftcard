import { describe, it, expect } from 'vitest';
import { buildCategoryGroups } from './NotificationPreferences';
import { humanizeCategory } from './types';
import type { AlertCatalogueItem } from './use-alert-prefs';

function item(
  overrides: Partial<AlertCatalogueItem> & { alert_type: string; category: string },
): AlertCatalogueItem {
  return {
    name: overrides.name ?? overrides.alert_type,
    description: overrides.description ?? '',
    opt_out_allowed: overrides.opt_out_allowed ?? true,
    opted_out: overrides.opted_out ?? false,
    ...overrides,
  };
}

describe('NotificationPreferences', { tags: ['notification-preferences', 'logic'] }, () => {
  describe('humanizeCategory', { tags: ['smoke'] }, () => {
    it('title-cases an underscored key', () => {
      expect(humanizeCategory('account_alerts')).toBe('Account Alerts');
      expect(humanizeCategory('trade')).toBe('Trade');
    });
    it('handles empty input', { tags: ['edge-case'] }, () => {
      expect(humanizeCategory('')).toBe('');
    });
  });

  describe('buildCategoryGroups', { tags: ['important'] }, () => {
    it('returns empty array for no items', { tags: ['edge-case'] }, () => {
      expect(buildCategoryGroups([], {})).toEqual([]);
    });

    it('groups items by category preserving order', () => {
      const groups = buildCategoryGroups(
        [
          item({ alert_type: 'a', category: 'trade' }),
          item({ alert_type: 'b', category: 'account' }),
          item({ alert_type: 'c', category: 'trade' }),
        ],
        {},
      );
      expect(groups.map((g) => g.key)).toEqual(['trade', 'account']);
      expect(groups[0].items).toHaveLength(2);
      expect(groups[1].items).toHaveLength(1);
    });

    it('prefers an explicit category label over the humanized fallback', () => {
      const groups = buildCategoryGroups(
        [item({ alert_type: 'a', category: 'account_alerts' })],
        { account_alerts: 'My Account' },
      );
      expect(groups[0].label).toBe('My Account');
    });

    it('falls back to humanized category label', () => {
      const groups = buildCategoryGroups(
        [item({ alert_type: 'a', category: 'account_alerts' })],
        {},
      );
      expect(groups[0].label).toBe('Account Alerts');
    });

    it('maps catalogue fields onto preference items', () => {
      const groups = buildCategoryGroups(
        [
          item({
            alert_type: 'trade.filled',
            category: 'trade',
            name: 'Trade Filled',
            description: 'When an order fills',
            opt_out_allowed: false,
            opted_out: true,
          }),
        ],
        {},
      );
      expect(groups[0].items[0]).toEqual({
        alertType: 'trade.filled',
        name: 'Trade Filled',
        description: 'When an order fills',
        category: 'trade',
        categoryLabel: 'Trade',
        optOutAllowed: false,
        optedOut: true,
      });
    });
  });
});
