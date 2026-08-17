/**
 * Connected Apps data access. Ported from the platform lib's
 * `partner-modules-api.ts`, adapted to the starter's apiManager surface.
 *
 * Services (configured in src/config/api-config.ts):
 *   - `tenant`  → partner-module configs + OAuth callback proxy (`/api`).
 *   - `neo-api` → preferences for account display labels (`/api`).
 *
 * Partner-module / proxy routes authorize against per-user grants; the
 * requesting user's id is stamped as X-Jiffy-User-Id on the callback/config
 * WRITES (see the note on getDataHeadersWithUser in src/config/api-config.ts).
 * NOT on configs-with-params: the server derives the user from the bearer
 * there and rejects a non-matching header with 401 "User mismatch" (the
 * platform web app sends none either).
 */
import { apiManager } from '@/services/api-manager';
import { getAuthService } from '@/config/auth-service-manager';
import { CONNECTED_APPS_TEXT } from '@/components/shared/connected-apps/types';
import type {
  ConnectedAccount,
  ConnectedAppsCategory,
  ConnectedPartner,
  PartnerModule,
  PartnerModuleConfig,
  PartnerModuleWithConfigs,
} from '@/components/shared/connected-apps/types';

const SERVICE_KEY = 'tenant';
const PREFERENCES_SERVICE_KEY = 'neo-api';

/** Stamp the requesting user's id for per-user partner authorization. */
function userHeaders(): Record<string, string> {
  const userId = getAuthService().getJiffyUserId();
  return userId ? { 'X-Jiffy-User-Id': userId } : {};
}

export async function fetchPartnerModulesWithConfigs(): Promise<
  PartnerModuleWithConfigs[]
> {
  // NO X-Jiffy-User-Id here — see the header note (401 "User mismatch").
  const response = await apiManager.get(
    SERVICE_KEY,
    'partner-modules/configs-with-params',
  );
  const data = response.data;
  return Array.isArray(data) ? data : (data?.data ?? []);
}

export async function processPartnerCallback(
  partnerName: string,
  authenticatorName: string,
  configId: string,
  partnerAppDefinition: string,
  callbackData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await apiManager.post(
    SERVICE_KEY,
    `proxy/process-callback/${encodeURIComponent(partnerName)}/common/${encodeURIComponent(authenticatorName)}/${encodeURIComponent(configId)}`,
    callbackData,
    { ...userHeaders(), 'x-jiffy-app-definition': partnerAppDefinition },
  );
  return (response.data ?? {}) as Record<string, unknown>;
}

export async function savePreferences(
  preferences: { name: string; value: string; description: string }[],
  appDefinition: string,
  appDefinitionKey: string,
): Promise<void> {
  for (const pref of preferences) {
    await apiManager.post(PREFERENCES_SERVICE_KEY, 'preferences', {
      ...pref,
      category: 'partner_module',
      app_definition: appDefinition,
      app_definition_key: appDefinitionKey,
    });
  }
}

export async function setDefaultConfig(
  partnerName: string,
  configId: string,
): Promise<void> {
  await apiManager.post(
    SERVICE_KEY,
    `partner-modules/set-default-config/${encodeURIComponent(partnerName)}/${encodeURIComponent(configId)}`,
    {},
    userHeaders(),
  );
}

export async function deleteAccountPreferences(
  partnerName: string,
  configId: string,
): Promise<void> {
  const namePrefix = `${partnerName}:${configId}`;
  const response = await apiManager.get(
    PREFERENCES_SERVICE_KEY,
    `preferences?name_prefix=${encodeURIComponent(namePrefix)}`,
  );
  const preferences = Array.isArray(response.data)
    ? response.data
    : (response.data?.data ?? []);

  for (const pref of preferences) {
    const prefId = pref.id ?? pref._id;
    if (prefId) {
      await apiManager.delete(
        PREFERENCES_SERVICE_KEY,
        `preferences/${encodeURIComponent(String(prefId))}`,
      );
    }
  }
}

// --- Pure helpers (unit-tested) -----------------------------------------

export function splitConfigs(
  configs: PartnerModuleConfig[],
  authenticatorName: string,
): {
  defaultConfig: PartnerModuleConfig | undefined;
  accounts: ConnectedAccount[];
} {
  let defaultConfig: PartnerModuleConfig | undefined;
  const accounts: ConnectedAccount[] = [];

  for (const config of configs) {
    if (config.authenticatorName !== authenticatorName) continue;
    const params = config.parameters ?? {};

    if (!defaultConfig && params['user_authorization_url']) {
      defaultConfig = config;
    } else {
      const resolvedName =
        config.displayName ||
        config.displayLabel ||
        config.authenticatorLabel ||
        config.authenticatorName;
      const resolvedDescription = config.email || config.description;
      accounts.push({
        id: config.configId,
        configId: config.configId,
        name: resolvedName,
        description: resolvedDescription || undefined,
        status: 'connected',
        isNameProviderManaged: Boolean(config.displayName),
        isDescriptionProviderManaged: Boolean(config.email),
      });
    }
  }

  return { defaultConfig, accounts };
}

export function findAuthenticatorWithAuthUrl(
  module: PartnerModule,
): { authenticatorName: string; userAuthorizationUrl: string } | null {
  const authenticators = module.Properties?.authenticators ?? {};
  for (const [name, authenticator] of Object.entries(authenticators)) {
    const urlParam = authenticator.parameters?.['user_authorization_url'];
    if (urlParam?.value) {
      return { authenticatorName: name, userAuthorizationUrl: urlParam.value };
    }
  }
  return null;
}

export function extractCategorySegment(partnerCategory: string): string {
  if (!partnerCategory) return '';
  const segments = partnerCategory.split('.');
  return segments[segments.length - 1] ?? '';
}

export function getPartnerInitials(label: string): string {
  const words = label.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

export function groupPartnersIntoCategories(
  items: PartnerModuleWithConfigs[],
): ConnectedAppsCategory[] {
  type GroupMap = Map<string, ConnectedPartner[]>;
  const groups: GroupMap = new Map();

  for (const item of items) {
    const module = item.partner_module;
    const authResult = findAuthenticatorWithAuthUrl(module);
    if (!authResult) continue;

    const { defaultConfig, accounts } = splitConfigs(
      item.configs ?? [],
      authResult.authenticatorName,
    );

    const rawCategory =
      module.Properties?.partner_category_implementations?.[0]
        ?.partner_category ?? '';
    const categorySegment = extractCategorySegment(rawCategory);

    const partner: ConnectedPartner = {
      id: module.name,
      name: module.label,
      description: module.description ?? '',
      accounts,
      authenticatorName: authResult.authenticatorName,
      userAuthorizationUrl: authResult.userAuthorizationUrl,
      app_definition: module.app_definition,
      app_definition_key: module.app_definition_key,
      defaultConfig,
    };

    const existing = groups.get(categorySegment);
    if (existing) {
      existing.push(partner);
    } else {
      groups.set(categorySegment, [partner]);
    }
  }

  const allUncategorized =
    groups.size === 0 || (groups.size === 1 && groups.has(''));

  if (allUncategorized) {
    const partners = groups.get('') ?? [];
    return partners.length > 0
      ? [{ id: 'uncategorized', name: '', partners }]
      : [];
  }

  const categories: ConnectedAppsCategory[] = [];
  for (const [segment, partners] of groups.entries()) {
    const name =
      segment === ''
        ? CONNECTED_APPS_TEXT.othersCategory
        : segment.charAt(0).toUpperCase() + segment.slice(1);
    categories.push({ id: name.toLowerCase(), name, partners });
  }
  return categories;
}
