/**
 * Fetches the tenant/app BRANDING preferences (favicon, logo, theme) from
 * Phoenix `GET /api/internal/preferences` and bakes them into
 * `<workspace>/src/types/preferences.generated.ts` so the runtime can apply
 * branding on FIRST PAINT — before the live merged-preferences fetch resolves.
 *
 * usePreferences() seeds these as placeholder data; BrandingProvider reads them
 * through the same `extractBranding` keys it uses at runtime, and the live
 * `/api/preferences?is_merged=true` fetch then overrides.
 *
 * The internal endpoint returns EVERY app's preferences, so we keep only the
 * Branding-category records for the CURRENT app (matched against
 * `app.generated.ts`'s `app_definition_key`) plus any tenant-level `Tenant.*`
 * records — mirroring `extractBranding`'s `App.* ?? Tenant.*` precedence.
 *
 * Per-org brand theme (PHX-5283): the endpoint is unmerged, so it can return a
 * `Tenant.Theme` per org. First paint has no signed-in user to resolve the org,
 * so `resolveFirstPaintTenantTheme` keeps only the tenant-wide theme (or none)
 * for the placeholder; the runtime merged fetch applies the user's org theme.
 *
 * Config (env-only, from `codegen-starter/.env` or process env), same pattern
 * as fetch-application.ts:
 *   - PHOENIX_API_URL
 *   - TENANT_ID
 *   - APP_NAME (or APP_ID)
 *   - FETCH_PREFERENCES_OUT_DIR (optional) absolute output dir; defaults to
 *     `<starter>/src/types`.
 *
 * Soft-fails (writes an empty list) on missing env / non-2xx so the runtime
 * always compiles and the worker boots either way.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { phoenixUrl, withAuth } from './lib/phoenix-http';

// ── .env loader (no dep — mirrors fetch-application.ts) ───────────────────────
function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ── Shape + filtering ─────────────────────────────────────────────────────────
export interface GeneratedPreference {
  name: string;
  value: string;
  category?: string;
  app_definition_key?: string;
  org?: string | null;
  user?: string | null;
  disabled?: boolean;
  [key: string]: unknown;
}

/**
 * Phoenix returns `org` / `user` as a link reference — either a bare id string,
 * a `{ id }` object, or null. Normalize to an id string (or null) so the baked
 * literal matches the declared `string | null` type (avoids TS2322 in the
 * generated file when a tenant has org-scoped branding preferences).
 */
export function refToId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

/** Keep Branding-category records for the current app + tenant-level fallbacks. */
export function selectBrandingPreferences(
  records: unknown,
  appDefinitionKey: string | null,
): GeneratedPreference[] {
  if (!Array.isArray(records)) return [];
  return records
    .filter((r): r is GeneratedPreference => !!r && typeof r === 'object')
    .filter((r) => (r.category ?? '').toLowerCase() === 'branding')
    .filter((r) => typeof r.name === 'string' && r.name.length > 0)
    .filter((r) => {
      // Current app's App.* records, or tenant-level Tenant.* records. When the
      // current app key is unknown, keep all branding (best-effort).
      if (r.name.startsWith('Tenant.')) return true;
      if (!appDefinitionKey) return true;
      return r.app_definition_key === appDefinitionKey;
    })
    .map((r) => ({
      name: r.name,
      value: typeof r.value === 'string' ? r.value : '',
      category: r.category,
      app_definition_key: r.app_definition_key,
      org: refToId(r.org),
      user: refToId(r.user),
      disabled: r.disabled === true,
    }));
}

/**
 * Resolve `Tenant.Theme` for the FIRST-PAINT bake (PHX-5283).
 *
 * The per-org brand theme is a set of `Tenant.Theme` records — one per org —
 * which the backend resolves to the caller's org at runtime via `is_merged`.
 * The bootstrap fetch runs WITHOUT a signed-in user, so it can't know which
 * org's record applies. To avoid baking (and flashing) a wrong org's theme,
 * keep at most ONE `Tenant.Theme` for the placeholder: the tenant-wide record
 * (`org == null`) when present, else drop them all and let the runtime merged
 * fetch (`usePreferences` → the `platform`-lens call) own the theme. Other
 * `Tenant.*` branding (logo/favicon) is left untouched.
 */
export function resolveFirstPaintTenantTheme(
  records: GeneratedPreference[],
): GeneratedPreference[] {
  const themes = records.filter((r) => r.name === 'Tenant.Theme');
  if (themes.length <= 1) return records;
  const nonTheme = records.filter((r) => r.name !== 'Tenant.Theme');
  const tenantWide = themes.find((r) => (r.org ?? null) === null);
  return tenantWide ? [...nonTheme, tenantWide] : nonTheme;
}

