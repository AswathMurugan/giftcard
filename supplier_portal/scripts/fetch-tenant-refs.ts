/**
 * Fetches stable TENANT REFERENCE DATA and emits typed snapshots + catalogs:
 *
 *   - roles              GET  /api/internal/roles
 *   - permission-groups  GET  /api/internal/permission-groups
 *   - org                POST /data/internal/query/org      (DynQL body)
 *   - org_level          POST /data/internal/query/org_level (DynQL body)
 *
 * These are tenant config / hierarchy that does NOT change within a session,
 * so we snapshot them to disk (typed const + agent-facing catalog) rather
 * than fetch at runtime — the agent gets real ids/codes/names at generation
 * time with no extra round-trip. Mirrors the entity / saved-query codegen
 * structure (deterministic output, writeIfChanged, FETCH_*_OUT_DIR override).
 *
 * Emits into <outDir> (default src/types/):
 *   roles.generated.ts            + roles.catalog.md
 *   permission-groups.generated.ts + permission-groups.catalog.md
 *   org.generated.ts              + org.catalog.md
 *   org-levels.generated.ts       + org-levels.catalog.md
 *
 * These are flat files under src/types/ (like app.generated.ts) — tracked as
 * empty stubs in git, overwritten with live data at session bootstrap. The
 * `prune stale` step is intentionally omitted (the dir holds other files).
 *
 * App context: this is TENANT-wide reference data, not app-scoped. The
 * permission-groups + org/org_level endpoints still REQUIRE an
 * `X-Jiffy-App-Name` header (they 400 without one), but the value only
 * selects a *visibility lens* — the editor's current app would return a
 * narrowed subset, so we always send the platform lens (`platform`) to
 * capture the full tenant set. roles needs no header at all.
 *
 * Config (env-only):
 *   - PHOENIX_API_URL
 *   - TENANT_ID
 *   - FETCH_TENANT_REFS_OUT_DIR    (optional) output dir override
 *
 * Invocation:
 *   npm run fetch:tenant-refs
 *   npx tsx scripts/fetch-tenant-refs.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  renderSnapshotCatalog,
  renderSnapshotTs,
  type SnapshotRecord,
  type SnapshotSpec,
} from '../src/lib/snapshot-codegen';
import { phoenixUrl, withAuth } from './lib/phoenix-http';

// =============================================================================
// .env loader (no dotenv dep — same approach as the other fetch-* scripts)
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
    if (process.env[key] === undefined) process.env[key] = value;
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

// =============================================================================
// HTTP helpers
// =============================================================================

/**
 * The platform-level app lens. permission-groups + org/org_level require an
 * `X-Jiffy-App-Name` header; sending the platform lens returns the full
 * TENANT-wide set rather than the editor app's narrowed subset.
 */
const PLATFORM_APP = 'platform';

interface FetchCtx {
  apiUrl: string;
  tenant: string;
}

function baseHeaders(ctx: FetchCtx): Record<string, string> {
  return withAuth({
    accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Jiffy-Tenant': ctx.tenant,
    // Tenant-wide lens — required by permission-groups + org queries; a no-op
    // for roles. Always `platform` so we capture the full tenant set.
    'X-Jiffy-App-Name': PLATFORM_APP,
  });
}

/** Coerce any response into an array of records (tolerate {data:[...]}). */
function toRecords(data: unknown, url: string): SnapshotRecord[] {
  if (Array.isArray(data)) return data as SnapshotRecord[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as SnapshotRecord[];
  }
  throw new Error(
    `Unexpected response shape from ${url}: expected an array, got ${typeof data}`,
  );
}

async function getList(
  ctx: FetchCtx,
  path: string,
): Promise<SnapshotRecord[]> {
  const url = phoenixUrl(`${ctx.apiUrl.replace(/\/+$/, '')}${path}`);
  const res = await fetch(url, { method: 'GET', headers: baseHeaders(ctx) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GET ${url} failed: ${res.status} ${res.statusText}\n${body.slice(0, 400)}`,
    );
  }
  return toRecords(await res.json(), url);
}

async function postQuery(
  ctx: FetchCtx,
  path: string,
  body: unknown,
): Promise<SnapshotRecord[]> {
  const url = phoenixUrl(`${ctx.apiUrl.replace(/\/+$/, '')}${path}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: baseHeaders(ctx),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `POST ${url} failed: ${res.status} ${res.statusText}\n${text.slice(0, 400)}`,
    );
  }
  return toRecords(await res.json(), url);
}

// =============================================================================
// Snapshot definitions
// =============================================================================

interface SnapshotJob {
  /** Output file stem (kebab) → `<stem>.generated.ts` + `<stem>.catalog.md`. */
  stem: string;
  spec: SnapshotSpec;
  fetch: (ctx: FetchCtx) => Promise<SnapshotRecord[]>;
}

