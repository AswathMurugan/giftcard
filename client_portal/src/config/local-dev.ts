/**
 * Local Development Configuration for Codegen Starter
 *
 * Change these values to point to your tenant/app during local development.
 */
// Gift Card app — the `giftcards` tenant on the sandbox cluster.
//
// `env` here is the CLUSTER segment of the hostname, not the deployment
// environment sent as `X-Jiffy-Env`. The two differ for this tenant: the app
// lives on the *sandbox* cluster but the auth config reports its deployment
// env as `develop`, and `resolveAppEnv` prefers that server value. Only when
// the server omits `env` does this value become the header fallback.
//
// Verified against
//   GET /api/public/auth/config?host=aswathtestapp-giftcards.us.sandbox.phoenix.jiffy.ai
//   → { tenant_name: 'giftcards', env: 'develop', user_pool_id: 'us-east-1_8HgHoXcWT', … }
export const LOCAL_DEV_CONFIG = {
  appName: 'aswathtestapp',
  tenant: 'giftcards',
  version: '0.0.1',
  label: 'Vista — Client Portal',
  env: 'sandbox',
} as const;

export const LOCAL_DEV_DERIVED = {
  get appDefinition(): string {
    return `${LOCAL_DEV_CONFIG.appName}__V${LOCAL_DEV_CONFIG.version.replace(/\./g, '_')}`;
  },
  get host(): string {
    return `${LOCAL_DEV_CONFIG.appName.toLowerCase()}-${LOCAL_DEV_CONFIG.tenant}.us.${LOCAL_DEV_CONFIG.env}.phoenix.jiffy.ai`;
  },
} as const;
