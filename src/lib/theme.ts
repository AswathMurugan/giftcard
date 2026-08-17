/**
 * Colour-mode (light/dark) handling for the codegen starter.
 *
 * This module deals ONLY with the user's light/dark mode preference — a
 * genuine runtime UI setting. Per-tenant branding (theme colours, fonts,
 * logo, favicon) is handled separately and entirely at runtime by
 * `BrandingProvider` (src/components/branding-provider.tsx) via
 * `usePreferences()`; none of it is code-generated.
 *
 * Two entry points:
 *
 * 1. `applyStoredTheme()` — called from main.tsx BEFORE React renders.
 *    Reads the cached mode from localStorage and applies it synchronously
 *    so the user doesn't see a flash. Fails silently (first boot has
 *    nothing cached).
 *
 * 2. `applyThemeOverrides(overrides)` — called from auth flows. Applies
 *    the mode + caches it for the next boot's `applyStoredTheme()`.
 */

const STORAGE_KEY = 'jiffy-theme';

export interface ThemeOverrides {
  mode?: 'light' | 'dark' | 'system';
  accent?: string;
  [key: string]: unknown;
}

function applyToDom(overrides: ThemeOverrides): void {
  const root = document.documentElement;

  if (overrides.mode === 'dark') {
    root.classList.add('dark');
  } else if (overrides.mode === 'light') {
    root.classList.remove('dark');
  } else if (overrides.mode === 'system') {
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches;
    root.classList.toggle('dark', prefersDark);
  }

  if (overrides.accent) {
    root.style.setProperty('--accent', overrides.accent);
  }
}

/**
 * Apply the cached colour mode from localStorage. Safe to call before
 * React mounts; silently no-ops if nothing is cached or the cache is
 * corrupted.
 */
export function applyStoredTheme(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as ThemeOverrides;
    applyToDom(cached);
  } catch {
    /* corrupted or unavailable — fall through to defaults */
  }
}

/**
 * Apply colour-mode overrides and cache them for the next boot.
 */
export function applyThemeOverrides(
  overrides: ThemeOverrides | null | undefined,
): void {
  if (!overrides) return;
  applyToDom(overrides);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* localStorage full or unavailable — DOM still updated, just no cache */
  }
}
