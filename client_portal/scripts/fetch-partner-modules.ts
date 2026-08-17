/**
 * Fetches partner-module + partner-category definitions for the configured
 * tenant from the Phoenix `/api/internal/component-definitions-all/...`
 * endpoints and emits per-module TypeScript modules into
 * `src/types/partner-modules/`.
 *
 * Two definition sources are read on every run:
 *
 *   - `/component-definitions-all/partner_module_request` — the modules
 *     themselves (each with input + output schemas, optional variants).
 *   - `/component-definitions-all/partner_category` — category metadata
 *     (label/description) used to group modules in the catalog and
 *     identify which modules route via the category-execute URL.
 *
 * Runtime contract:
 *
 *   Direct module:
 *     POST /api/proxy/{module_name}/{variant}      (variant default = 'default')
 *
 *   Category-routed method:
 *     POST /api/proxy/execute-partner-category/{category}/{method}
 *
 * Both endpoints accept the same body envelope: `{ inputs: {...} }`. The
 * runtime hook `usePartnerModule(name)` chooses the URL pattern based on
 * the module's metadata (presence of `category` flips to the category-
 * routed form); the wrapping happens inside `buildPartnerModuleBody`.
 *
 * V1: every module emits a wrapper. Async or otherwise unsupported
 * shapes are passed through with a TODO comment; future iterations
 * can refine the type emission as more shapes appear in the wild.
 *
 * Config (env-only):
 *   - PHOENIX_API_URL                e.g. https://jiffy.us.sandbox.phoenix.jiffy.ai
 *   - TENANT_ID                      e.g. aiwithdata
 *   - FETCH_PARTNER_MODULES_OUT_DIR  (optional) absolute path. Defaults
 *                                    to <project>/src/types/partner-modules.
 *
 * Invocation:
 *   npm run fetch:partner-modules
 *   # or directly:
 *   npx tsx scripts/fetch-partner-modules.ts
 *
 * Output is deterministic (sorted) and the script skips writes when a
 * file's content is unchanged.
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
  buildPartnerCategoryMethodUrl,
  buildPartnerModuleUrl,
  buildResolverContext,
  partnerModuleConstCase,
  partnerModuleFileStem,
  partnerModulePascalCase,
  renderInterface,
  renderPartnerModuleCatalog,
  renderPartnerModuleExecuteHeadersLine,
  type PartnerCategoryDefinition,
  type PartnerModuleAttribute,
  type PartnerModuleCatalogEntry,
  type PartnerModuleDefinition,
} from '../src/lib/partner-modules-codegen';
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
// .env loader
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
// Per-module module emitter
// =============================================================================

/**
 * Returns the attribute's `component_reference` if it points at a
 * cross-component target that the index can locate (non-entity,
 * non-self-module). Used to annotate catalog entries so the agent
 * can trace types back to their source schema.
 */
function detectResolvedFrom(
  attr: PartnerModuleAttribute,
  moduleName: string,
  componentIndex: ComponentIndex,
): string | undefined {
  const ref = attr.component_reference;
  if (!ref) return undefined;
  const parsed = parseComponentReference(ref);
  if (!parsed) return undefined;
  if (parsed.componentType === 'entity') return undefined;
  if (
    parsed.componentType === 'partner_module_request' &&
    parsed.componentName === moduleName
  ) {
    return undefined;
  }
  const hit = componentIndex.get(parsed.componentType, parsed.componentName);
  return hit ? ref : undefined;
}

interface RenderedPartnerModule {
  source: string;
  name: string;
  /** Registry key — bare `name` for the first occurrence, `name__<appKeyDir>`
   *  for later cross-app duplicates (kept as files, omitted from the typed
   *  registry which stays bare/wire-correct). */
  registryName?: string;
  pascal: string;
  appKey: string;
  category: string;
  variants: string[];
  inputTypeName: string;
  outputTypeName: string;
  label: string;
  description: string;
  inputNames: { name: string; required: boolean; resolvedFrom?: string }[];
  outputNames: { name: string; resolvedFrom?: string }[];
}

