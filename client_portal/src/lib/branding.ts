/**
 * Runtime branding resolution.
 *
 * Tenant branding (theme, logo, favicon) is read at RUNTIME from the
 * merged preferences API (`usePreferences()` → `/api/preferences`)
 * — it is NOT code-generated. This module turns the raw preference
 * records into a `Branding` object and applies the theme tier to the DOM.
 *
 * Theme precedence (mirrors the Phoenix renderer's `applyBrandingTheme`):
 *   1. `App.Theme` JSON       → flat theme record, applied via `applyTheme`.
 *   2. `Tenant.Theme` payload → the tenant's theme collection
 *      (`{ themes:[{ id,name,draft }], defaultThemeId }`); the default theme's
 *      `draft` is converted to a bundle (PHX-4278, mirrors the platform's
 *      buildBundleFromDraft).
 *   3. (none)                 → `DEFAULT_THEME` (Phoenix Gold) applied.
 *
 * Branding asset keys honoured (App.* wins over Tenant.* — the per-app
 * setting is more specific than the tenant default):
 *   App.Logo / App.LogoUrl   ?? Tenant.Logo     → logoUrl
 *   App.Favicon / App.FavIcon ?? Tenant.Favicon → faviconUrl
 *   App.LogoHeight                              → logoHeight (CSS length)
 *   App.Theme                                   → theme (parsed JSON)
 *
 * NOTE (PHX-4278): `Tenant.Logo` / `Tenant.Favicon` values are Drive
 * PUBLIC_ASSETS storage keys (e.g. "PUBLIC_ASSETS/<tenant>/branding/.../x.jpeg"),
 * NOT absolute URLs. Public assets are served from the TENANT host root by their
 * storage key, so we resolve a non-absolute value to `${origin}/${key}` via
 * `resolveAssetUrl`. Passing the raw key straight to an <img>/<link> made the
 * browser resolve it relative to the current route → a broken image → the app
 * fell back to a different/default logo. Absolute URLs and root-relative paths
 * are left untouched.
 *
 * The origin is NOT `window.location.origin`: the app runs inside the editor
 * preview iframe (`<workspace-id>.editors.<envDomain>`), while assets live at
 * the tenant host (`<tenant>.<envDomain>`). `BrandingProvider` derives the
 * correct origin via `tenantAssetOrigin(tenant, hostname, currentOrigin)` and
 * passes it to `extractBranding`.
 */

import { applyTheme, type ThemeMode, type ThemeBundle } from './apply-theme';
import { DEFAULT_THEME, toDarkRecord } from './default-theme';

/**
 * The default theme with `fontFamily` stripped from each side of the bundle.
 * Used when no tenant theme is set so the runtime `--font-family-primary`
 * slot is left unwritten and the CSS `--font-sans` fallback chain resolves
 * `'Source Sans 3 Variable'` (the bundled face) directly.
 */
const DEFAULT_THEME_NO_FONT: ThemeBundle = {
  light: stripFontFamily(DEFAULT_THEME.light),
  dark: stripFontFamily(DEFAULT_THEME.dark),
};

function stripFontFamily(record: Record<string, unknown>): Record<string, unknown> {
  const { fontFamily: _omit, ...rest } = record;
  return rest;
}

/** Minimal shape of a merged preference record we read for branding. */
export interface BrandingPreferenceRecord {
  name: string;
  value: string;
  category?: string;
  disabled?: boolean;
}

export interface Branding {
  /** Parsed `App.Theme` JSON. Null when unset — caller falls back to DEFAULT_THEME. */
  theme: Record<string, unknown> | null;
  /** Logo image URL (App.LogoUrl ?? Tenant.Logo). Null when unset. */
  logoUrl: string | null;
  /** Favicon URL (App.FavIcon ?? Tenant.Favicon). Null when unset. */
  faviconUrl: string | null;
  /** Logo display height (e.g. "2.5rem"). Null when unset. */
  logoHeight: string | null;
  /**
   * The default theme's "Invert Sidebar Colors" opt-in (PHX-5283). When true,
   * the app chrome's left rail is painted from the BRAND ramp (primary bg,
   * secondary active) instead of the built-in dark palette — mirroring the
   * platform renderer's `inverted` sidebar preset. Read off the tenant theme's
   * default draft (`invertSidebarColors`), or a flat `App.Theme` record.
   */
  invertSidebarColors: boolean;
}

