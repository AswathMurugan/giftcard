// Sidebar FLYOUTS — an app-fillable extension point for the left rail. An app
// registers one or more flyouts (icon + label + arbitrary panel content) by
// wrapping its routes in <SidebarFlyoutsProvider flyouts={…}>; the starter rail
// renders each as an icon that opens a panel to the RIGHT on hover ("peek"),
// with a pin toggle that keeps it open until unpinned. Content lives in the app
// (`src/pages/**`); the chrome stays starter-owned.
//
// Example (in src/PrivateApp.tsx):
//   <SidebarFlyoutsProvider flyouts={[
//     { id: 'sr-quick', icon: 'icon_-Tb_clipboard_list', label: 'Service Requests',
//       content: <SrQuickPanel /> },
//   ]}>
//     {children}
//   </SidebarFlyoutsProvider>
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navigateCrossApp } from '@/config/cross-app-nav';

// Rail widths (mirror DefaultLayout's `w-14` collapsed / `w-[17.5rem]` expanded)
// so the full-height flyout sits flush against the rail's right edge.
const RAIL_W_COLLAPSED = 56;
const RAIL_W_EXPANDED = 280;
const FLYOUT_CLOSE_DELAY = 150;
/** Flyout panel width — DefaultLayout offsets `<main>` by this when pinned so
 *  the pinned panel pushes content right instead of covering it. */
export const SIDEBAR_FLYOUT_WIDTH = 380;

export interface SidebarFlyout {
  /** Stable id (React key). */
  id: string;
  /** Nucleo glyph class shown in the rail, e.g. 'icon_-Tb_clipboard_list'. */
  icon: string;
  /** Rail label (also the flyout panel title + collapsed tooltip). */
  label: string;
  /** The panel body — any app component. Mounts lazily when the flyout opens. */
  content: ReactNode;
  /** Optional route path. When set, CLICKING the rail item navigates here (while
   *  HOVER still peeks the panel) — one entry that both opens the page and shows
   *  the quick panel. The item also highlights while on that route. */
  to?: string;
  /** Optional CROSS-APP click target (used when `to` is not set): clicking the
   *  rail item hard-navigates to this related app's screen via
   *  `navigateCrossApp` — resolution reads `related_applications` at click
   *  time, so it's a guarded no-op until the target app is related. HOVER
   *  still peeks the panel. */
  external?: { appKey: string; screen: string; navVars?: Record<string, unknown> };
  /** Optional rail POSITION: render this flyout's rail item immediately AFTER
   *  the nav item with this route path (e.g. `'/account-onboarding'`). Unset →
   *  the flyout renders BEFORE the nav items (the default, quick-access-first
   *  position). */
  afterPath?: string;
  /**
   * CONTENT-ONLY registration: this flyout supplies panel content but has no
   * code-declared rail position. It renders SOLELY when a `menu-config` row's
   * `flyout_ref` matches its `id` (config owns placement/label/icon/order).
   * Unreferenced `configOnly` flyouts render nothing. Non-`configOnly` flyouts
   * keep their legacy leading/`afterPath` behaviour UNLESS a config row
   * references them — a referenced id is "consumed" and renders only at the
   * config placement (see `leadingFlyouts` / `flyoutsAfter`'s `consumed` arg).
   */
  configOnly?: boolean;
}

/**
 * Flyouts that render before the nav items by CODE (no `afterPath`): excludes
 * `configOnly` flyouts (config-placed only) and any id `consumed` by a config
 * row (rendered at its config placement instead). Pure → testable.
 */
export function leadingFlyouts(
  flyouts: SidebarFlyout[],
  consumed?: ReadonlySet<string>,
): SidebarFlyout[] {
  return flyouts.filter((f) => !f.afterPath && !f.configOnly && !consumed?.has(f.id));
}

/**
 * Flyouts anchored right after the nav item at `path` by CODE: excludes
 * `configOnly` and `consumed` ids (as `leadingFlyouts`). Pure → testable.
 */
export function flyoutsAfter(
  flyouts: SidebarFlyout[],
  path: string,
  consumed?: ReadonlySet<string>,
): SidebarFlyout[] {
  return flyouts.filter(
    (f) => f.afterPath === path && !f.configOnly && !consumed?.has(f.id),
  );
}

/** Look up a registered flyout by id (exact match). Pure → testable. */
export function flyoutById(
  flyouts: SidebarFlyout[],
  id: string,
): SidebarFlyout | undefined {
  return flyouts.find((f) => f.id === id);
}

const SidebarFlyoutsContext = createContext<SidebarFlyout[]>([]);

