/**
 * Fetches every platform SKILL (agent) across the tenant from the Phoenix
 * `/api/internal/component-definitions-all/skill-definition` endpoint (ONE call
 * — the `-all` variant returns all apps' skill-definitions, each tagged with its
 * `app_definition_key`) and emits:
 *
 *   - src/types/catalogs/skills.catalog.md   (agent-facing menu of the agents /
 *     skills available on the platform, grouped by app)
 *   - src/types/skills.generated.ts (typed registry app code imports)
 *
 * "Skills" are the platform's AGENTS. This mirrors the workflows / saved-query /
 * related-screens codegens: a single tenant-wide GET → generated types + a
 * catalog, refreshed on every workspace cold-boot.
 *
 * Config (env-only, read from `.env` or the process env):
 *   - PHOENIX_API_URL    e.g. https://jiffy.us.sandbox.phoenix.jiffy.ai
 *   - TENANT_ID          e.g. aiwithdata
 *   - FETCH_SKILLS_OUT_DIR (optional) absolute dir to write into.
 *                        Defaults to <project>/src/types.
 *
 * Invocation:
 *   npm run fetch:skills
 *   # or: npx tsx scripts/fetch-skills.ts
 *
 * Output is deterministic (sorted) and writes are skipped when unchanged.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  buildSkillApps,
  flattenSkills,
  renderSkillsCatalog,
  renderSkillsGenerated,
  type RawSkill,
} from '../src/lib/skills-codegen';
import { detectNameCollisions, formatCollisionWarning } from '../src/lib/codegen-collisions';
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

async function fetchAllSkills(apiUrl: string, tenant: string): Promise<RawSkill[]> {
  const base = apiUrl.replace(/\/+$/, '');
  const url = phoenixUrl(
    `${base}/api/internal/component-definitions-all/skill-definition`,
  );
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
  return Array.isArray(data) ? (data as RawSkill[]) : [];
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

  if (!apiUrl || !tenant) {
    const missing =
      !apiUrl && !tenant
        ? 'PHOENIX_API_URL and TENANT_ID'
        : !apiUrl
          ? 'PHOENIX_API_URL'
          : 'TENANT_ID';
    console.log(
      `fetch-skills: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:skills\` to populate ` +
        `the platform skills catalog.`,
    );
    // PHX-4513: only seed empty stubs on first run — never clobber a
    // populated skills registry/catalog when skipping for missing creds.
    if (!existsSync(opts.generatedPath)) {
      writeIfChanged(opts.generatedPath, renderSkillsGenerated([]));
    } else {
      console.log(
        `fetch-skills: preserving existing ${opts.generatedPath} ` +
          `(not overwriting with an empty registry).`,
      );
    }
    if (!existsSync(opts.catalogPath)) {
      writeIfChanged(opts.catalogPath, renderSkillsCatalog([]));
    }
    return;
  }

  console.log(
    `fetch-skills: GET ${apiUrl}/api/internal/component-definitions-all/skill-definition (tenant=${tenant})`,
  );

  const rows = await fetchAllSkills(apiUrl, tenant);
  const apps = buildSkillApps(rows);
  const totalSkills = apps.reduce((n, a) => n + a.skills.length, 0);

  // Surface cross-app name collisions (two apps defining the same skill name).
  // The generated SKILL_APP_KEYS folds them to the last occurrence; warn so the
  // duplicate is visible rather than silently deduped — same as fetch-entities
  // / fetch-enumerations etc.
  const collisionWarning = formatCollisionWarning(
    'skill',
    detectNameCollisions(flattenSkills(apps)),
  );
  if (collisionWarning) console.warn(collisionWarning);

  const wroteGen = writeIfChanged(opts.generatedPath, renderSkillsGenerated(apps));
  const wroteCat = writeIfChanged(opts.catalogPath, renderSkillsCatalog(apps));

  console.log(
    `fetch-skills: ${rows.length} skill-definitions fetched → ` +
      `${apps.length} apps, ${totalSkills} skills kept ` +
      `(${[wroteGen && 'generated', wroteCat && 'catalog'].filter(Boolean).join(' + ') || 'no changes'})`,
  );
}

// CLI entry
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.env.FETCH_SKILLS_OUT_DIR
    ? resolve(process.env.FETCH_SKILLS_OUT_DIR)
    : resolve(root, 'src/types');
  run({
    envPath: resolve(root, '.env'),
    catalogPath: resolve(outDir, 'catalogs/skills.catalog.md'),
    generatedPath: resolve(outDir, 'skills.generated.ts'),
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { run };
