/**
 * Fetches workflow definitions for the configured tenant from the Phoenix
 * `/api/internal/component-definitions-all/workflow` endpoint and emits
 * per-workflow TypeScript modules into `src/types/workflows/`.
 *
 * Workflows are SERVER-side actions with side effects (create_user,
 * approve_account, send_notification, …). The runtime hook
 * `useWorkflow(name)` exposes them as typed React Query mutations
 * (mutate / mutateAsync / isPending / data / error), matching the
 * shape of `useEntityMutation` but typed via the workflow registry
 * generated below.
 *
 * Execute contract (V1, sync only):
 *
 *   POST /workflow/v1/execute/sync/{name}
 *   Body: JSON object of inputs (entity refs as `{ id: string }`).
 *   Response: workflow output directly.
 *
 * Async workflows (the Phoenix definition flags via `is_async: true`)
 * are silently skipped with a console.log + a catalog entry marked
 * `async workflow — Skipped`. A future sub-task can add async support
 * by extending the URL contract (e.g. `/workflow/v1/execute/async/`)
 * and a polling state machine in `useWorkflow`.
 *
 * Config (env-only, read from `.env` or the process env):
 *   - PHOENIX_API_URL                e.g. https://jiffy.us.sandbox.phoenix.jiffy.ai
 *   - TENANT_ID                      e.g. aiwithdata
 *   - FETCH_WORKFLOWS_OUT_DIR        (optional) absolute path to write into.
 *                                    Defaults to <project>/src/types/workflows.
 *
 * Invocation:
 *   npm run fetch:workflows
 *   # or directly:
 *   npx tsx scripts/fetch-workflows.ts
 *
 * Output is deterministic (sorted) and the script skips writes when a file's
 * content is unchanged.
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
  attrTsType,
  buildResolverContext,
  buildWorkflowExecuteUrl,
  renderExecuteHeadersLine,
  renderInterface,
  renderWorkflowCatalog,
  workflowConstCase,
  workflowFileStem,
  workflowPascalCase,
  type WorkflowAttribute,
  type WorkflowCatalogEntry,
  type WorkflowDefinition,
} from '../src/lib/workflows-codegen';
import {
  buildComponentIndex,
  parseComponentReference,
  type ComponentDefinition,
  type ComponentIndex,
} from '../src/lib/cross-component-refs';
import {
  detectNameCollisions,
  formatCollisionWarning,
  appKeyDir,
} from '../src/lib/codegen-collisions';
import { phoenixUrl, withAuth } from './lib/phoenix-http';

// =============================================================================
// .env loader (no `dotenv` dep — keep the script lean, same approach as
// fetch-saved-queries.ts so all three stay in sync)
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

// =============================================================================
// Per-workflow module emitter
// =============================================================================

interface RenderedWorkflow {
  source: string;
  name: string;
  /** Registry key — bare `name` for the first occurrence, `name__<appKeyDir>`
   *  for later cross-app duplicates (kept as files, omitted from the typed
   *  registry which stays bare/wire-correct for `useWorkflow`). */
  registryName?: string;
  pascal: string;
  appKey: string;
  isAsyncSkipped: boolean;
  inputTypeName: string;
  outputTypeName: string;
  label: string;
  description: string;
  inputNames: { name: string; required: boolean; resolvedFrom?: string }[];
  outputNames: { name: string; resolvedFrom?: string }[];
  tags: string[];
  subType: string;
}

/**
 * Returns the `component_reference` of the attribute when it points at
 * a cross-component target that the index can locate (and is not an
 * entity ref nor a same-workflow internal). Returns `undefined`
 * otherwise — caller treats the field as plain-typed and omits the
 * `resolved from` catalog annotation.
 */
function detectResolvedFrom(
  attr: WorkflowAttribute,
  workflowName: string,
  componentIndex: ComponentIndex,
): string | undefined {
  const ref = attr.component_reference;
  if (!ref) return undefined;
  const parsed = parseComponentReference(ref);
  if (!parsed) return undefined;
  if (parsed.componentType === 'entity') return undefined;
  // Same-workflow internal — already resolved on this side.
  if (
    parsed.componentType === 'workflow' &&
    parsed.componentName === workflowName
  ) {
    return undefined;
  }
  const hit = componentIndex.get(parsed.componentType, parsed.componentName);
  return hit ? ref : undefined;
}

