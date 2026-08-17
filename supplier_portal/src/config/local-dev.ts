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
/**
 * Relay points at the SAME Phoenix app as Forge, deliberately.
 *
 * The supplier portal is a second UI onto one order lifecycle, not a second
 * domain — a supplier quoting an RFE writes the same `rfe_response` a CS
 * specialist would read, and acknowledging a PO has to advance the same
 * workflow. Sharing `aswathtestapp` means entities, saved queries and
 * workflows are shared by construction rather than kept in sync by hand.
 *
 * Only `label` differs, and it is what the chrome renders.
 */
export const LOCAL_DEV_CONFIG = {
  appName: 'aswathtestapp',
  tenant: 'giftcards',
  version: '0.0.1',
  label: 'Relay — Supplier Portal',
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
