/**
 * Connected Apps — type definitions + user-facing strings.
 *
 * Ported from the platform `@ui-composite/connected_apps` lib. The starter
 * has no i18n runtime, so the English defaults are kept inline as the
 * source of truth.
 */

export type ConnectedAccountStatus =
  | 'connected'
  | 'pending'
  | 'error'
  | 'saving';

export interface ConnectedAccount {
  id: string;
  configId: string;
  name: string;
  description?: string;
  status: ConnectedAccountStatus;
  isNameProviderManaged?: boolean;
  isDescriptionProviderManaged?: boolean;
}

export interface ConnectedPartner {
  id: string;
  name: string;
  description: string;
  iconSrc?: string;
  accounts: ConnectedAccount[];
  maxAccounts?: number;
  authenticatorName: string;
  userAuthorizationUrl: string;
  app_definition: string;
  app_definition_key: string;
  defaultConfig?: PartnerModuleConfig;
}

// --- API response shapes -------------------------------------------------

export interface PartnerAuthenticatorParameter {
  label: string;
  datatype: string;
  value: string;
  is_secret: boolean;
  editable_by_end_user: boolean;
  editable_by_platform_user: boolean;
  visible: boolean;
}

export interface PartnerAuthenticator {
  parameters: Record<string, PartnerAuthenticatorParameter>;
}

export interface PartnerCategoryImplementation {
  partner_category: string;
  operations?: unknown[];
}

export interface PartnerModuleApplication {
  name: string;
  label: string;
  description?: string;
  app_definition: string;
  app_definition_key: string;
}

export interface PartnerModule {
  name: string;
  label: string;
  description?: string;
  app_definition: string;
  app_definition_key: string;
  Properties?: {
    authenticators?: Record<string, PartnerAuthenticator>;
    partner_category_implementations?: PartnerCategoryImplementation[];
  };
}

export interface PartnerModuleConfig {
  configId: string;
  authenticatorName: string;
  authenticatorLabel: string;
  displayLabel?: string;
  description?: string;
  displayName?: string;
  email?: string;
  pictureUrl?: string;
  parameters?: Record<string, string>;
}

export interface PartnerModuleWithConfigs {
  partner_module_application: PartnerModuleApplication;
  partner_module: PartnerModule;
  configs: PartnerModuleConfig[];
}

export interface ConnectedAppsCategory {
  id: string;
  name: string;
  partners: ConnectedPartner[];
}

export interface ConnectedAppsSavePayload {
  deletedAccountIds: string[];
}

export interface ConnectedAppsProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (payload: ConnectedAppsSavePayload) => void;
}

// --- User-facing strings -------------------------------------------------

export const CONNECTED_APPS_TEXT = {
  title: 'Connected Apps',
  subtitle:
    'Turbocharge your experience by connecting the applications that you use.',
  empty: 'No integrations available',
  cancel: 'Cancel',
  save: 'Save',
  addButton: 'Add',
  addDescription: 'Add description',
  connectedBadge: (connected: number, total: number) =>
    `${connected} of ${total} connected`,
  accountActions: 'Account actions',
  pendingConnection: 'Pending connection',
  deletingAccount: 'Deleting account',
  savingAccount: 'Saving account',
  setDefault: 'Set as Default',
  delete: 'Delete',
  othersCategory: 'Others',
  defaultAccountName: (partnerName: string, index: number) =>
    `${partnerName} ${index}`,
  defaultAccountDescription: (partnerName: string) =>
    `Connected ${partnerName} account`,
};