function renderWorkflowFile(
  wf: WorkflowDefinition,
  componentIndex: ComponentIndex,
): RenderedWorkflow {
  const pascal = workflowPascalCase(wf.name);
  const prefix = workflowConstCase(wf.name);
  const ctx = buildResolverContext(wf, componentIndex);
  const allAttrs = wf.attributes ?? [];

  const inputs = allAttrs.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === 'input',
  );
  const outputs = allAttrs.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === 'output',
  );

  // Phoenix returns `app_definition_key` on the /api/internal endpoint;
  // the data-manager DTO uses `target_app_definition_key`. Prefer DTO.
  const appKey =
    wf.target_app_definition_key ?? wf.app_definition_key ?? '';

  const inputTypeName = `${pascal}Input`;
  const outputTypeName = `${pascal}Output`;
  const optionsTypeName = `Execute${pascal}Options`;
  const fnName = `execute${pascal}`;
  const executeUrl = buildWorkflowExecuteUrl(wf.name);

  // Header.
  const header: string[] = [];
  header.push(
    `// AUTO-GENERATED by scripts/fetch-workflows.ts - do not edit by hand.`,
  );
  header.push(
    `// Source: Phoenix /api/internal/component-definitions-all/workflow`,
  );
  header.push(
    `// Workflow: ${wf.name}${
      wf.label ? ` ("${wf.label.replace(/\r?\n/g, ' ').trim()}")` : ''
    }`,
  );
  const modeLabel = wf.is_async ? 'async (V1 codegen skips runtime emit)' : 'sync';
  header.push(
    `// Mode: ${modeLabel}${appKey ? `  |  App: ${appKey}` : ''}`,
  );
  if (wf.description) {
    header.push(`// ${wf.description.replace(/\r?\n/g, ' ').trim()}`);
  }
  header.push(``);
  header.push(`import { apiManager } from '@/services/api-manager';`);
  header.push(`import { getDataHeadersWithUser } from '@/config/api-config';`);
  header.push(``);

  const lines: string[] = [];

  // Input interface.
  if (inputs.length > 0) {
    lines.push(`/** Input parameters for the \`${wf.name}\` workflow. */`);
    lines.push(renderInterface(inputTypeName, inputs, ctx));
  } else {
    lines.push(
      `/** Input parameters for the \`${wf.name}\` workflow (none declared). */`,
    );
    lines.push(`export type ${inputTypeName} = Record<string, never>;`);
  }
  lines.push(``);

  // Output interface.
  if (outputs.length > 0) {
    lines.push(`/** Output shape returned by the \`${wf.name}\` workflow. */`);
    // Handle the common "single top-level object output" pattern by
    // unwrapping inline so the consumer gets the inner shape directly.
    if (
      outputs.length === 1 &&
      (outputs[0].type ?? '').toLowerCase() === 'object'
    ) {
      const only = outputs[0];
      if (only.attributes && only.attributes.length > 0) {
        lines.push(renderInterface(outputTypeName, only.attributes, ctx));
      } else {
        // No inner attributes; emit a typed object alias.
        const tsType = attrTsType(only, ctx, 1, new Set());
        lines.push(`export type ${outputTypeName} = ${tsType};`);
      }
    } else {
      lines.push(renderInterface(outputTypeName, outputs, ctx));
    }
  } else {
    lines.push(
      `/** Output shape returned by the \`${wf.name}\` workflow (undeclared). */`,
    );
    lines.push(`export type ${outputTypeName} = unknown;`);
  }
  lines.push(``);

  // Constants.
  lines.push(`export const ${prefix}_NAME = ${JSON.stringify(wf.name)};`);
  lines.push(`export const ${prefix}_APP_KEY = ${JSON.stringify(appKey)};`);
  lines.push(``);

  // Async workflows: emit types so the registry stays whole, but skip
  // the executeXxx wrapper so callers can't accidentally invoke the
  // wrong endpoint. Catalog flags these explicitly.
  if (wf.is_async) {
    lines.push(`// Async workflow — V1 codegen does not emit a runtime`);
    lines.push(`// wrapper. Types above are still useful for input shaping.`);
    lines.push(``);
    return {
      source: `${header.join('\n')}\n${lines.join('\n')}`,
      name: wf.name,
      pascal,
      appKey,
      isAsyncSkipped: true,
      inputTypeName,
      outputTypeName,
      label: wf.label ?? '',
      description: wf.description ?? '',
      inputNames: inputs.map((a) => ({
        name: a.name,
        required: a.required === true,
        resolvedFrom: detectResolvedFrom(a, wf.name, componentIndex),
      })),
      outputNames: outputs.map((a) => ({
        name: a.name,
        resolvedFrom: detectResolvedFrom(a, wf.name, componentIndex),
      })),
      tags: Array.isArray(wf.tags) ? wf.tags : [],
      subType: wf.sub_type ?? '',
    };
  }

  // Options interface — currently empty (workflows have no pagination /
  // sort / filter), but kept as a forward-compatible slot for things
  // like a per-call timeout. Keep the shape consistent with saved-query
  // wrappers so callers have a stable expectation.
  lines.push(`export interface ${optionsTypeName} {`);
  lines.push(
    `  /** Override the workflow's app definition key (rarely needed). */`,
  );
  lines.push(`  appDefinitionKey?: string;`);
  lines.push(`}`);
  lines.push(``);

  // Wrapper.
  lines.push(`/**`);
  lines.push(` * Execute the \`${wf.name}\` workflow synchronously.`);
  lines.push(` *`);
  lines.push(` * Side-effecting; should be triggered by user action, not on mount.`);
  lines.push(` */`);
  lines.push(`export async function ${fnName}(`);
  const inputOptional = inputs.length === 0 || inputs.every((a) => !a.required);
  lines.push(`  input${inputOptional ? '?' : ''}: ${inputTypeName},`);
  lines.push(`  options?: ${optionsTypeName},`);
  lines.push(`): Promise<${outputTypeName}> {`);
  lines.push(renderExecuteHeadersLine(prefix));
  lines.push(
    `  const response = await apiManager.post('workflow', ${JSON.stringify(executeUrl)}, input ?? {}, headers);`,
  );
  lines.push(`  return response.data as ${outputTypeName};`);
  lines.push(`}`);
  lines.push(``);

  return {
    source: `${header.join('\n')}\n${lines.join('\n')}`,
    name: wf.name,
    pascal,
    appKey,
    isAsyncSkipped: false,
    inputTypeName,
    outputTypeName,
    label: wf.label ?? '',
    description: wf.description ?? '',
    inputNames: inputs.map((a) => ({
      name: a.name,
      required: a.required === true,
      resolvedFrom: detectResolvedFrom(a, wf.name, componentIndex),
    })),
    outputNames: outputs.map((a) => ({
      name: a.name,
      resolvedFrom: detectResolvedFrom(a, wf.name, componentIndex),
    })),
    tags: Array.isArray(wf.tags) ? wf.tags : [],
    subType: wf.sub_type ?? '',
  };
}