export const EMPTY_BRANDING: Branding = {
  theme: null,
  logoUrl: null,
  faviconUrl: null,
  logoHeight: null,
  invertSidebarColors: false,
};

/**
 * Extract branding values from the merged preference records.
 *
 * Skips disabled records and any record whose `category` is not
 * "branding" (case-insensitive — the platform writes `App.Theme` as
 * "Branding" and `Tenant.*` as "branding").
 */
export function extractBranding(
  records: readonly BrandingPreferenceRecord[] | null | undefined,
  assetOrigin?: string,
): Branding {
  const out: Branding = { ...EMPTY_BRANDING };
  if (!Array.isArray(records)) return out;

  let appLogo: string | null = null;
  let tenantLogo: string | null = null;
  let appFavicon: string | null = null;
  let tenantFavicon: string | null = null;
  let appThemeRaw: string | null = null;
  let tenantThemeRaw: string | null = null;

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    if (record.disabled) continue;
    if ((record.category ?? '').toLowerCase() !== 'branding') continue;
    const name = record.name;
    if (!name || typeof name !== 'string') continue;
    const value = typeof record.value === 'string' ? record.value : '';

    switch (name) {
      case 'App.Logo':
      case 'App.LogoUrl':
        appLogo = value || null;
        break;
      case 'Tenant.Logo':
        tenantLogo = value || null;
        break;
      case 'App.Favicon':
      case 'App.FavIcon':
        appFavicon = value || null;
        break;
      case 'Tenant.Favicon':
        tenantFavicon = value || null;
        break;
      case 'App.LogoHeight':
        out.logoHeight = value || null;
        break;
      case 'App.Theme':
        appThemeRaw = value || null;
        break;
      case 'Tenant.Theme':
        tenantThemeRaw = value || null;
        break;
      default:
        break;
    }
  }

  out.logoUrl = resolveAssetUrl(appLogo ?? tenantLogo, assetOrigin);
  out.faviconUrl = resolveAssetUrl(appFavicon ?? tenantFavicon, assetOrigin);
  out.theme = resolveThemeRecord(appThemeRaw, tenantThemeRaw);
  out.invertSidebarColors = resolveInvertSidebarColors(appThemeRaw, tenantThemeRaw);
  return out;
}

/**
 * Resolve the "Invert Sidebar Colors" opt-in (PHX-5283). Precedence mirrors
 * `resolveThemeRecord`:
 *   1. `App.Theme` — a flat theme record; read its `invertSidebarColors`.
 *   2. `Tenant.Theme` — the tenant theme COLLECTION; read the DEFAULT theme
 *      draft's `invertSidebarColors` (matches the platform renderer's
 *      `getDefaultTheme(tenantTheme).draft.invertSidebarColors`).
 *   3. false.
 * Exported for testing.
 */
export function resolveInvertSidebarColors(
  appThemeRaw: string | null,
  tenantThemeRaw: string | null,
): boolean {
  if (appThemeRaw) {
    try {
      const parsed = JSON.parse(appThemeRaw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        return parsed.invertSidebarColors === true;
      }
    } catch {
      /* invalid App.Theme JSON — fall through to Tenant.Theme */
    }
  }
  const draft = parseTenantThemeDefaultDraft(tenantThemeRaw);
  return draft?.invertSidebarColors === true;
}

/** Editable color shades a tenant theme draft carries (50…950). */
const DRAFT_COLOR_FAMILIES = ['primary', 'secondary', 'tertiary'] as const;

/**
 * Resolve the theme record to apply (PHX-4278). Precedence:
 *   1. `App.Theme` — a flat theme record (parsed JSON), used verbatim.
 *   2. `Tenant.Theme` — the tenant's theme COLLECTION
 *      (`{ themes:[{ id,name,draft }], defaultThemeId }`); we pick the default
 *      theme and convert its `draft` into a theme bundle.
 *   3. null → caller falls back to DEFAULT_THEME.
 */
