/**
 * BrandingProvider
 *
 * Resolves per-tenant branding at RUNTIME (not codegen) and applies it:
 *
 *   1. Fetches merged preferences via `usePreferences()`.
 *   2. Extracts branding (theme / logo / favicon / logoHeight).
 *   3. Applies the theme tier to the DOM — the tenant's `App.Theme` when
 *      set, otherwise `DEFAULT_THEME` (Phoenix Gold) — plus favicon and
 *      the `--logo-height` CSS variable.
 *   4. Exposes `{ logoUrl, logoHeight, invertSidebarColors }` to the chrome
 *      via `useBranding()`.
 *
 * On first paint (before prefs resolve, or pre-auth when the request
 * 403s) nothing is applied, so the static defaults in `index.css` show.
 * Once prefs arrive we apply the resolved theme; for the common
 * no-`App.Theme` tenant that's `DEFAULT_THEME`, whose values match the
 * static defaults — no flash.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { usePreferences } from '@/queries/use-preferences';
import {
  applyBranding,
  extractBranding,
  tenantAssetOrigin,
  EMPTY_BRANDING,
  type Branding,
  type BrandingPreferenceRecord,
} from '@/lib/branding';
import { getAppConfig } from '@/config/api-config';
import type { ThemeMode } from '@/lib/apply-theme';

interface BrandingContextValue {
  logoUrl: string | null;
  logoHeight: string | null;
  /** Tenant theme's "Invert Sidebar Colors" opt-in — drives the rail palette. */
  invertSidebarColors: boolean;
}

const BrandingContext = createContext<BrandingContextValue>({
  logoUrl: null,
  logoHeight: null,
  invertSidebarColors: false,
});

/** Current resolved colour mode, read from the `.dark` class the ThemeProvider toggles. */
function currentMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data } = usePreferences();

  // Public assets are served from the tenant host, not the editor preview
  // iframe origin the app runs in — derive the right origin (PHX-4278).
  // Recompute when prefs arrive: `getAppConfig().tenant` is only populated
  // after auth resolves, which is also when `data` (prefs) becomes available.
  const assetOrigin = useMemo(
    () =>
      tenantAssetOrigin(
        getAppConfig().tenant,
        typeof window !== 'undefined' ? window.location.hostname : undefined,
        typeof window !== 'undefined' ? window.location.origin : undefined,
      ),
    [data],
  );

  const branding: Branding = useMemo(
    () =>
      data
        ? extractBranding(
            data as unknown as BrandingPreferenceRecord[],
            assetOrigin,
          )
        : EMPTY_BRANDING,
    [data, assetOrigin],
  );

  useEffect(() => {
    // Only apply once preferences have actually resolved. Before that the
    // static index.css defaults stand in.
    if (!data) return;

    let lastMode = currentMode();
    applyBranding(branding, lastMode);

    // Re-apply when dark mode toggles. applyTheme writes the colour ramp as
    // INLINE styles on <html>, so switching light↔dark must REWRITE that inline
    // ramp for the new mode — otherwise the previous mode's ramp sticks (e.g.
    // the light gold ramp pinned inline in dark mode → gold surfaces stay
    // light). The `.dark` class alone can't fix it (inline beats a class).
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const observer = new MutationObserver(() => {
      const mode = currentMode();
      if (mode === lastMode) return;
      lastMode = mode;
      applyBranding(branding, mode);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [data, branding]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      logoUrl: branding.logoUrl,
      logoHeight: branding.logoHeight,
      invertSidebarColors: branding.invertSidebarColors,
    }),
    [branding.logoUrl, branding.logoHeight, branding.invertSidebarColors],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

/** Read the resolved per-tenant logo + logo height + sidebar-invert flag. */
export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}

export default BrandingProvider;
