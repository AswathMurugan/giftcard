/**
 * Fetches every screen across the tenant from the Phoenix
 * `/api/internal/component-definitions-all/screen` endpoint (ONE call — the
 * `-all` variant returns all apps' screens, each tagged with its
 * `app_definition_key`) and emits the cross-app navigation catalog:
 *
 *   - src/types/catalogs/related-screens.catalog.md   (agent-facing menu of other apps'
 *     pages + their nav variables, grouped by app)
 *   - src/types/related-screens.generated.ts (typed registry the cross-app nav
 *     resolver consumes)
 *
 * Why one call: `component-definitions-all/screen` returns the whole tenant's
 * screens in a single response (verified ~206 screens / 28 apps), so we never
 * loop per app or send `X-Jiffy-App-Name`. We then filter to the apps related
 * to the current one (RELATED_APP_KEYS, comma-separated) and drop the current
 * app itself.
 *
 * See docs/CROSS-APP-NAVIGATION-PLAN.md §5 for the full design.
 *
 * Config (env-only, read from `.env` or the process env):
 *   - PHOENIX_API_URL    e.g. https://jiffy.us.sandbox.phoenix.jiffy.ai
 *   - TENANT_ID          e.g. aiwithdata
 *   - APP_NAME / APP_ID  (optional) the current app's key/slug to EXCLUDE
 *   - RELATED_APP_KEYS   (optional) comma-separated app_definition_keys to KEEP.
 *                        When unset, keeps every app except the current one.
 *   - FETCH_RELATED_SCREENS_OUT_DIR (optional) absolute dir to write into.
 *
 * Invocation:
 *   npm run fetch:related-screens
 *   # or: npx tsx scripts/fetch-related-screens.ts
 *
 * Output is deterministic (sorted) and writes are skipped when unchanged.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  buildRelatedApps,
  renderRelatedScreensCatalog,
  renderRelatedScreensGenerated,
  type RawScreen,
} from '../src/lib/related-screens-codegen';
import { phoenixUrl, withAuth } from './lib/phoenix-http';

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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function writeIfChanged(filePath: string, contents: string): boolean {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    if (existing === contents) return false;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return true;
}

async function fetchAllScreens(apiUrl: string, tenant: string): Promise<RawScreen[]> {
  const base = apiUrl.replace(/\/+$/, '');
  const url = phoenixUrl(`${base}/api/internal/component-definitions-all/screen`);
  const res = await fetch(url, {
    method: 'GET',
    headers: withAuth({
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Jiffy-Tenant': tenant,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Phoenix API call failed: ${res.status} ${res.statusText} for ${url}\n${body.slice(0, 500)}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as RawScreen[]) : [];
}

interface RunOptions {
  envPath: string;
  catalogPath: string;
  generatedPath: string;
}

async function run(opts: RunOptions): Promise<void> {
  loadDotEnv(opts.envPath);

  const apiUrl = process.env.PHOENIX_API_URL?.trim();
  const tenant = process.env.TENANT_ID?.trim();
  const currentAppKey = (process.env.APP_NAME ?? process.env.APP_ID ?? '').trim();
  const relatedAppKeys = (process.env.RELATED_APP_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!apiUrl || !tenant) {
    const missing =
      !apiUrl && !tenant
        ? 'PHOENIX_API_URL and TENANT_ID'
        : !apiUrl
          ? 'PHOENIX_API_URL'
          : 'TENANT_ID';
    console.log(
      `fetch-related-screens: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:related-screens\` to populate ` +
        `the cross-app screen catalog.`,
    );
    // PHX-4513: only seed empty stubs on first run — never clobber a
    // populated related-screens registry/catalog when skipping for missing
    // creds.
    if (!existsSync(opts.generatedPath)) {
      writeIfChanged(opts.generatedPath, renderRelatedScreensGenerated([]));
    } else {
      console.log(
        `fetch-related-screens: preserving existing ${opts.generatedPath} ` +
          `(not overwriting with an empty registry).`,
      );
    }
    if (!existsSync(opts.catalogPath)) {
      writeIfChanged(opts.catalogPath, renderRelatedScreensCatalog([]));
    }
    return;
  }

  console.log(
    `fetch-related-screens: GET ${apiUrl}/api/internal/component-definitions-all/screen (tenant=${tenant})`,
  );

  const rows = await fetchAllScreens(apiUrl, tenant);
  const apps = buildRelatedApps(rows, relatedAppKeys, currentAppKey);
  const totalScreens = apps.reduce((n, a) => n + a.screens.length, 0);

  const wroteGen = writeIfChanged(
    opts.generatedPath,
    renderRelatedScreensGenerated(apps),
  );
  const wroteCat = writeIfChanged(
    opts.catalogPath,
    renderRelatedScreensCatalog(apps),
  );

  console.log(
    `fetch-related-screens: ${rows.length} screens fetched → ` +
      `${apps.length} related apps, ${totalScreens} screens kept ` +
      `(${[wroteGen && 'generated', wroteCat && 'catalog'].filter(Boolean).join(' + ') || 'no changes'})` +
      `${relatedAppKeys.length ? '' : ' [RELATED_APP_KEYS unset → kept all non-current apps]'}`,
  );
}

// CLI entry
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.env.FETCH_RELATED_SCREENS_OUT_DIR
    ? resolve(process.env.FETCH_RELATED_SCREENS_OUT_DIR)
    : resolve(root, 'src/types');
  run({
    envPath: resolve(root, '.env'),
    catalogPath: resolve(outDir, 'catalogs/related-screens.catalog.md'),
    generatedPath: resolve(outDir, 'related-screens.generated.ts'),
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { run };
