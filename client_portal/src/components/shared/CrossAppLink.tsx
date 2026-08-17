/**
 * CrossAppLink — a button that navigates to a screen in ANOTHER related app,
 * supplying that screen's nav variables from the current row/record context.
 *
 * Use this (not an `ExternalNavItem` sidebar entry) when the target screen has
 * REQUIRED nav variables that need per-row data — e.g. an account-detail screen
 * keyed by `accountId`. A static sidebar item has no record context to fill
 * those; a button rendered inside a row/detail does. See
 * docs/CROSS-APP-NAVIGATION-PLAN.md §5.4.
 *
 * Resolution + navigation go through `cross-app-nav.ts`, which reads
 * `related_applications` (with env-specific `application_url`). When the target
 * can't be resolved (app not related, or `application_url` not yet present), the
 * button renders disabled rather than navigating to a broken URL.
 *
 * @example
 *   <CrossAppLink
 *     appKey="advisorworkstation_69c6..."
 *     screen="account-overview"
 *     navVars={{ id: row.account_id }}
 *   >
 *     Open in Workstation
 *   </CrossAppLink>
 */
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  resolveAppUrl,
  navigateCrossApp,
} from '@/config/cross-app-nav';

export interface CrossAppLinkProps
  extends Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> {
  /** Target app's `app_definition_key` (from related-screens.catalog.md). */
  appKey: string;
  /** Target screen name. */
  screen: string;
  /** Nav variables → query params (e.g. `{ id: row.account_id }`). */
  navVars?: Record<string, unknown>;
  children: ReactNode;
}

export function CrossAppLink({
  appKey,
  screen,
  navVars,
  children,
  disabled,
  ...buttonProps
}: CrossAppLinkProps) {
  // Resolve once for the disabled state; navigate on click.
  const resolvable = resolveAppUrl(appKey, screen, navVars) !== null;

  return (
    <Button
      {...buttonProps}
      disabled={disabled || !resolvable}
      onClick={() => navigateCrossApp(appKey, screen, navVars)}
    >
      {children}
    </Button>
  );
}

export default CrossAppLink;
