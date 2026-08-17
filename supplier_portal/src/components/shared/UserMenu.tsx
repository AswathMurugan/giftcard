/**
 * UserMenu — current-user identity + actions, shown at the right of the
 * top bar. Enriches the auth session with the platform user profile and offers
 * account actions. Renders nothing until the identity resolves.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuthService } from '@/config/auth-service-manager';
import { apiManager } from '@/services/api-manager';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  resolveCurrentUser,
  userInitials,
  type CurrentUser,
} from './user-menu-utils';

// These dialog bodies are only reachable from this menu (Connected Apps /
// Notification Preferences), yet the menu renders on EVERY authenticated page.
// Lazy-load them + mount only after first open (see the `*Mounted` latches
// below) so their module graphs stay out of the app-shell bundle. See PHX-4455.
const ConnectedApps = lazy(() =>
  import('@/components/shared/connected-apps/ConnectedApps').then((m) => ({ default: m.ConnectedApps })));
const NotificationPreferences = lazy(() =>
  import('@/components/shared/notification-preferences/NotificationPreferences').then((m) => ({ default: m.NotificationPreferences })));

const PROFILE_MENU_ITEM_CLASS =
  'gap-3 px-4 py-2 text-[0.8125rem] font-medium leading-5 tracking-[0.015625rem]';
const PROFILE_MENU_ICON_CLASS = 'icon shrink-0 text-[1rem]';

export function UserMenu() {
  const navigate = useNavigate();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isConnectedAppsOpen, setIsConnectedAppsOpen] = useState(false);
  const [isNotifPrefsOpen, setIsNotifPrefsOpen] = useState(false);
  // "Mounted" latches: flip true on first open so the lazy dialog chunk is
  // fetched on interaction (not on page load), then stay mounted so the
  // open/close animation and state survive subsequent toggles.
  const [connectedAppsMounted, setConnectedAppsMounted] = useState(false);
  const [notifPrefsMounted, setNotifPrefsMounted] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await getAuthService().getSession();
        if (!active || !session?.user) return;

        let profile: Record<string, unknown> | null = null;
        try {
          const response = await apiManager.get('neo-api', 'users/me');
          if (response.data && typeof response.data === 'object') {
            profile = response.data as Record<string, unknown>;
          }
        } catch {
          // Keep the auth-session identity when the platform profile is unavailable.
        }

        if (active) setUser(resolveCurrentUser(session.user, profile));
      } catch {
        // No session → render nothing.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function handleLogout() {
    // Route to /logout, which signs out, clears local state, and handles
    // federated-SSO logout before landing on /login. logout() itself does NOT
    // navigate, so the menu must.
    navigate('/logout');
  }

  if (!user) return null;

  const initials = userInitials(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            'flex items-center gap-2 rounded-full py-1 pl-2 pr-1 text-left',
            'transition-opacity hover:opacity-80 focus-visible:outline-none',
          )}
        >
          {/* Name (+ optional subtitle) stacked, right-aligned next to the avatar */}
          <span className="hidden min-w-0 flex-col items-end leading-[1.2] sm:flex">
            <span className="max-w-[12rem] truncate text-base font-semibold text-foreground">
              {user.name}
            </span>
            {user.subtitle && (
              <span className="max-w-[12rem] truncate text-sm font-normal text-muted-foreground">
                {user.subtitle}
              </span>
            )}
          </span>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary-300 bg-primary-50 text-sm font-semibold text-primary-500">
            {initials}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={cn(
          // overflow-x/y explicitly (the default content sets overflow-x-hidden
          // + overflow-y-auto, which would clip the arrow pointer below).
          'w-72 overflow-visible overflow-x-visible overflow-y-visible rounded-lg p-0',
          // Arrow pointer up to the avatar (matches the platform header profile).
          "before:absolute before:-top-2 before:right-6 before:border-x-8 before:border-x-transparent before:border-b-8 before:border-b-border before:content-['']",
          "after:absolute after:-top-[0.4375rem] after:right-[1.5625rem] after:border-x-[7px] after:border-x-transparent after:border-b-[7px] after:border-b-popover after:content-['']",
        )}
      >
        {/* Centered identity: avatar + name + email */}
        <div className="flex flex-col items-center gap-1 px-4 pb-2 pt-3 text-center">
          <span className="mb-1 flex size-12 items-center justify-center rounded-full border border-primary-300 bg-primary-50 text-lg font-semibold text-primary-500">
            {initials}
          </span>
          <span className="max-w-full truncate font-semibold text-foreground">
            {user.name}
          </span>
          {user.email && (
            <span className="w-full truncate text-sm text-muted-foreground">
              {user.email}
            </span>
          )}
        </div>
        <div className="py-1">
          <DropdownMenuItem
            onSelect={() => {
              setConnectedAppsMounted(true);
              setIsConnectedAppsOpen(true);
            }}
            className={PROFILE_MENU_ITEM_CLASS}
          >
            <i className={`${PROFILE_MENU_ICON_CLASS} icon_-Tb_link`} aria-hidden="true" />
            Connected Apps
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setNotifPrefsMounted(true);
              setIsNotifPrefsOpen(true);
            }}
            className={PROFILE_MENU_ITEM_CLASS}
          >
            <i className={`${PROFILE_MENU_ICON_CLASS} icon_-Tb_alert_circle`} aria-hidden="true" />
            Notification Preferences
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={handleLogout}
            className={PROFILE_MENU_ITEM_CLASS}
          >
            <i className={`${PROFILE_MENU_ICON_CLASS} icon_-Tb_logout`} aria-hidden="true" />
            Log out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
      {connectedAppsMounted && (
        <Suspense fallback={null}>
          <ConnectedApps
            isOpen={isConnectedAppsOpen}
            onClose={() => setIsConnectedAppsOpen(false)}
          />
        </Suspense>
      )}
      {notifPrefsMounted && (
        <Suspense fallback={null}>
          <NotificationPreferences
            isOpen={isNotifPrefsOpen}
            onClose={() => setIsNotifPrefsOpen(false)}
          />
        </Suspense>
      )}
    </DropdownMenu>
  );
}

export default UserMenu;