/** Read the current app's `app_definition_key` from app.generated.ts (best-effort). */
function readAppDefinitionKey(outDir: string): string | null {
  try {
    const gen = readFileSync(resolve(outDir, 'app.generated.ts'), 'utf8');
    const m = gen.match(/"app_definition_key"\s*:\s*"([^"]*)"/);
    return m && m[1] ? m[1] : null;
  } catch {
    return null;
  }
}

export function renderPreferencesTs(records: GeneratedPreference[]): string {
  const header = [
    '/* eslint-disable */',
    '// AUTO-GENERATED by scripts/fetch-preferences.ts - do not edit by hand.',
    '// Source: Phoenix GET /api/internal/preferences (Branding category, current app).',
    '//',
    '// Baked at workspace bootstrap so the tenant/app branding (favicon, logo,',
    '// theme) can be applied on first paint — BEFORE the runtime merged-preferences',
    '// fetch resolves. usePreferences() seeds these as placeholder data; the live',
    '// fetch then overrides. Empty in the shipped starter (no tenant bound yet).',
    '',
    'export interface GeneratedPreference {',
    '  name: string;',
    '  value: string;',
    '  category?: string;',
    '  app_definition_key?: string;',
    '  org?: string | null;',
    '  user?: string | null;',
    '  disabled?: boolean;',
    '  [key: string]: unknown;',
    '}',
    '',
  ].join('\n');
  return `${header}export const PREFERENCES: GeneratedPreference[] = ${JSON.stringify(records, null, 2)};\n`;
}

function writeIfChanged(filePath: string, contents: string): boolean {
  if (existsSync(filePath)) {
    if (readFileSync(filePath, 'utf8') === contents) return false;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return true;
}

// ── API call ──────────────────────────────────────────────────────────────────
async function fetchPreferences(
  apiUrl: string,
  tenant: string,
  appName: string,
): Promise<unknown> {
  const url = phoenixUrl(`${apiUrl.replace(/\/+$/, '')}/api/internal/preferences`);
  const res = await fetch(url, {
    method: 'GET',
    headers: withAuth({
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Jiffy-Tenant': tenant,
      'X-Jiffy-App-Name': appName,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Phoenix API call failed: ${res.status} ${res.statusText} for ${url}\n${body.slice(0, 500)}`,
    );
  }
  return (await res.json()) as unknown;
}

// ── Main ────────────────────────────────────────────────────────────────────
interface RunOptions {
  envPath: string;
  outDir: string;
  tsPath: string;
}

async function run(opts: RunOptions): Promise<void> {
  loadDotEnv(opts.envPath);

  const apiUrl = process.env.PHOENIX_API_URL?.trim();
  const tenant = process.env.TENANT_ID?.trim();
  const appName = (process.env.APP_NAME ?? process.env.APP_ID ?? '').trim();

  if (!apiUrl || !tenant || !appName) {
    const missing = [
      !apiUrl && 'PHOENIX_API_URL',
      !tenant && 'TENANT_ID',
      !appName && 'APP_NAME (or APP_ID)',
    ].filter(Boolean);
    // PHX-4513: only seed an empty stub on first run — never clobber a
    // populated preferences file when skipping for missing creds.
    mkdirSync(opts.outDir, { recursive: true });
    if (!existsSync(opts.tsPath)) {
      console.log(
        `fetch-preferences: skipped — ${missing.join(', ')} not set. ` +
          `Writing empty src/types/preferences.generated.ts.`,
      );
      writeIfChanged(opts.tsPath, renderPreferencesTs([]));
    } else {
      console.log(
        `fetch-preferences: skipped — ${missing.join(', ')} not set. ` +
          `Preserving existing ${opts.tsPath}.`,
      );
    }
    return;
  }

  console.log(
    `fetch-preferences: GET ${apiUrl.replace(/\/+$/, '')}/api/internal/preferences (tenant=${tenant}, app=${appName})`,
  );

  const raw = await fetchPreferences(apiUrl, tenant, appName);
  const appKey = readAppDefinitionKey(opts.outDir);
  const records = resolveFirstPaintTenantTheme(
    selectBrandingPreferences(raw, appKey),
  );

  mkdirSync(opts.outDir, { recursive: true });
  const written = writeIfChanged(opts.tsPath, renderPreferencesTs(records));
  console.log(
    `fetch-preferences: ${records.length} branding preference(s) ` +
      `(appKey=${appKey ?? 'unknown'}) → ${opts.tsPath} ` +
      `(${written ? 'written' : 'unchanged'})`,
  );
}

// CLI entry
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.env.FETCH_PREFERENCES_OUT_DIR
    ? resolve(process.env.FETCH_PREFERENCES_OUT_DIR)
    : resolve(root, 'src/types');
  run({
    envPath: resolve(root, '.env'),
    outDir,
    tsPath: resolve(outDir, 'preferences.generated.ts'),
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