function renderPartnerModuleFile(
  pm: PartnerModuleDefinition,
  componentIndex: ComponentIndex,
): RenderedPartnerModule {
  const pascal = partnerModulePascalCase(pm.name);
  const prefix = partnerModuleConstCase(pm.name);
  const ctx = buildResolverContext(pm, componentIndex);
  const allAttrs = pm.attributes ?? [];

  const inputs = allAttrs.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === 'input',
  );
  const outputs = allAttrs.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === 'output',
  );

  const appKey =
    pm.target_app_definition_key ?? pm.app_definition_key ?? '';
  const category = pm.category ?? '';
  const variants = Array.isArray(pm.variants)
    ? pm.variants.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];

  const inputTypeName = `${pascal}Input`;
  const outputTypeName = `${pascal}Output`;
  const optionsTypeName = `Execute${pascal}Options`;
  const fnName = `execute${pascal}`;

  // Choose the URL based on category presence. When a module declares
  // a category, its execute path goes through the category-routed proxy:
  //   POST /api/proxy/execute-partner-category/{category}/{module_name}
  // Otherwise the direct proxy is used:
  //   POST /api/proxy/{module_name}/{variant}
  const executeUrl = category
    ? buildPartnerCategoryMethodUrl(category, pm.name)
    : buildPartnerModuleUrl(pm.name);

  const header: string[] = [];
  header.push(
    `// AUTO-GENERATED by scripts/fetch-partner-modules.ts - do not edit by hand.`,
  );
  header.push(
    `// Source: Phoenix /api/internal/component-definitions-all/partner_module_request`,
  );
  header.push(
    `// Partner module: ${pm.name}${
      pm.label ? ` ("${pm.label.replace(/\r?\n/g, ' ').trim()}")` : ''
    }`,
  );
  const route = category
    ? `category-routed (${category})`
    : 'direct proxy';
  header.push(
    `// Route: ${route}${appKey ? `  |  App: ${appKey}` : ''}`,
  );
  if (pm.description) {
    header.push(`// ${pm.description.replace(/\r?\n/g, ' ').trim()}`);
  }
  header.push(``);
  header.push(`import { apiManager } from '@/services/api-manager';`);
  header.push(`import { getDataHeadersWithUser } from '@/config/api-config';`);
  header.push(``);

  const lines: string[] = [];

  // Input interface.
  if (inputs.length > 0) {
    lines.push(`/** Input parameters for the \`${pm.name}\` partner module. */`);
    lines.push(renderInterface(inputTypeName, inputs, ctx));
  } else {
    lines.push(
      `/** Input parameters for the \`${pm.name}\` partner module (none declared). */`,
    );
    lines.push(`export type ${inputTypeName} = Record<string, never>;`);
  }
  lines.push(``);

  // Output interface.
  if (outputs.length > 0) {
    lines.push(`/** Output shape returned by the \`${pm.name}\` partner module. */`);
    if (
      outputs.length === 1 &&
      (outputs[0].type ?? '').toLowerCase() === 'object'
    ) {
      const only = outputs[0];
      if (only.attributes && only.attributes.length > 0) {
        lines.push(renderInterface(outputTypeName, only.attributes, ctx));
      } else {
        const tsType = attrTsType(only, ctx, 1, new Set());
        lines.push(`export type ${outputTypeName} = ${tsType};`);
      }
    } else {
      lines.push(renderInterface(outputTypeName, outputs, ctx));
    }
  } else {
    lines.push(
      `/** Output shape returned by the \`${pm.name}\` partner module (undeclared). */`,
    );
    lines.push(`export type ${outputTypeName} = unknown;`);
  }
  lines.push(``);

  // Constants.
  lines.push(`export const ${prefix}_NAME = ${JSON.stringify(pm.name)};`);
  lines.push(`export const ${prefix}_APP_KEY = ${JSON.stringify(appKey)};`);
  lines.push(`export const ${prefix}_CATEGORY = ${JSON.stringify(category)};`);
  if (variants.length > 0) {
    const variantUnion = variants.map((v) => JSON.stringify(v)).join(' | ');
    lines.push(`export type ${pascal}Variant = ${variantUnion};`);
    lines.push(
      `export const ${prefix}_VARIANTS = [${variants.map((v) => JSON.stringify(v)).join(', ')}] as const;`,
    );
  } else {
    // Free-string variant — defaults to 'default' at runtime.
    lines.push(`export type ${pascal}Variant = string;`);
  }
  lines.push(``);

  // Options interface.
  lines.push(`export interface ${optionsTypeName} {`);
  if (!category && variants.length > 0) {
    // Variants are only meaningful for direct-proxy modules. Category-
    // routed modules have a fixed URL structure with no variant slot.
    lines.push(
      `  /** Variant slot in the proxy URL. Defaults to \`'default'\` when omitted. */`,
    );
    lines.push(`  variant?: ${pascal}Variant;`);
  } else if (!category) {
    lines.push(
      `  /** Variant slot in the proxy URL. Defaults to \`'default'\` when omitted. */`,
    );
    lines.push(`  variant?: string;`);
  }
  lines.push(
    `  /** Override the partner module's app definition key (rarely needed). */`,
  );
  lines.push(`  appDefinitionKey?: string;`);
  lines.push(`}`);
  lines.push(``);

  // Wrapper. Body is wrapped in `{ inputs: ... }` per the proxy contract.
  lines.push(`/**`);
  lines.push(` * Execute the \`${pm.name}\` partner module.`);
  lines.push(` *`);
  lines.push(` * Side-effecting (proxied to an external system); trigger on user action.`);
  if (category) {
    lines.push(` * Routed via the partner-category proxy: ${executeUrl}`);
  }
  lines.push(` */`);
  lines.push(`export async function ${fnName}(`);
  const inputOptional = inputs.length === 0 || inputs.every((a) => !a.required);
  lines.push(`  input${inputOptional ? '?' : ''}: ${inputTypeName},`);
  lines.push(`  options?: ${optionsTypeName},`);
  lines.push(`): Promise<${outputTypeName}> {`);
  lines.push(renderPartnerModuleExecuteHeadersLine(prefix));
  if (category) {
    lines.push(`  const url = ${JSON.stringify(executeUrl)};`);
  } else {
    lines.push(
      `  const variant = options?.variant && options.variant.length > 0 ? options.variant : 'default';`,
    );
    lines.push(
      `  const url = \`/api/proxy/${encodeURIComponent(pm.name)}/\${encodeURIComponent(variant)}\`;`,
    );
  }
  // Double-cast through `unknown`: the typed `Input` has no string index
  // signature, so a direct `as Record<string, unknown>` is a TS2352 error
  // under strict builds (`tsc -b`). `as unknown as` is the safe widening.
  lines.push(`  const body = { inputs: (input ?? {}) as unknown as Record<string, unknown> };`);
  lines.push(`  const response = await apiManager.post('proxy', url, body, headers);`);
  lines.push(`  return response.data as ${outputTypeName};`);
  lines.push(`}`);
  lines.push(``);

  return {
    source: `${header.join('\n')}\n${lines.join('\n')}`,
    name: pm.name,
    pascal,
    appKey,
    category,
    variants,
    inputTypeName,
    outputTypeName,
    label: pm.label ?? '',
    description: pm.description ?? '',
    inputNames: inputs.map((a) => ({
      name: a.name,
      required: a.required === true,
      resolvedFrom: detectResolvedFrom(a, pm.name, componentIndex),
    })),
    outputNames: outputs.map((a) => ({
      name: a.name,
      resolvedFrom: detectResolvedFrom(a, pm.name, componentIndex),
    })),
  };
}