function resolveThemeRecord(
  appThemeRaw: string | null,
  tenantThemeRaw: string | null,
): Record<string, unknown> | null {
  if (appThemeRaw) {
    try {
      const parsed = JSON.parse(appThemeRaw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* invalid App.Theme JSON — fall through to Tenant.Theme / DEFAULT */
    }
  }
  if (tenantThemeRaw) {
    const draft = parseTenantThemeDefaultDraft(tenantThemeRaw);
    // A { light, dark } bundle is a record-shaped object; applyTheme/resolveTheme
    // detect and apply the bundle. Cast to satisfy Branding.theme's record type.
    if (draft) return tenantDraftToThemeBundle(draft) as unknown as Record<string, unknown>;
  }
  return null;
}

/**
 * Parse a `Tenant.Theme` preference value and return the DEFAULT theme's
 * `draft` (the one whose `id === defaultThemeId`, else the first). Null on
 * missing/invalid input. Mirrors `@ui-core/theme`'s parseTenantThemePayload +
 * getDefaultTheme (the platform's runtime applier).
 */
export function parseTenantThemeDefaultDraft(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const themes = parsed?.themes;
    if (!Array.isArray(themes) || themes.length === 0) return null;
    const defaultId = parsed.defaultThemeId;
    const named =
      themes.find((t) => t && typeof t === 'object' && (t as Record<string, unknown>).id === defaultId) ??
      themes[0];
    const draft = (named as Record<string, unknown> | undefined)?.draft;
    if (!draft || typeof draft !== 'object') return null;
    return draft as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Convert a tenant theme `draft` (`{ colors:{primary,secondary,tertiary},
 * standardColors, fontFamily, … }`) into a theme bundle applyTheme consumes.
 * Mirrors `@ui-core/theme`'s buildBundleFromDraft: merge the draft's color
 * families (with `default` = shade 500) onto DEFAULT_THEME, leaving every other
 * family at its default. fontFamily is intentionally dropped so the bundled
 * 'Source Sans 3 Variable' face wins (the starter ships only that family);
 * `standardColors` are left to the base, matching the platform.
 */
export function tenantDraftToThemeBundle(
  draft: Record<string, unknown>,
): ThemeBundle {
  const baseLight = stripFontFamily(DEFAULT_THEME.light);
  const baseColors = (baseLight.colors ?? {}) as Record<
    string,
    Record<string, string>
  >;
  const draftColors = (draft.colors ?? {}) as Record<
    string,
    Record<string, string>
  >;

  const colors: Record<string, unknown> = { ...baseColors };
  for (const family of DRAFT_COLOR_FAMILIES) {
    const fam = draftColors[family];
    if (!fam || typeof fam !== 'object') continue;
    colors[family] = {
      ...(baseColors[family] ?? {}),
      ...fam,
      ...(fam['500'] ? { default: fam['500'] } : {}),
    };
  }

  const merged: Record<string, unknown> = { ...baseLight, colors };
  // Dark side reverses the (merged) BRAND ramp so the tenant's gold flips in
  // dark mode instead of the light ramp being pinned inline. See toDarkRecord.
  return { light: merged, dark: toDarkRecord(merged) };
}

/** http(s)://, protocol-relative `//host`, or any `scheme://`. */
const ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * Resolve a branding asset value to a usable URL (PHX-4278).
 *
 * Tenant/App logo & favicon values are Drive PUBLIC_ASSETS *storage keys*
 * (e.g. "PUBLIC_ASSETS/<tenant>/branding/.../logo.jpeg"), which are served from
 * the host root. A bare key has no base URL, so the browser would resolve it
 * relative to the current route and 404. Prepend the origin to make an absolute
 * URL. Values that are already absolute URLs, protocol-relative, data/blob URIs,
 * or root-relative paths are returned unchanged.
 *
 * `origin` defaults to the current window origin; pass it explicitly in tests.
 * With no origin (SSR / no DOM) the value is returned untouched.
 */
export function resolveAssetUrl(
  value: string | null | undefined,
  origin: string | undefined = typeof window !== 'undefined'
    ? window.location.origin
    : undefined,
): string | null {
  if (!value) return null;
  if (
    ABSOLUTE_URL_RE.test(value) ||
    /^(?:data|blob):/i.test(value) ||
    value.startsWith('/')
  ) {
    return value;
  }
  if (!origin) return value;
  return `${origin.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;
}

/**
 * Resolve the origin that serves the tenant's PUBLIC_ASSETS (PHX-4278).
 *
 * Public assets live at the TENANT host (`https://<tenant>.<envDomain>/<key>`),
 * but the generated app renders inside the **editor preview iframe**, whose
 * origin is `https://<workspace-id>.editors.<envDomain>` — NOT the tenant host.
 * Using `window.location.origin` there points assets at the editor host and
 * 404s. So when we detect an `….editors.<envDomain>` host we rebuild the tenant
 * host from the tenant name + the env domain parsed off the current hostname.
 *
 * Outside the editor (a deployed app, where the host already IS the tenant
 * host, or local dev) we return `currentOrigin` unchanged — matching the
 * platform's `getPublicAssetUrl`/`getHost` behaviour.
 *
 * Pure + testable: pass `tenant`, `hostname`, and `currentOrigin` explicitly.
 */
export function tenantAssetOrigin(
  tenant: string | null | undefined,
  hostname: string | null | undefined,
  currentOrigin: string | null | undefined,
): string | undefined {
  const fallback = currentOrigin ?? undefined;
  if (!hostname) return fallback;
  const host = hostname.split(':')[0];
  const labels = host.split('.').filter(Boolean);
  const editorsIdx = labels.indexOf('editors');
  // Editor preview host: <workspace-id>.editors.<envDomain>
  if (editorsIdx >= 0 && tenant) {
    const envDomain = labels.slice(editorsIdx + 1).join('.');
    if (envDomain) return `https://${tenant}.${envDomain}`;
  }
  return fallback;
}

/**
 * Resolve which theme to apply: the tenant's `App.Theme` when present,
 * otherwise `DEFAULT_THEME`. Exported for unit testing.
 *
 * Defence-in-depth for fonts: when falling back to `DEFAULT_THEME` (no tenant
 * theme), we DROP `fontFamily` so the runtime `--font-family-primary` slot is
 * left unset and the CSS `--font-sans` fallback chain resolves
 * `'Source Sans 3 Variable'` (the bundled face) directly. A tenant
 * `App.Theme.fontFamily.primary`, when present, is applied verbatim and wins.
 */
export function resolveTheme(
  branding: Branding,
): Record<string, unknown> | ThemeBundle {
  if (branding.theme) return branding.theme;
  // Default theme: fontFamily omitted so the CSS fallback owns the font.
  return DEFAULT_THEME_NO_FONT;
}

/**
 * Apply the resolved branding theme to the DOM. Tenant `App.Theme` wins;
 * a missing/invalid theme falls back to `DEFAULT_THEME`.
 */
export function applyBrandingTheme(
  branding: Branding,
  mode: ThemeMode = 'light',
): void {
  applyTheme(resolveTheme(branding), mode);
}

/**
 * Point all `<link rel="icon">` elements at the per-tenant favicon (or
 * create one when none exist). No-op when `url` is falsy or there's no
 * document (SSR / tests).
 */
export function applyFavicon(url: string | null): void {
  if (!url || typeof document === 'undefined') return;
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
  if (links.length === 0) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = url;
    document.head.appendChild(link);
    return;
  }
  links.forEach((link) => {
    link.href = url;
  });
}

/**
 * Apply the full branding side effects: theme tier + favicon + the
 * `--logo-height` CSS variable. Idempotent; safe to call on every prefs
 * change. The logo URL itself is consumed by the chrome via the branding
 * context, not written to the DOM here.
 */
export function applyBranding(
  branding: Branding,
  mode: ThemeMode = 'light',
): void {
  applyBrandingTheme(branding, mode);
  applyFavicon(branding.faviconUrl);
  if (branding.logoHeight && typeof document !== 'undefined') {
    document.documentElement.style.setProperty(
      '--logo-height',
      branding.logoHeight,
    );
  }
}