// =============================================================================
// Aggregate file emitters
// =============================================================================

function renderBarrelFile(rendered: RenderedWorkflow[]): string {
  const lines: string[] = [];
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-workflows.ts - do not edit by hand.`,
  );
  lines.push(``);
  const sorted = [...rendered].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.appKey.localeCompare(b.appKey),
  );
  for (const r of sorted) {
    const path = `./${appKeyDir(r.appKey)}/${workflowFileStem(r.name)}`;
    if ((r.registryName ?? r.name) === r.name) {
      lines.push(`export * from '${path}';`);
    } else {
      lines.push(`// '${r.registryName}' (cross-app dup of '${r.name}') → import from '${path}'`);
    }
  }
  lines.push(``);
  return lines.join('\n');
}

function renderWorkflowsGeneratedFile(rendered: RenderedWorkflow[]): string {
  const lines: string[] = [];
  lines.push(`/* eslint-disable */`);
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-workflows.ts - do not edit by hand.`,
  );
  lines.push(
    `// Source: Phoenix /api/internal/component-definitions-all/workflow`,
  );
  lines.push(`// Regenerated on every workspace bootstrap; stays in sync with`);
  lines.push(`// src/types/workflows/*.ts.`);
  lines.push(``);

  if (rendered.length === 0) {
    lines.push(`export type WorkflowName = never;`);
    lines.push(``);
    lines.push(`export interface WorkflowSchema {}`);
    lines.push(``);
    lines.push(`export type WorkflowInputOf<_N extends WorkflowName> = never;`);
    lines.push(
      `export type WorkflowOutputOf<_N extends WorkflowName> = never;`,
    );
    lines.push(
      `export type WorkflowAppKeyOf<_N extends WorkflowName> = never;`,
    );
    lines.push(``);
    lines.push(
      `/** Runtime map of workflow name → classification tags. */`,
    );
    lines.push(
      `export const WORKFLOW_TAGS: Record<string, string[]> = {};`,
    );
    lines.push(``);
    return lines.join('\n');
  }

  const sortedAll = [...rendered].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.appKey.localeCompare(b.appKey),
  );
  // Only the primary (bare-named, first-wins) workflow per name goes into the
  // typed registry — its wire name stays bare (`useWorkflow(name)`). Cross-app
  // duplicates keep their foldered file + catalog entry.
  const sorted = sortedAll.filter((r) => (r.registryName ?? r.name) === r.name);
  for (const r of sorted) {
    lines.push(
      `import type { ${r.inputTypeName}, ${r.outputTypeName} } from './workflows/${appKeyDir(r.appKey)}/${workflowFileStem(r.name)}';`,
    );
  }
  lines.push(``);

  const namesUnion = sorted.map((r) => JSON.stringify(r.name)).join(' | ');
  lines.push(`/** All known workflow names (typed union). */`);
  lines.push(`export type WorkflowName = ${namesUnion};`);
  lines.push(``);

  lines.push(`/**`);
  lines.push(` * Master workflow registry. Consumed by useWorkflow to derive`);
  lines.push(` * input + output types per workflow name.`);
  lines.push(` */`);
  lines.push(`export interface WorkflowSchema {`);
  for (const r of sorted) {
    lines.push(`  ${JSON.stringify(r.name)}: {`);
    lines.push(`    input: ${r.inputTypeName};`);
    lines.push(`    output: ${r.outputTypeName};`);
    lines.push(`    appKey: ${JSON.stringify(r.appKey)};`);
    lines.push(`    isAsync: ${r.isAsyncSkipped};`);
    lines.push(`    tags: ${JSON.stringify(r.tags)};`);
    lines.push(`  };`);
  }
  lines.push(`}`);
  lines.push(``);

  lines.push(`/** Input shape for a given workflow. */`);
  lines.push(
    `export type WorkflowInputOf<N extends WorkflowName> = WorkflowSchema[N]['input'];`,
  );
  lines.push(``);
  lines.push(`/** Output shape for a given workflow. */`);
  lines.push(
    `export type WorkflowOutputOf<N extends WorkflowName> = WorkflowSchema[N]['output'];`,
  );
  lines.push(``);
  lines.push(`/** Target app-definition key for a workflow. */`);
  lines.push(
    `export type WorkflowAppKeyOf<N extends WorkflowName> = WorkflowSchema[N]['appKey'];`,
  );
  lines.push(``);

  // Runtime tag map so a feature (e.g. a Service Request screen) can filter
  // workflows by tag without importing every per-workflow module.
  lines.push(`/** Runtime map of workflow name → classification tags. */`);
  lines.push(`export const WORKFLOW_TAGS: Record<WorkflowName, string[]> = {`);
  for (const r of sorted) {
    lines.push(`  ${JSON.stringify(r.name)}: ${JSON.stringify(r.tags)},`);
  }
  lines.push(`};`);
  lines.push(``);

  return lines.join('\n');
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
function listWfTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...listWfTsFilesRecursive(full));
    else if (ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// =============================================================================
// API call
// =============================================================================

async function fetchWorkflows(
  apiUrl: string,
  tenant: string,
): Promise<WorkflowDefinition[]> {
  return fetchComponentList<WorkflowDefinition>(apiUrl, tenant, 'workflow');
}

/**
 * Fetch a sibling component-definition list. Used to populate the
 * cross-component index so workflow inputs/outputs that reference
 * partner-module / saved-query / partner-category structures resolve
 * to their inner shapes during codegen.
 *
 * Soft-fails on non-OK responses (returns `[]` with a console.log)
 * because siblings are best-effort — the workflow codegen should
 * still finish even if Phoenix can't serve the other definition
 * endpoints for some reason.
 */
async function fetchComponentList<T>(
  apiUrl: string,
  tenant: string,
  componentType: string,
  options: { softFail?: boolean } = {},
): Promise<T[]> {
  const base = apiUrl.replace(/\/+$/, '');
  const url = phoenixUrl(`${base}/api/internal/component-definitions-all/${componentType}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: withAuth({
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Jiffy-Tenant': tenant,
    }),
  });

  if (!res.ok) {
    if (options.softFail) {
      console.log(
        `fetch-workflows: ${componentType} sibling endpoint returned ${res.status}; ` +
          `proceeding without ${componentType} metadata.`,
      );
      return [];
    }
    const body = await res.text().catch(() => '');
    throw new Error(
      `Phoenix API call failed: ${res.status} ${res.statusText} for ${url}\n${body.slice(
        0,
        500,
      )}`,
    );
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    if (options.softFail) return [];
    throw new Error(
      `Unexpected response shape from ${url}: expected an array, got ${typeof data}`,
    );
  }
  return data as T[];
}

// =============================================================================
// Main
// =============================================================================

interface RunOptions {
  envPath: string;
  outDir: string;
  generatedTypesPath: string;
  catalogPath: string;
}

function toCatalogEntry(r: RenderedWorkflow): WorkflowCatalogEntry {
  return {
    name: r.name,
    label: r.label,
    description: r.description,
    appKey: r.appKey,
    inputs: r.inputNames,
    outputs: r.outputNames,
    isAsyncSkipped: r.isAsyncSkipped,
    tags: r.tags,
    subType: r.subType,
  };
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
      `fetch-workflows: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:workflows\` to populate ` +
        `src/types/workflows/ with live tenant data.`,
    );
    // PHX-4513: only seed empty stubs on first run — never clobber a
    // populated workflows registry/catalog when skipping for missing creds.
    mkdirSync(dirname(opts.generatedTypesPath), { recursive: true });
    if (!existsSync(opts.generatedTypesPath)) {
      writeIfChanged(opts.generatedTypesPath, renderWorkflowsGeneratedFile([]));
    } else {
      console.log(
        `fetch-workflows: preserving existing ${opts.generatedTypesPath} ` +
          `(not overwriting with an empty registry).`,
      );
    }
    mkdirSync(dirname(opts.catalogPath), { recursive: true });
    if (!existsSync(opts.catalogPath)) {
      writeIfChanged(opts.catalogPath, renderWorkflowCatalog([]));
    }
    return;
  }

  console.log(
    `fetch-workflows: GET ${apiUrl}/api/internal/component-definitions-all/workflow (tenant=${tenant})`,
  );

  // Fetch workflow + sibling component definitions in parallel. Siblings
  // are best-effort: `softFail: true` returns `[]` rather than throwing
  // so a missing endpoint doesn't block the workflow codegen.
  const [workflows, partnerModules, partnerCategories, savedQueries] =
    await Promise.all([
      fetchWorkflows(apiUrl, tenant),
      fetchComponentList<ComponentDefinition>(
        apiUrl,
        tenant,
        'partner_module_request',
        { softFail: true },
      ),
      fetchComponentList<ComponentDefinition>(
        apiUrl,
        tenant,
        'partner_category',
        { softFail: true },
      ),
      fetchComponentList<ComponentDefinition>(apiUrl, tenant, 'saved-query', {
        softFail: true,
      }),
    ]);

  const componentIndex = buildComponentIndex({
    workflows: workflows as ComponentDefinition[],
    partnerModules,
    partnerCategories,
    savedQueries,
  });
  if (
    partnerModules.length +
      partnerCategories.length +
      savedQueries.length >
    0
  ) {
    console.log(
      `fetch-workflows: cross-component index loaded ` +
        `(${partnerModules.length} partner_module_request, ` +
        `${partnerCategories.length} partner_category, ` +
        `${savedQueries.length} saved-query)`,
    );
  }

  const valid = workflows.filter(
    (w): w is WorkflowDefinition =>
      !!w && typeof w.name === 'string' && w.name.length > 0,
  );
  const wfCollisionWarning = formatCollisionWarning(
    'workflow',
    detectNameCollisions(
      valid.map((w) => ({
        name: w.name,
        appKey: w.target_app_definition_key ?? w.app_definition_key ?? '',
      })),
    ),
  );
  if (wfCollisionWarning) console.warn(wfCollisionWarning);

  const wfAppKey = (w: WorkflowDefinition) =>
    w.target_app_definition_key ?? w.app_definition_key ?? '';

  // Registry name per (app, name): bare for the first occurrence (API order),
  // `name__<appKeyDir>` for later cross-app duplicates.
  const registryNameByKey = new Map<string, string>();
  const seenWfName = new Set<string>();
  for (const w of valid) {
    const k = `${wfAppKey(w)}\u0000${w.name}`;
    if (registryNameByKey.has(k)) continue;
    registryNameByKey.set(
      k,
      seenWfName.has(w.name) ? `${w.name}__${appKeyDir(wfAppKey(w))}` : w.name,
    );
    seenWfName.add(w.name);
  }

  // Dedupe by (appKey, name) — keep BOTH cross-app duplicates (foldered).
  const byName = new Map<string, WorkflowDefinition>();
  for (const w of valid) {
    const k = `${wfAppKey(w)}\u0000${w.name}`;
    if (!byName.has(k)) byName.set(k, w);
  }
  const sorted = [...byName.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || wfAppKey(a).localeCompare(wfAppKey(b)),
  );

  mkdirSync(opts.outDir, { recursive: true });

  const generatedFiles = new Set<string>();
  const rendered: RenderedWorkflow[] = [];
  let written = 0;
  let unchanged = 0;
  let asyncSkipped = 0;
  for (const wf of sorted) {
    // Fold under the app-definition-key folder.
    const filePath = resolve(
      opts.outDir,
      appKeyDir(wfAppKey(wf)),
      `${workflowFileStem(wf.name)}.ts`,
    );
    generatedFiles.add(filePath);
    const r = renderWorkflowFile(wf, componentIndex);
    r.registryName =
      registryNameByKey.get(`${wfAppKey(wf)}\u0000${wf.name}`) ?? r.name;
    rendered.push(r);
    if (r.isAsyncSkipped) asyncSkipped++;
    if (writeIfChanged(filePath, r.source)) written++;
    else unchanged++;
  }

  // Barrel
  const barrelPath = resolve(opts.outDir, 'index.ts');
  generatedFiles.add(barrelPath);
  if (writeIfChanged(barrelPath, renderBarrelFile(rendered))) written++;
  else unchanged++;

  // Consolidated workflows.generated.ts used by the hooks.
  const generatedTypesContents = renderWorkflowsGeneratedFile(rendered);
  if (writeIfChanged(opts.generatedTypesPath, generatedTypesContents)) {
    written++;
    console.log(`fetch-workflows: also wrote ${opts.generatedTypesPath}`);
  } else {
    unchanged++;
  }

  // Catalog
  const catalogContents = renderWorkflowCatalog(rendered.map(toCatalogEntry));
  if (writeIfChanged(opts.catalogPath, catalogContents)) {
    written++;
    console.log(`fetch-workflows: also wrote ${opts.catalogPath}`);
  } else {
    unchanged++;
  }

  // Prune stale .ts files recursively (old flat files + dropped per-app files).
  let removed = 0;
  for (const full of listWfTsFilesRecursive(opts.outDir)) {
    if (!generatedFiles.has(full)) {
      unlinkSync(full);
      removed++;
    }
  }

  console.log(
    `fetch-workflows: ${sorted.length} workflows → ${opts.outDir} ` +
      `(${written} written, ${unchanged} unchanged, ${removed} removed, ${asyncSkipped} async-skipped)`,
  );
}

// CLI entry
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.env.FETCH_WORKFLOWS_OUT_DIR
    ? resolve(process.env.FETCH_WORKFLOWS_OUT_DIR)
    : resolve(root, 'src/types/workflows');
  const generatedTypesPath = resolve(outDir, '../workflows.generated.ts');
  const catalogPath = resolve(outDir, '../catalogs/workflows.catalog.md');
  run({
    envPath: resolve(root, '.env'),
    outDir,
    generatedTypesPath,
    catalogPath,
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
