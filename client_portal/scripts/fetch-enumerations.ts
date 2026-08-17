/**
 * Fetches enumeration component definitions for a configured tenant from
 * the Phoenix `/api/internal/component-definitions-all/enum` endpoint and
 * emits per-enumeration TypeScript modules into `src/types/enumerations/`.
 *
 * Each enumeration becomes:
 *
 *   export const ACCOUNT_TYPE_VALUES = [
 *     'Individual', 'Joint', 'Trust', 'Retirement', 'Corporate',
 *   ] as const;
 *   export type AccountType = typeof ACCOUNT_TYPE_VALUES[number];
 *
 * Plus a registry `src/types/enumerations.generated.ts` mapping each enum
 * name to its values + a `EnumerationName` union for type-level lookup.
 *
 * Config (read from `.env` or process env):
 *   - PHOENIX_API_URL                e.g. https://jiffy.us.sandbox.phoenix.jiffy.ai
 *   - TENANT_ID                      e.g. aiwithdata
 *   - FETCH_ENUMERATIONS_OUT_DIR     (optional) absolute path to write into.
 *                                    Defaults to <project>/src/types/enumerations.
 *
 * Invocation:
 *   npm run fetch:enumerations
 *   # or directly:
 *   npx tsx scripts/fetch-enumerations.ts
 *
 * Output is deterministic (sorted) and the script skips writes when a
 * file's content is unchanged. Pure helpers live in
 * `src/lib/enumerations-codegen.ts` so vitest can exercise them.
 *
 * Today (May 2026) the endpoint exists and is reachable for tenants but
 * is empty for `aiwithdata`. The script handles the empty case by
 * emitting an empty registry stub so downstream entity / saved-query
 * codegen can run an enum-lookup against `{}` without special-casing.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  enumClassName,
  enumConstName,
  enumFileStem,
  normaliseEnumeration,
  renderEnumerationFile,
  renderEnumerationsBarrelFile,
  renderEnumerationsGeneratedFile,
  type PhoenixEnumeration,
  type RenderedEnumeration,
} from '../src/lib/enumerations-codegen';
import {
  detectNameCollisions,
  formatCollisionWarning,
  appKeyDir,
} from '../src/lib/codegen-collisions';
import { phoenixUrl, withAuth } from './lib/phoenix-http';

// =============================================================================
// .env loader (no `dotenv` dep — matches the other fetchers)
// =============================================================================

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

/** All `.ts` files under `dir`, recursing into per-app subfolders. */
function listEnumTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...listEnumTsFilesRecursive(full));
    else if (ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// =============================================================================
// API call
// =============================================================================

async function fetchEnumerations(
  apiUrl: string,
  tenant: string,
): Promise<PhoenixEnumeration[]> {
  const base = apiUrl.replace(/\/+$/, '');
  const url = phoenixUrl(`${base}/api/internal/component-definitions-all/enum`);

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
  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected response shape from ${url}: expected an array, got ${typeof data}`,
    );
  }
  return data as PhoenixEnumeration[];
}

// =============================================================================
// Main
// =============================================================================

interface RunOptions {
  envPath: string;
  outDir: string;
  generatedTypesPath: string;
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
      `fetch-enumerations: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:enumerations\`.`,
    );
    // Emit an empty registry so the entity / saved-query codegen can
    // import it without exploding even when this script was skipped.
    // PHX-4513: only on first run — never clobber a populated registry when
    // skipping for missing creds.
    mkdirSync(dirname(opts.generatedTypesPath), { recursive: true });
    if (!existsSync(opts.generatedTypesPath)) {
      writeIfChanged(
        opts.generatedTypesPath,
        renderEnumerationsGeneratedFile([]),
      );
    } else {
      console.log(
        `fetch-enumerations: preserving existing ${opts.generatedTypesPath} ` +
          `(not overwriting with an empty registry).`,
      );
    }
    return;
  }

  console.log(
    `fetch-enumerations: GET ${apiUrl}/api/internal/component-definitions-all/enum (tenant=${tenant})`,
  );

  const raw = await fetchEnumerations(apiUrl, tenant);
  // Normalise but keep the owning app key (drives the per-app folder).
  const normalised = raw
    .map((entry) => {
      const n = normaliseEnumeration(entry);
      return n
        ? { name: n.name, values: n.values, appKey: entry?.app_definition_key ?? '' }
        : null;
    })
    .filter(
      (e): e is { name: string; values: string[]; appKey: string } => !!e,
    );

  // Surface cross-app collisions.
  const enumCollisionWarning = formatCollisionWarning(
    'enumeration',
    detectNameCollisions(
      raw
        .filter((e): e is PhoenixEnumeration => !!e && typeof e.name === 'string' && !!e.name)
        .map((e) => ({ name: e.name, appKey: e.app_definition_key ?? '' })),
    ),
  );
  if (enumCollisionWarning) console.warn(enumCollisionWarning);

  // De-dupe by the GENERATED identities, not the raw name. Two different enum
  // names can collide on any of the three artifacts codegen emits:
  //   • file path   — `enumFileStem` is case-PRESERVING and the macOS FS is
  //     case-INSENSITIVE, so `…_Deposit_Date` vs `…_Deposit_date` are the same
  //     file (→ TS1149 / TS2307 stale-casing).
  //   • exported type — `enumClassName` (PascalCase); `Party_Types_Entity` and
  //     `PartyTypes_Entity` both → `PartyTypesEntity` (→ TS2308 via `export *`).
  //   • exported const — `enumConstName` (`*_VALUES`) (→ TS2300 duplicate import).
  // Skip an enum when ANY of those identities was already taken (keep first).
  // The collision warning above still surfaces the raw-name clash for visibility.
  const seenFile = new Set<string>();
  const seenClass = new Set<string>();
  const seenConst = new Set<string>();
  const kept: { name: string; values: string[]; appKey: string }[] = [];
  for (const e of normalised) {
    const fileKey = `${appKeyDir(e.appKey)}/${enumFileStem(e.name)}`.toLowerCase();
    const classKey = enumClassName(e.name);
    const constKey = enumConstName(e.name);
    if (seenFile.has(fileKey) || seenClass.has(classKey) || seenConst.has(constKey)) {
      continue;
    }
    seenFile.add(fileKey);
    seenClass.add(classKey);
    seenConst.add(constKey);
    kept.push({ name: e.name, values: e.values, appKey: e.appKey });
  }
  const sorted = kept.sort((a, b) => a.name.localeCompare(b.name));

  mkdirSync(opts.outDir, { recursive: true });

  const generatedFiles = new Set<string>();
  const rendered: RenderedEnumeration[] = [];
  let written = 0;
  let unchanged = 0;

  for (const { name, values, appKey } of sorted) {
    // Fold under the app-definition-key folder.
    const filePath = resolve(opts.outDir, appKeyDir(appKey), `${enumFileStem(name)}.ts`);
    generatedFiles.add(filePath);
    const r = renderEnumerationFile(name, values, appKey);
    rendered.push(r);
    if (writeIfChanged(filePath, r.source)) written++;
    else unchanged++;
  }

  // Barrel
  const barrelPath = resolve(opts.outDir, 'index.ts');
  generatedFiles.add(barrelPath);
  if (writeIfChanged(barrelPath, renderEnumerationsBarrelFile(rendered))) {
    written++;
  } else {
    unchanged++;
  }

  // Registry
  const registryContents = renderEnumerationsGeneratedFile(rendered);
  if (writeIfChanged(opts.generatedTypesPath, registryContents)) {
    written++;
    console.log(
      `fetch-enumerations: also wrote ${opts.generatedTypesPath}`,
    );
  } else {
    unchanged++;
  }

  // Prune stale per-enum .ts files recursively (removes old flat-layout files
  // + any per-app file no longer produced).
  let removed = 0;
  for (const full of listEnumTsFilesRecursive(opts.outDir)) {
    if (!generatedFiles.has(full)) {
      unlinkSync(full);
      removed++;
    }
  }

  console.log(
    `fetch-enumerations: ${sorted.length} enumerations → ${opts.outDir} ` +
      `(${written} written, ${unchanged} unchanged, ${removed} removed)`,
  );
}

// CLI entry
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.env.FETCH_ENUMERATIONS_OUT_DIR
    ? resolve(process.env.FETCH_ENUMERATIONS_OUT_DIR)
    : resolve(root, 'src/types/enumerations');
  const generatedTypesPath = resolve(outDir, '../enumerations.generated.ts');
  run({
    envPath: resolve(root, '.env'),
    outDir,
    generatedTypesPath,
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