export function SidebarFlyoutsProvider({
  flyouts,
  children,
}: {
  flyouts: SidebarFlyout[];
  children: ReactNode;
}) {
  return (
    <SidebarFlyoutsContext.Provider value={flyouts}>
      {children}
    </SidebarFlyoutsContext.Provider>
  );
}

export function useSidebarFlyouts(): SidebarFlyout[] {
  return useContext(SidebarFlyoutsContext);
}

/**
 * API handed to a flyout's panel content so it can close itself after an action
 * (e.g. navigating to a row). `close()` collapses a hover/peek panel but is a
 * no-op while PINNED — a pinned panel is a persistent column and stays open.
 */
export interface FlyoutPanelApi {
  /** True when this flyout is pinned open (persistent column). */
  pinned: boolean;
  /** Close the peek panel; no-op when pinned. */
  close: () => void;
}
const FlyoutPanelContext = createContext<FlyoutPanelApi>({ pinned: false, close: () => {} });

/** Read the enclosing flyout panel's API (pinned state + close) from content. */
export function useFlyoutPanel(): FlyoutPanelApi {
  return useContext(FlyoutPanelContext);
}

/**
 * One rail flyout item. Opens on hover (peek) and stays open when pinned.
 * `itemClass`/`iconClass` are the rail's own class helpers, passed in so the
 * trigger matches the surrounding nav items exactly.
 */
export function SidebarFlyoutItem({
  flyout,
  collapsed,
  itemClass,
  iconClass,
  pinned,
  onTogglePin,
}: {
  flyout: SidebarFlyout;
  collapsed: boolean;
  itemClass: (active: boolean, collapsed: boolean) => string;
  iconClass: (active: boolean) => string;
  /** Pinned state lifted to DefaultLayout so a pinned panel can push `<main>`. */
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const open = pinned || hovering;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Highlight the rail item while on its route (click-nav flyouts) OR while the
  // panel is open (peeked/pinned).
  const onRoute = !!flyout.to && (pathname === flyout.to || pathname.startsWith(`${flyout.to}/`));
  const active = open || onRoute;

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHovering(false), FLYOUT_CLOSE_DELAY);
  };
  const openNow = () => {
    cancelClose();
    setHovering(true);
  };
  useEffect(() => cancelClose, []);

  // Handed to the panel content so an action (e.g. opening a row) can close the
  // peek panel. No effect while pinned — `open` stays true via `pinned`.
  const panelApi = useMemo<FlyoutPanelApi>(
    () => ({
      pinned,
      close: () => {
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        setHovering(false);
      },
    }),
    [pinned],
  );

  return (
    <>
      <button
        type="button"
        title={collapsed ? flyout.label : undefined}
        aria-label={flyout.label}
        aria-expanded={open}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onClick={
          flyout.to
            ? () => navigate(flyout.to!)
            : flyout.external
              ? () =>
                  navigateCrossApp(
                    flyout.external!.appKey,
                    flyout.external!.screen,
                    flyout.external!.navVars,
                  )
              : undefined
        }
        className={itemClass(active, collapsed)}
      >
        <i className={cn('icon', flyout.icon, iconClass(active))} aria-hidden="true" />
        {!collapsed && <span className="truncate">{flyout.label}</span>}
      </button>

      {open &&
        createPortal(
          // Full-height panel flush to the rail's right edge — no rounded
          // corners, no floating card. When pinned, the top header shifts right
          // (see DefaultLayout) so the brand stays visible beside the panel.
          // Hover-bridged (a small close delay lets the cursor cross into the
          // panel); pin keeps it open.
          <div
            role="dialog"
            aria-label={flyout.label}
            onMouseEnter={openNow}
            onMouseLeave={scheduleClose}
            style={{ left: collapsed ? RAIL_W_COLLAPSED : RAIL_W_EXPANDED }}
            className="fixed inset-y-0 z-50 flex w-[23.75rem] flex-col border-r border-border bg-popover text-foreground shadow-pop duration-150 animate-in fade-in-0 slide-in-from-left-2"
          >
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <span className="text-lg font-semibold">{flyout.label}</span>
              <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={pinned}
                aria-label={pinned ? 'Unpin panel' : 'Pin panel open'}
                title={pinned ? 'Unpin' : 'Pin open'}
                className={cn(
                  'grid size-7 place-content-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  pinned && 'text-primary hover:text-primary',
                )}
              >
                <i
                  className={cn('icon', pinned ? 'icon_-Tb_pin_filled' : 'icon_-Tb_pin', 'text-[1.125rem]')}
                  aria-hidden="true"
                />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FlyoutPanelContext.Provider value={panelApi}>{flyout.content}</FlyoutPanelContext.Provider>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