// =============================================================================
// Aggregate file emitters
// =============================================================================

function renderBarrelFile(rendered: RenderedPartnerModule[]): string {
  const lines: string[] = [];
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-partner-modules.ts - do not edit by hand.`,
  );
  lines.push(``);
  const sorted = [...rendered].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.appKey.localeCompare(b.appKey),
  );
  for (const r of sorted) {
    const path = `./${appKeyDir(r.appKey)}/${partnerModuleFileStem(r.name)}`;
    if ((r.registryName ?? r.name) === r.name) {
      lines.push(`export * from '${path}';`);
    } else {
      lines.push(`// '${r.registryName}' (cross-app dup of '${r.name}') → import from '${path}'`);
    }
  }
  lines.push(``);
  return lines.join('\n');
}

function renderPartnerModulesGeneratedFile(
  rendered: RenderedPartnerModule[],
): string {
  const lines: string[] = [];
  lines.push(`/* eslint-disable */`);
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-partner-modules.ts - do not edit by hand.`,
  );
  lines.push(
    `// Source: Phoenix /api/internal/component-definitions-all/partner_module_request`,
  );
  lines.push(
    `// Regenerated on every workspace bootstrap; stays in sync with`,
  );
  lines.push(`// src/types/partner-modules/*.ts.`);
  lines.push(``);

  if (rendered.length === 0) {
    lines.push(`export type PartnerModuleName = never;`);
    lines.push(``);
    lines.push(`export interface PartnerModuleSchema {}`);
    lines.push(``);
    lines.push(
      `export type PartnerModuleInputOf<_N extends PartnerModuleName> = never;`,
    );
    lines.push(
      `export type PartnerModuleOutputOf<_N extends PartnerModuleName> = never;`,
    );
    lines.push(
      `export type PartnerModuleAppKeyOf<_N extends PartnerModuleName> = never;`,
    );
    lines.push(
      `export type PartnerModuleCategoryOf<_N extends PartnerModuleName> = never;`,
    );
    lines.push(``);
    return lines.join('\n');
  }

  const sortedAll = [...rendered].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.appKey.localeCompare(b.appKey),
  );
  // Only the primary (bare-named, first-wins) module per name goes into the
  // typed registry — its wire name stays bare. Cross-app duplicates keep their
  // foldered file + a catalog entry.
  const sorted = sortedAll.filter((r) => (r.registryName ?? r.name) === r.name);
  for (const r of sorted) {
    lines.push(
      `import type { ${r.inputTypeName}, ${r.outputTypeName} } from './partner-modules/${appKeyDir(r.appKey)}/${partnerModuleFileStem(r.name)}';`,
    );
  }
  lines.push(``);

  const namesUnion = sorted.map((r) => JSON.stringify(r.name)).join(' | ');
  lines.push(`/** All known partner-module names (typed union). */`);
  lines.push(`export type PartnerModuleName = ${namesUnion};`);
  lines.push(``);

  lines.push(`/**`);
  lines.push(` * Master partner-module registry. Consumed by usePartnerModule`);
  lines.push(` * to derive input + output types per partner-module name.`);
  lines.push(` */`);
  lines.push(`export interface PartnerModuleSchema {`);
  for (const r of sorted) {
    lines.push(`  ${JSON.stringify(r.name)}: {`);
    lines.push(`    input: ${r.inputTypeName};`);
    lines.push(`    output: ${r.outputTypeName};`);
    lines.push(`    appKey: ${JSON.stringify(r.appKey)};`);
    lines.push(`    category: ${JSON.stringify(r.category)};`);
    lines.push(`  };`);
  }
  lines.push(`}`);
  lines.push(``);

  lines.push(`/** Input shape for a given partner module. */`);
  lines.push(
    `export type PartnerModuleInputOf<N extends PartnerModuleName> = PartnerModuleSchema[N]['input'];`,
  );
  lines.push(``);
  lines.push(`/** Output shape for a given partner module. */`);
  lines.push(
    `export type PartnerModuleOutputOf<N extends PartnerModuleName> = PartnerModuleSchema[N]['output'];`,
  );
  lines.push(``);
  lines.push(`/** Target app-definition key for a partner module. */`);
  lines.push(
    `export type PartnerModuleAppKeyOf<N extends PartnerModuleName> = PartnerModuleSchema[N]['appKey'];`,
  );
  lines.push(``);
  lines.push(
    `/** Category a partner module belongs to (empty string when uncategorised). */`,
  );
  lines.push(
    `export type PartnerModuleCategoryOf<N extends PartnerModuleName> = PartnerModuleSchema[N]['category'];`,
  );
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
function listPmTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...listPmTsFilesRecursive(full));
    else if (ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// =============================================================================
// API call
// =============================================================================

async function fetchPartnerModules(
  apiUrl: string,
  tenant: string,
): Promise<PartnerModuleDefinition[]> {
  return fetchComponentList<PartnerModuleDefinition>(
    apiUrl,
    tenant,
    'partner_module_request',
  );
}

async function fetchPartnerCategories(
  apiUrl: string,
  tenant: string,
): Promise<PartnerCategoryDefinition[]> {
  return fetchComponentList<PartnerCategoryDefinition>(
    apiUrl,
    tenant,
    'partner_category',
    { softFail: true },
  );
}

/**
 * Fetch a component-definition list. Used both for the primary
 * partner_module_request fetch and the sibling (workflow / saved-query)
 * fetches that populate the cross-component index.
 *
 * Soft-fails on non-OK responses when `softFail: true` (returns `[]` +
 * a console.log) so missing sibling endpoints don't block the partner-
 * module codegen.
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
        `fetch-partner-modules: ${componentType} endpoint returned ${res.status}; ` +
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

function toCatalogEntry(
  r: RenderedPartnerModule,
): PartnerModuleCatalogEntry {
  return {
    name: r.name,
    label: r.label,
    description: r.description,
    category: r.category,
    appKey: r.appKey,
    variants: r.variants,
    inputs: r.inputNames,
    outputs: r.outputNames,
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
      `fetch-partner-modules: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:partner-modules\` to populate ` +
        `src/types/partner-modules/ with live tenant data.`,
    );
    // PHX-4513: only seed empty stubs on first run — never clobber a
    // populated partner-modules registry/catalog when skipping for missing
    // creds.
    mkdirSync(dirname(opts.generatedTypesPath), { recursive: true });
    if (!existsSync(opts.generatedTypesPath)) {
      writeIfChanged(
        opts.generatedTypesPath,
        renderPartnerModulesGeneratedFile([]),
      );
    } else {
      console.log(
        `fetch-partner-modules: preserving existing ${opts.generatedTypesPath} ` +
          `(not overwriting with an empty registry).`,
      );
    }
    mkdirSync(dirname(opts.catalogPath), { recursive: true });
    if (!existsSync(opts.catalogPath)) {
      writeIfChanged(opts.catalogPath, renderPartnerModuleCatalog([], []));
    }
    return;
  }

  console.log(
    `fetch-partner-modules: GET ${apiUrl}/api/internal/component-definitions-all/partner_module_request (tenant=${tenant})`,
  );

  // Fetch primary + sibling component definitions in parallel. Workflows
  // + saved-queries populate the cross-component index so partner-module
  // attributes that reference structures on other components resolve to
  // their inner shapes during codegen. Categories drive catalog grouping.
  const [partnerModules, partnerCategories, workflows, savedQueries] =
    await Promise.all([
      fetchPartnerModules(apiUrl, tenant),
      fetchPartnerCategories(apiUrl, tenant),
      fetchComponentList<ComponentDefinition>(apiUrl, tenant, 'workflow', {
        softFail: true,
      }),
      fetchComponentList<ComponentDefinition>(apiUrl, tenant, 'saved-query', {
        softFail: true,
      }),
    ]);

  const componentIndex = buildComponentIndex({
    workflows,
    partnerModules: partnerModules as ComponentDefinition[],
    partnerCategories: partnerCategories as ComponentDefinition[],
    savedQueries,
  });
  if (workflows.length + savedQueries.length > 0) {
    console.log(
      `fetch-partner-modules: cross-component index loaded ` +
        `(${workflows.length} workflow, ${savedQueries.length} saved-query)`,
    );
  }

  const valid = partnerModules.filter(
    (m): m is PartnerModuleDefinition =>
      !!m && typeof m.name === 'string' && m.name.length > 0,
  );
  const pmCollisionWarning = formatCollisionWarning(
    'partner-module',
    detectNameCollisions(
      valid.map((m) => ({
        name: m.name,
        appKey: m.target_app_definition_key ?? m.app_definition_key ?? '',
      })),
    ),
  );
  if (pmCollisionWarning) console.warn(pmCollisionWarning);

  const pmAppKey = (m: PartnerModuleDefinition) =>
    m.target_app_definition_key ?? m.app_definition_key ?? '';

  // Registry name per (app, name): bare for the first occurrence (API order),
  // `name__<appKeyDir>` for later cross-app duplicates.
  const registryNameByKey = new Map<string, string>();
  const seenPmName = new Set<string>();
  for (const m of valid) {
    const k = `${pmAppKey(m)}\u0000${m.name}`;
    if (registryNameByKey.has(k)) continue;
    registryNameByKey.set(
      k,
      seenPmName.has(m.name) ? `${m.name}__${appKeyDir(pmAppKey(m))}` : m.name,
    );
    seenPmName.add(m.name);
  }

  // Dedupe by (appKey, name) — keep BOTH cross-app duplicates (foldered).
  const byName = new Map<string, PartnerModuleDefinition>();
  for (const m of valid) {
    const k = `${pmAppKey(m)}\u0000${m.name}`;
    if (!byName.has(k)) byName.set(k, m);
  }
  const sorted = [...byName.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || pmAppKey(a).localeCompare(pmAppKey(b)),
  );

  mkdirSync(opts.outDir, { recursive: true });

  const generatedFiles = new Set<string>();
  const rendered: RenderedPartnerModule[] = [];
  let written = 0;
  let unchanged = 0;
  for (const pm of sorted) {
    // Fold under the app-definition-key folder.
    const filePath = resolve(
      opts.outDir,
      appKeyDir(pmAppKey(pm)),
      `${partnerModuleFileStem(pm.name)}.ts`,
    );
    generatedFiles.add(filePath);
    const r = renderPartnerModuleFile(pm, componentIndex);
    r.registryName =
      registryNameByKey.get(`${pmAppKey(pm)}\u0000${pm.name}`) ?? r.name;
    rendered.push(r);
    if (writeIfChanged(filePath, r.source)) written++;
    else unchanged++;
  }

  // Barrel
  const barrelPath = resolve(opts.outDir, 'index.ts');
  generatedFiles.add(barrelPath);
  if (writeIfChanged(barrelPath, renderBarrelFile(rendered))) written++;
  else unchanged++;

  // Consolidated partner-modules.generated.ts used by the hook.
  const generatedTypesContents = renderPartnerModulesGeneratedFile(rendered);
  if (writeIfChanged(opts.generatedTypesPath, generatedTypesContents)) {
    written++;
    console.log(
      `fetch-partner-modules: also wrote ${opts.generatedTypesPath}`,
    );
  } else {
    unchanged++;
  }

  // Catalog.
  const catalogContents = renderPartnerModuleCatalog(
    rendered.map(toCatalogEntry),
    partnerCategories,
  );
  if (writeIfChanged(opts.catalogPath, catalogContents)) {
    written++;
    console.log(`fetch-partner-modules: also wrote ${opts.catalogPath}`);
  } else {
    unchanged++;
  }

  // Prune stale .ts files recursively (old flat files + dropped per-app files).
  let removed = 0;
  for (const full of listPmTsFilesRecursive(opts.outDir)) {
    if (!generatedFiles.has(full)) {
      unlinkSync(full);
      removed++;
    }
  }

  console.log(
    `fetch-partner-modules: ${sorted.length} partner modules → ${opts.outDir} ` +
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
  const outDir = process.env.FETCH_PARTNER_MODULES_OUT_DIR
    ? resolve(process.env.FETCH_PARTNER_MODULES_OUT_DIR)
    : resolve(root, 'src/types/partner-modules');
  const generatedTypesPath = resolve(
    outDir,
    '../partner-modules.generated.ts',
  );
  const catalogPath = resolve(outDir, '../catalogs/partner-modules.catalog.md');
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
