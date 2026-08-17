import { getAppConfig } from '@/config/api-config';

/**
 * Screen page slugs. The value is the third segment of the Phoenix
 * permission resource string:
 *
 *   "<appDefinition>.screen.<page-slug>"
 *
 * Add new pages here as they are created. Slugs should match the
 * `resource` value the platform API returns for the screen.
 *
 * Implemented as a const object + union type (not a TS `enum`) because the
 * build runs with `erasableSyntaxOnly` — `enum` emits runtime code and is
 * disallowed. `Pages.HOME` (value) and `: Pages` (type) both still work.
 */
export const Pages = {
  HOME: 'home',
  ACCOUNT_DOCUMENTS: 'account-documents',
} as const;

export type Pages = (typeof Pages)[keyof typeof Pages];

/**
 * Build the full Phoenix resource key for a screen page using the
 * current app's `app_definition` from the auth config.
 *
 * Accepts a known `Pages` slug OR any raw screen name (e.g. a route's
 * `permission` = the `register_screen`/`buildSchema` page name), since nav-item
 * gating references screens that aren't enumerated in `Pages`.
 */
export function getScreenResourceKey(page: Pages | (string & {})): string {
  return `${getAppConfig().appDefinition}.screen.${page}`;
}
