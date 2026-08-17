import { describe, it, expect } from 'vitest';
import {
  extractCategorySegment,
  findAuthenticatorWithAuthUrl,
  getPartnerInitials,
  groupPartnersIntoCategories,
  splitConfigs,
} from './partner-modules-api';
import type {
  PartnerModule,
  PartnerModuleConfig,
  PartnerModuleWithConfigs,
} from '@/components/shared/connected-apps/types';

describe('partner-modules-api', { tags: ['connected-apps', 'logic'] }, () => {
  describe('extractCategorySegment', { tags: ['edge-case'] }, () => {
    it('returns empty string for empty input', () => {
      expect(extractCategorySegment('')).toBe('');
    });
    it('returns the last dotted segment', () => {
      expect(extractCategorySegment('partner.category.banking')).toBe('banking');
      expect(extractCategorySegment('banking')).toBe('banking');
    });
  });

  describe('getPartnerInitials', { tags: ['smoke'] }, () => {
    it('uses first letters of the first two words', () => {
      expect(getPartnerInitials('Bank of America')).toBe('BO');
      expect(getPartnerInitials('Charles Schwab')).toBe('CS');
    });
    it('falls back to first two chars for one word', () => {
      expect(getPartnerInitials('Chase')).toBe('CH');
    });
  });

  describe('findAuthenticatorWithAuthUrl', { tags: ['important'] }, () => {
    it('returns null when no authenticator has an auth url', () => {
      const mod: PartnerModule = {
        name: 'p',
        label: 'P',
        app_definition: 'a',
        app_definition_key: 'a',
        Properties: { authenticators: {} },
      };
      expect(findAuthenticatorWithAuthUrl(mod)).toBeNull();
    });
    it('finds the authenticator carrying user_authorization_url', () => {
      const mod: PartnerModule = {
        name: 'p',
        label: 'P',
        app_definition: 'a',
        app_definition_key: 'a',
        Properties: {
          authenticators: {
            oauth: {
              parameters: {
                user_authorization_url: {
                  label: 'url',
                  datatype: 'string',
                  value: 'https://auth.example.com',
                  is_secret: false,
                  editable_by_end_user: false,
                  editable_by_platform_user: false,
                  visible: true,
                },
              },
            },
          },
        },
      };
      expect(findAuthenticatorWithAuthUrl(mod)).toEqual({
        authenticatorName: 'oauth',
        userAuthorizationUrl: 'https://auth.example.com',
      });
    });
  });

  describe('splitConfigs', { tags: ['important'] }, () => {
    const configs: PartnerModuleConfig[] = [
      {
        configId: 'default-1',
        authenticatorName: 'oauth',
        authenticatorLabel: 'OAuth',
        parameters: { user_authorization_url: 'https://auth' },
      },
      {
        configId: 'acct-1',
        authenticatorName: 'oauth',
        authenticatorLabel: 'OAuth',
        displayName: 'My Account',
        email: 'me@example.com',
      },
      {
        configId: 'other',
        authenticatorName: 'different',
        authenticatorLabel: 'Other',
      },
    ];

    it('separates the default config from connected accounts', () => {
      const { defaultConfig, accounts } = splitConfigs(configs, 'oauth');
      expect(defaultConfig?.configId).toBe('default-1');
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        id: 'acct-1',
        name: 'My Account',
        description: 'me@example.com',
        status: 'connected',
        isNameProviderManaged: true,
        isDescriptionProviderManaged: true,
      });
    });

    it('ignores configs for other authenticators', () => {
      const { accounts } = splitConfigs(configs, 'oauth');
      expect(accounts.find((a) => a.id === 'other')).toBeUndefined();
    });
  });

  describe('groupPartnersIntoCategories', { tags: ['logic'] }, () => {
    function makeItem(
      name: string,
      category: string,
    ): PartnerModuleWithConfigs {
      return {
        partner_module_application: {
          name,
          label: name,
          app_definition: 'a',
          app_definition_key: 'a',
        },
        partner_module: {
          name,
          label: name,
          app_definition: 'a',
          app_definition_key: 'a',
          Properties: {
            authenticators: {
              oauth: {
                parameters: {
                  user_authorization_url: {
                    label: 'url',
                    datatype: 'string',
                    value: 'https://auth',
                    is_secret: false,
                    editable_by_end_user: false,
                    editable_by_platform_user: false,
                    visible: true,
                  },
                },
              },
            },
            partner_category_implementations: category
              ? [{ partner_category: category }]
              : [],
          },
        },
        configs: [],
      };
    }

    it('returns empty array for no items', { tags: ['edge-case'] }, () => {
      expect(groupPartnersIntoCategories([])).toEqual([]);
    });

    it('returns a single unnamed group when all uncategorized', () => {
      const result = groupPartnersIntoCategories([makeItem('A', '')]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('');
      expect(result[0].partners).toHaveLength(1);
    });

    it('capitalizes named category segments', () => {
      const result = groupPartnersIntoCategories([
        makeItem('A', 'cat.banking'),
        makeItem('B', 'cat.banking'),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Banking');
      expect(result[0].partners).toHaveLength(2);
    });

    it('skips modules without an auth url', { tags: ['edge-case'] }, () => {
      const noAuth = makeItem('NoAuth', 'cat.x');
      noAuth.partner_module.Properties!.authenticators = {};
      expect(groupPartnersIntoCategories([noAuth])).toEqual([]);
    });
  });
});
