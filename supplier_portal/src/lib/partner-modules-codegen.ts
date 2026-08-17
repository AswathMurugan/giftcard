/**
 * Pure helpers for the partner-module codegen.
 *
 * Extracted from `scripts/fetch-partner-modules.ts` so the catalog
 * rendering, URL/body building, and naming logic are unit-testable
 * inside the starter's vitest node env. `scripts/` lives outside the
 * vitest include glob, so anything that lives there can't be tested
 * directly.
 *
 * Partner modules are typed proxy calls — the generated app invokes
 * external systems (identity providers, notification services, risk
 * engines) through the Phoenix `/api/proxy/{module}/{variant}` route.
 * Categories (`partner_category` definitions) group modules into
 * domains; the catalog markdown is sectioned by category so the agent
 * can browse by intent.
 */

import {
  EMPTY_COMPONENT_INDEX,
  parseComponentReference,
  resolveCrossComponentStructure,
  unwrapSingleChildStructure,
  type ComponentAttribute,
  type ComponentIndex,
} from './cross-component-refs';
import { appKeyDir } from './codegen-collisions';

// ── Naming ──────────────────────────────────────────────────────────────

/** `addausertoagroup` → `Addausertoagroup`. Used for interface and function stems. */
export function partnerModulePascalCase(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** `addausertoagroup` → `ADDAUSERTOAGROUP`. Used for constant identifiers. */
export function partnerModuleConstCase(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .join('_')
    .toUpperCase();
}

/** Output filename stem — preserves the canonical partner-module name. */
export function partnerModuleFileStem(name: string): string {
  return name;
}

/** Replace any character that isn't safe for a TS identifier with `_`. */
export function partnerModuleSafeIdent(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}

/** True when the identifier must be wrapped in quotes inside an interface. */
export function partnerModuleNeedsQuotedKey(s: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/** Quote an identifier if it isn't a bare ident. */
export function partnerModuleQuoteKey(s: string): string {
  return partnerModuleNeedsQuotedKey(s) ? JSON.stringify(s) : s;
}

// ── Runtime URL/body builders ───────────────────────────────────────────

export const DEFAULT_PARTNER_MODULE_VARIANT = 'default';

/**
 * Build the direct partner-module proxy URL.
 *
 *   POST /api/proxy/{module_name}/{variant}
 *
 * Variant defaults to `'default'` when omitted (e.g.
 * `api/proxy/addausertoagroup/default`).
 */
export function buildPartnerModuleUrl(
  name: string,
  variant?: string | null,
): string {
  if (!name || typeof name !== 'string') {
    throw new Error(
      `buildPartnerModuleUrl: name must be a non-empty string (got ${JSON.stringify(name)}).`,
    );
  }
  const v =
    variant && variant.length > 0
      ? variant
      : DEFAULT_PARTNER_MODULE_VARIANT;
  return `/api/proxy/${encodeURIComponent(name)}/${encodeURIComponent(v)}`;
}

/**
 * Build the category-routed method URL.
 *
 *   POST /api/proxy/execute-partner-category/{category}/{method}
 *
 * Used for partner-module methods that are routed through a category
 * grouping rather than invoked directly. Example:
 * `api/proxy/execute-partner-category/portfolio-management/getPerformanceSummary`.
 */
export function buildPartnerCategoryMethodUrl(
  category: string,
  method: string,
): string {
  if (!category || typeof category !== 'string') {
    throw new Error(
      `buildPartnerCategoryMethodUrl: category must be a non-empty string (got ${JSON.stringify(category)}).`,
    );
  }
  if (!method || typeof method !== 'string') {
    throw new Error(
      `buildPartnerCategoryMethodUrl: method must be a non-empty string (got ${JSON.stringify(method)}).`,
    );
  }
  return `/api/proxy/execute-partner-category/${encodeURIComponent(category)}/${encodeURIComponent(method)}`;
}

/**
 * Render the `const headers = getDataHeadersWithUser(...)` line that
 * goes inside each emitted `executeXxx` wrapper.
 *
 * Partner-module / partner-category proxy calls require the requesting
 * user's id on every request via the `X-Jiffy-User-Id` header (server
 * authorises per-user permission grants). `getDataHeadersWithUser` is
 * a thin wrapper around `getDataHeaders` that also stamps the user id.
 *
 * Same shape (and same TS5076-avoiding parenthesisation) as the
 * workflow codegen's `renderExecuteHeadersLine` — kept inline here so
 * the two codegens stay independent.
 *
 * The historical bug (PHX-3832) emitted:
 *
 *   `options?.appDefinitionKey ?? PREFIX_APP_KEY || undefined`
 *
 * Required form (parens around `||`):
 *
 *   `options?.appDefinitionKey ?? (PREFIX_APP_KEY || undefined)`
 */
export function renderPartnerModuleExecuteHeadersLine(prefix: string): string {
  if (!prefix || typeof prefix !== 'string') {
    throw new Error(
      `renderPartnerModuleExecuteHeadersLine: prefix must be a non-empty string (got ${JSON.stringify(prefix)}).`,
    );
  }
  return `  const headers = getDataHeadersWithUser(options?.appDefinitionKey ?? (${prefix}_APP_KEY || undefined));`;
}

/**
 * Wrap a flat input object in the proxy's `{ inputs: ... }` envelope.
 *
 * The Phoenix proxy contract requires the partner payload to sit under
 * a top-level `inputs` key (e.g.
 * `{"inputs":{"account_id":"","partnerModuleName":""}}`). Hiding the
 * envelope behind this helper means the generated `executeXxx` wrapper
 * and `usePartnerModule` / `usePartnerCategoryMethod` hooks expose a
 * flat input interface to callers — they never construct the wrapping
 * shape themselves.
 *
 * Shared between the direct-module and category-routed call paths;
 * both endpoints accept the same `{ inputs }` envelope.
 */
export function buildPartnerModuleBody(
  input: unknown,
): { inputs: Record<string, unknown> } {
  if (input == null) return { inputs: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { inputs: {} };
  }
  return { inputs: input as Record<string, unknown> };
}

// ── Definition shape ────────────────────────────────────────────────────

export interface PartnerModuleAttribute {
  name: string;
  label?: string;
  type?: string;
  attributeType?: 'input' | 'output' | 'internal' | string;
  required?: boolean;
  description?: string | null;
  component_reference?: string | null;
  attributes?: PartnerModuleAttribute[] | null;
}

export interface PartnerModuleDefinition {
  name: string;
  label?: string;
  description?: string;
  /** Maps to a `partner_category.name` so the catalog can group modules. */
  category?: string;
  /**
   * When the definition enumerates valid variants for this module
   * (`'default' | 'sandbox' | 'production'`), the codegen emits a
   * union type alias `PartnerModuleVariantOf<N>`. When absent the
   * variant param accepts a free string and defaults to `'default'`
   * at runtime.
   */
  variants?: string[];
  attributes?: PartnerModuleAttribute[];
  app_definition_key?: string;
  target_app_definition_key?: string;
}

export interface PartnerCategoryDefinition {
  name: string;
  label?: string;
  description?: string;
}

// ── Type vocabulary ─────────────────────────────────────────────────────

/**
 * Same vocabulary as workflows + saved-queries. Kept inline so the
 * three codegens stay independent (changing one shouldn't ripple into
 * the others without a deliberate decision).
 */
export const PARTNER_MODULE_SCALAR_TS_TYPE: Record<string, string> = {
  string: 'string',
  date: 'string',
  date_time: 'string',
  datetime: 'string',
  email: 'string',
  uuid: 'string',
  url: 'string',
  integer: 'number',
  number: 'number',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  text: 'string',
  multilinetext: 'string',
  phonenumber: 'string',
  ssn: 'string',
  file: 'string',
  enumeration: 'string',
  duration: 'string',
  ltree: 'string',
  autonumber: 'number',
  currency: 'number',
  percent: 'number',
  checkbox: 'boolean',
  json: 'Record<string, unknown>',
};

// ── Reference detection ─────────────────────────────────────────────────

export function isPartnerModuleEntityRef(
  ref: string | null | undefined,
): boolean {
  if (!ref || typeof ref !== 'string') return false;
  return ref.includes('.entity.');
}

export function parsePartnerModuleInternalRef(
  ref: string | null | undefined,
  moduleName: string,
): string | null {
  if (!ref || typeof ref !== 'string') return null;
  const parts = ref.split('.');
  // Accept both `.partner_module_request.` and `.partner-module.` forms.
  const idx = parts.findIndex(
    (p) => p === 'partner_module_request' || p === 'partner-module',
  );
  if (idx < 0 || idx + 2 >= parts.length) return null;
  if (parts[idx + 1] !== moduleName) return null;
  return parts[idx + 2];
}

// ── Type emission ───────────────────────────────────────────────────────

export interface ResolverContext {
  moduleName: string;
  internals: Map<string, PartnerModuleAttribute[]>;
  /**
   * Index of sibling component definitions (workflows, other partner
   * modules, partner categories, saved queries). When set, partner-
   * module attributes whose `component_reference` points at another
   * component resolve to that component's inner attribute shape rather
   * than falling back to `Record<string, unknown>`.
   */
  componentIndex: ComponentIndex;
  /**
   * Visited set for cross-component cycle detection. Spans an entire
   * `attrTsType` rendering pass so cycles like A → B → A across
   * components terminate.
   */
  crossComponentVisited: Set<string>;
}

export function buildResolverContext(
  pm: PartnerModuleDefinition,
  componentIndex: ComponentIndex = EMPTY_COMPONENT_INDEX,
): ResolverContext {
  const internals = new Map<string, PartnerModuleAttribute[]>();
  for (const a of pm.attributes ?? []) {
    if ((a.attributeType ?? '').toLowerCase() === 'internal') {
      internals.set(a.name, a.attributes ?? []);
    }
  }
  return {
    moduleName: pm.name,
    internals,
    componentIndex,
    crossComponentVisited: new Set<string>(),
  };
}

function resolveByRef(
  attr: PartnerModuleAttribute,
  ctx: ResolverContext,
  visited: Set<string>,
): PartnerModuleAttribute[] | null {
  if (attr.attributes && attr.attributes.length > 0) return attr.attributes;
  const refName = parsePartnerModuleInternalRef(
    attr.component_reference,
    ctx.moduleName,
  );
  if (!refName) return null;
  if (visited.has(refName)) return null;
  const target = ctx.internals.get(refName);
  if (!target) return null;
  visited.add(refName);
  return target;
}

export function attrTsType(
  attr: PartnerModuleAttribute,
  ctx: ResolverContext,
  indent: number,
  visited: Set<string>,
): string {
  const t = (attr.type ?? '').toLowerCase();

  if (isPartnerModuleEntityRef(attr.component_reference)) {
    return t === 'array' ? '{ id: string }[]' : '{ id: string }';
  }

  if (t === 'array') {
    const inner = resolveByRef(attr, ctx, visited);
    if (inner) {
      return `${renderObjectInline(inner, ctx, indent + 1, visited)}[]`;
    }
    const xc = resolveCrossComponentForAttr(attr, ctx);
    if (xc) {
      return `${renderObjectInline(xc, ctx, indent + 1, visited)}[]`;
    }
    return 'unknown[]';
  }
  if (t === 'object') {
    const inner = resolveByRef(attr, ctx, visited);
    if (inner) {
      return renderObjectInline(inner, ctx, indent + 1, visited);
    }
    const xc = resolveCrossComponentForAttr(attr, ctx);
    if (xc) {
      return renderObjectInline(xc, ctx, indent + 1, visited);
    }
    return 'Record<string, unknown>';
  }
  return PARTNER_MODULE_SCALAR_TS_TYPE[t] ?? 'unknown';
}

/**
 * Walk a partner-module attribute's `component_reference` into a
 * sibling component definition via the shared resolver. Same shape +
 * semantics as the workflow-codegen equivalent; kept inline so the
 * two codegens stay independent.
 */
function resolveCrossComponentForAttr(
  attr: PartnerModuleAttribute,
  ctx: ResolverContext,
): PartnerModuleAttribute[] | null {
  const ref = attr.component_reference;
  if (!ref) return null;
  const parsed = parseComponentReference(ref);
  if (!parsed || parsed.componentType === 'entity') return null;
  // Skip refs that point at THIS partner module's own internals — those
  // are already handled by resolveByRef. Avoids double-resolution.
  if (
    parsed.componentType === 'partner_module_request' &&
    parsed.componentName === ctx.moduleName
  ) {
    return null;
  }
  const branchVisited = new Set(ctx.crossComponentVisited);
  const resolved = resolveCrossComponentStructure(
    ref,
    ctx.componentIndex,
    branchVisited,
  );
  if (!resolved) return null;
  for (const v of branchVisited) ctx.crossComponentVisited.add(v);
  const { attrs: unwrapped } = unwrapSingleChildStructure(
    resolved as ComponentAttribute[],
  );
  return unwrapped as PartnerModuleAttribute[];
}

function renderObjectInline(
  attrs: PartnerModuleAttribute[],
  ctx: ResolverContext,
  indent: number,
  visited: Set<string>,
): string {
  if (attrs.length === 0) return 'Record<string, unknown>';
  const pad = '  '.repeat(indent);
  const closePad = '  '.repeat(indent - 1);
  const lines: string[] = ['{'];
  for (const a of attrs) {
    const optional = a.required ? '' : '?';
    const ts = attrTsType(a, ctx, indent, new Set(visited));
    if (a.label || a.description) {
      const docBits: string[] = [];
      if (a.label) docBits.push(a.label);
      if (a.description) docBits.push(a.description);
      lines.push(`${pad}/** ${docBits.join(' — ')} */`);
    }
    lines.push(`${pad}${partnerModuleQuoteKey(a.name)}${optional}: ${ts};`);
  }
  lines.push(`${closePad}}`);
  return lines.join('\n');
}

export function renderInterface(
  name: string,
  attrs: PartnerModuleAttribute[],
  ctx: ResolverContext,
): string {
  if (attrs.length === 0) {
    return `export interface ${name} {\n  [key: string]: unknown;\n}`;
  }
  const lines: string[] = [];
  lines.push(`export interface ${name} {`);
  // Skip duplicate-named attributes (keep first). Some partner-module specs
  // list the same param twice (e.g. `limit`/`offset` in pagination + query
  // groups); emitting both makes a duplicate interface key → TS2300.
  const seenKeys = new Set<string>();
  for (const a of attrs) {
    if (seenKeys.has(a.name)) continue;
    seenKeys.add(a.name);
    const optional = a.required ? '' : '?';
    const ts = attrTsType(a, ctx, 2, new Set());
    if (a.label || a.description) {
      const docBits: string[] = [];
      if (a.label) docBits.push(a.label);
      if (a.description) docBits.push(a.description);
      lines.push(`  /** ${docBits.join(' — ')} */`);
    }
    lines.push(`  ${partnerModuleQuoteKey(a.name)}${optional}: ${ts};`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

// ── Catalog rendering ───────────────────────────────────────────────────

export interface PartnerModuleCatalogField {
  name: string;
  required?: boolean;
  /**
   * Original `component_reference` string when the field's type was
   * resolved through the cross-component index. Surfaced in the
   * catalog markdown so the agent can trace the type back to its
   * source schema (saved-query / workflow / other partner module).
   * `undefined` when the field has no ref, points at the same
   * module's internal, or its ref didn't resolve.
   */
  resolvedFrom?: string;
}

export interface PartnerModuleCatalogOutput {
  name: string;
  /** See `PartnerModuleCatalogField.resolvedFrom`. */
  resolvedFrom?: string;
}

export interface PartnerModuleCatalogEntry {
  name: string;
  label: string;
  description: string;
  category: string;
  appKey: string;
  variants: string[];
  inputs: PartnerModuleCatalogField[];
  outputs: PartnerModuleCatalogOutput[];
}

const CATALOG_HEADER = `# Partner Modules Catalog

Auto-generated by \`scripts/fetch-partner-modules.ts\`. One entry per
partner-module request exposed by the tenant, grouped by category.

**To find a partner module by intent, grep this file by keyword** (e.g.
"identity", "notification", "send", "verify"). Each entry shows the
hook to use, valid variants, the inputs to pass, the response shape,
and the description copied from the Phoenix UI. For the precise TypeScript
input/output shape, open the per-entry **Module:** path — modules are foldered
by app (\`src/types/partner-modules/<app_definition_key>/{name}.ts\`), NOT
flat, so use the path shown rather than guessing.

Partner modules invoke external systems with **side effects** — call
them through \`usePartnerModule(name)\` and invoke \`mutate(input)\` or
\`mutateAsync(input)\` on user action. They are NOT auto-fired.

`;

function formatField(name: string, resolvedFrom?: string): string {
  return resolvedFrom
    ? `\`${name}\` → resolved from \`${resolvedFrom}\``
    : `\`${name}\``;
}

function formatInputs(inputs: PartnerModuleCatalogField[]): string {
  if (inputs.length === 0) return '_(none)_';
  return inputs
    .map((f) => {
      const base = formatField(f.name, f.resolvedFrom);
      return f.required ? `${base} (required)` : base;
    })
    .join(', ');
}

function formatOutputs(outputs: PartnerModuleCatalogOutput[]): string {
  if (outputs.length === 0) return '_(none)_';
  return outputs.map((o) => formatField(o.name, o.resolvedFrom)).join(', ');
}

function formatVariants(variants: string[]): string {
  if (variants.length === 0) {
    return `\`'default'\` _(no variants enumerated; default applies)_`;
  }
  return variants.map((v) => `\`'${v}'\``).join(' | ');
}

function formatDescription(desc: string): string {
  const trimmed = desc.replace(/\r?\n+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : '_(no description provided)_';
}

const UNCATEGORISED_LABEL = 'Uncategorised';

function categoryLabel(
  raw: string,
  categoryDefs: Map<string, PartnerCategoryDefinition>,
): string {
  if (!raw) return UNCATEGORISED_LABEL;
  const def = categoryDefs.get(raw);
  return def?.label || raw;
}

function renderEntry(entry: PartnerModuleCatalogEntry): string {
  const lines: string[] = [];
  const heading = entry.label
    ? `#### \`${entry.name}\` — "${entry.label}"`
    : `#### \`${entry.name}\``;
  lines.push(heading);
  lines.push(
    `- **Hook:** \`usePartnerModule(${JSON.stringify(entry.name)})\``,
  );
  const appCol = entry.appKey ? `  ·  **App:** ${entry.appKey}` : '';
  lines.push(`- **Variant:** ${formatVariants(entry.variants)}${appCol}`);
  lines.push(
    `- **Module:** \`src/types/partner-modules/${appKeyDir(entry.appKey)}/${entry.name}.ts\``,
  );
  lines.push(`- **Inputs:** ${formatInputs(entry.inputs)}`);
  lines.push(`- **Outputs:** ${formatOutputs(entry.outputs)}`);
  lines.push(formatDescription(entry.description));
  return lines.join('\n');
}

/**
 * Group entries by category, render the markdown catalog with one
 * `## <Category>` section per group. Entries inside each group sort
 * alphabetically; categories themselves also sort alphabetically (with
 * `Uncategorised` pinned last).
 */
export function renderPartnerModuleCatalog(
  entries: PartnerModuleCatalogEntry[],
  categoryDefs: PartnerCategoryDefinition[] = [],
): string {
  if (entries.length === 0) {
    return (
      CATALOG_HEADER +
      `_No partner modules available. Either the tenant has none defined,\n` +
      `or \`PHOENIX_API_URL\` / \`TENANT_ID\` were not set when the catalog\n` +
      `was regenerated. Run \`npm run fetch:partner-modules\` to refresh._\n`
    );
  }

  const catLookup = new Map<string, PartnerCategoryDefinition>();
  for (const c of categoryDefs) catLookup.set(c.name, c);

  // Group by category label.
  const groups = new Map<string, PartnerModuleCatalogEntry[]>();
  for (const e of entries) {
    const label = categoryLabel(e.category, catLookup);
    const arr = groups.get(label) ?? [];
    arr.push(e);
    groups.set(label, arr);
  }

  // Sort categories alphabetically; pin Uncategorised last.
  const sortedCategoryLabels = [...groups.keys()].sort((a, b) => {
    if (a === UNCATEGORISED_LABEL && b !== UNCATEGORISED_LABEL) return 1;
    if (b === UNCATEGORISED_LABEL && a !== UNCATEGORISED_LABEL) return -1;
    return a.localeCompare(b);
  });

  const sections: string[] = [];
  for (const label of sortedCategoryLabels) {
    const inGroup = (groups.get(label) ?? []).slice().sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const lines: string[] = [`## ${label}`, ''];
    lines.push(inGroup.map(renderEntry).join('\n\n'));
    sections.push(lines.join('\n'));
  }

  return `${CATALOG_HEADER}---\n\n${sections.join('\n\n')}\n`;
}