const SCRIPT = 'scripts/fetch-tenant-refs.ts';

const JOBS: SnapshotJob[] = [
  {
    stem: 'roles',
    spec: {
      pascal: 'Roles',
      constName: 'ROLES',
      title: 'Roles',
      source: 'Phoenix /api/internal/roles',
      script: SCRIPT,
      catalogColumns: [
        'id',
        'name',
        'description',
        'app_definition_key',
        'is_primary',
        'is_platform_role',
      ],
    },
    fetch: (ctx) => getList(ctx, '/api/internal/roles'),
  },
  {
    stem: 'permission-groups',
    spec: {
      pascal: 'PermissionGroups',
      constName: 'PERMISSION_GROUPS',
      title: 'Permission Groups',
      source: 'Phoenix /api/internal/permission-groups',
      script: SCRIPT,
      catalogColumns: ['id', 'name', 'description', 'app_definition_key'],
    },
    fetch: (ctx) => getList(ctx, '/api/internal/permission-groups'),
  },
  {
    stem: 'org',
    spec: {
      pascal: 'Orgs',
      constName: 'ORGS',
      title: 'Orgs',
      source: 'Phoenix /data/internal/query/org',
      script: SCRIPT,
      catalogColumns: [
        'id',
        'code',
        'name',
        'level',
        'unique_code',
        'unique_path',
      ],
    },
    fetch: (ctx) =>
      postQuery(ctx, '/data/internal/query/org', {
        org: {
          select: { '*': true, parent_org: { select: { id: true } } },
        },
      }),
  },
  {
    stem: 'org-levels',
    spec: {
      pascal: 'OrgLevels',
      constName: 'ORG_LEVELS',
      title: 'Org Levels',
      source: 'Phoenix /data/internal/query/org_level',
      script: SCRIPT,
      catalogColumns: ['id', 'name', 'description', 'level_order'],
    },
    fetch: (ctx) =>
      postQuery(ctx, '/data/internal/query/org_level', {
        org_level: { select: { '*': true } },
      }),
  },
];

// =============================================================================
// Main
// =============================================================================

interface RunOptions {
  envPath: string;
  outDir: string;
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
      `fetch-tenant-refs: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:tenant-refs\`.`,
    );
    // Emit empty stubs so imports still typecheck.
    // PHX-4513: only on first run — never clobber a populated snapshot when
    // skipping for missing creds.
    mkdirSync(opts.outDir, { recursive: true });
    for (const job of JOBS) {
      const tsPath = resolve(opts.outDir, `${job.stem}.generated.ts`);
      const mdPath = resolve(opts.outDir, `${job.stem}.catalog.md`);
      if (!existsSync(tsPath)) {
        writeIfChanged(tsPath, renderSnapshotTs(job.spec, []));
      } else {
        console.log(
          `fetch-tenant-refs: preserving existing ${tsPath} ` +
            `(not overwriting with an empty stub).`,
        );
      }
      if (!existsSync(mdPath)) {
        writeIfChanged(mdPath, renderSnapshotCatalog(job.spec, []));
      }
    }
    return;
  }

  const ctx: FetchCtx = { apiUrl, tenant };
  mkdirSync(opts.outDir, { recursive: true });

  let written = 0;
  let unchanged = 0;
  for (const job of JOBS) {
    let records: SnapshotRecord[] = [];
    try {
      console.log(`fetch-tenant-refs: ${job.spec.source} (tenant=${tenant})`);
      records = await job.fetch(ctx);
    } catch (err) {
      // Soft-fail per job: a missing/forbidden endpoint shouldn't block the
      // others. Emit an empty snapshot so imports keep compiling.
      console.log(
        `fetch-tenant-refs: ${job.stem} failed — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      );
    }
    const tsPath = resolve(opts.outDir, `${job.stem}.generated.ts`);
    const mdPath = resolve(opts.outDir, `catalogs/${job.stem}.catalog.md`);
    if (writeIfChanged(tsPath, renderSnapshotTs(job.spec, records))) written++;
    else unchanged++;
    if (writeIfChanged(mdPath, renderSnapshotCatalog(job.spec, records)))
      written++;
    else unchanged++;
    console.log(`fetch-tenant-refs: ${job.stem} → ${records.length} records`);
  }

  console.log(
    `fetch-tenant-refs: done → ${opts.outDir} ` +
      `(${written} written, ${unchanged} unchanged)`,
  );
}

// CLI entry
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.env.FETCH_TENANT_REFS_OUT_DIR
    ? resolve(process.env.FETCH_TENANT_REFS_OUT_DIR)
    : resolve(root, 'src/types');
  run({ envPath: resolve(root, '.env'), outDir }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
