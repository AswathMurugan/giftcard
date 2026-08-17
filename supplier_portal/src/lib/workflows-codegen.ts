/**
 * Pure helpers for the workflow codegen.
 *
 * Extracted from `scripts/fetch-workflows.ts` so the catalog rendering,
 * URL/body building, and naming logic are unit-testable inside the
 * starter's vitest node env. `scripts/` lives outside the vitest
 * include glob, so anything that lives there can't be tested directly.
 *
 * The script in `scripts/` handles network I/O and disk writes; this
 * module handles deterministic, pure transforms.
 */

import {
  EMPTY_COMPONENT_INDEX,
  parseComponentReference,
  resolveCrossComponentStructure,
  unwrapSingleChildStructure,
  type ComponentAttribute,
  type ComponentIndex,
} from './cross-component-refs';

// ── Naming ──────────────────────────────────────────────────────────────

/** `create_user` → `CreateUser`. Used for interface and function stems. */
export function workflowPascalCase(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** `create_user` → `CREATE_USER`. Used for constant identifiers. */
export function workflowConstCase(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .join('_')
    .toUpperCase();
}

/** Output filename stem — preserves the canonical workflow name. */
export function workflowFileStem(name: string): string {
  return name;
}

/** Replace any character that isn't safe for a TS identifier with `_`. */
export function workflowSafeIdent(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}

/** True when the identifier must be wrapped in quotes inside an interface. */
export function workflowNeedsQuotedKey(s: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/** Quote an identifier if it isn't a bare ident. */
export function workflowQuoteKey(s: string): string {
  return workflowNeedsQuotedKey(s) ? JSON.stringify(s) : s;
}

// ── Runtime URL/body builders ───────────────────────────────────────────

/**
 * Build the workflow execute URL **relative to the `workflow` apiManager
 * service** (which has `{origin}/workflow` as its base URL). The full
 * resolved URL is therefore
 *
 *   POST {origin}/workflow/v1/execute/sync/{name}
 *
 * The leading `/workflow` segment is provided by the service's base
 * URL — do NOT include it here, or the final URL would double up
 * (`{origin}/workflow/workflow/v1/...`). The `name` is URL-encoded
 * defensively even though valid workflow names are ASCII identifiers.
 */
export function buildWorkflowExecuteUrl(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error(
      `buildWorkflowExecuteUrl: name must be a non-empty string (got ${JSON.stringify(name)}).`,
    );
  }
  return `/v1/execute/sync/${encodeURIComponent(name)}`;
}

// ── Service Request (SR) runtime URL/body builders ──────────────────────
//
// SRs use TWO endpoints that are NOT the generic `/v1/execute/sync/{name}`
// workflow path (and are therefore NOT covered by `useWorkflow` or the
// generated `WorkflowName` registry):
//
//   1. CREATE — `POST {origin}/workflow/v1/sr/execute/{sr_workflow_name}`
//      Body `{ srInstance: { entity_reference_id, entity_type, payload },
//      arguments }`, returns `{ srInstanceId, workflowId }`.
//      `entity_reference_id` is the business-object id (boInstanceId);
//      `entity_type` is the SR's root business object name
//      (`sr_definition.root_business_object`); `payload` is the SR's dynamic
//      form-context object (e.g. `client_id`, `account_id`, initial form
//      values). It varies per SR (`Record<string, unknown>`). ALL THREE are
//      mandatory. The `payload` persists on `sr_instance.payload`, so a later
//      SR table row (which holds only the `srInstanceId`) can read it back to
//      restore the context.
//   2. SUBMIT — `POST {origin}/workflow/v1/signals/{srInstanceId}/trigger`
//      Body is the SR form values. Keyed by the `srInstanceId` returned from
//      CREATE (mandatory) — no workflow name is involved. This replaces the
//      old named `sr_submit` workflow.
//
// As with `buildWorkflowExecuteUrl`, the leading `/workflow` segment comes
// from the `workflow` apiManager service base URL — do NOT include it here.

/**
 * Build the SR **create** URL relative to the `workflow` apiManager
 * service. Full resolved URL:
 *
 *   POST {origin}/workflow/v1/sr/execute/{name}
 *
 * `name` is the SR workflow name (snake_case, from `workflows.catalog.md`).
 * It is a plain string — NOT tied to `WorkflowName` — because SR workflows
 * may be async and excluded from the generated registry.
 */
export function buildSrExecuteUrl(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error(
      `buildSrExecuteUrl: name must be a non-empty string (got ${JSON.stringify(name)}).`,
    );
  }
  return `/v1/sr/execute/${encodeURIComponent(name)}`;
}

/**
 * Build the SR **submit** (signal trigger) URL relative to the `workflow`
 * apiManager service. Full resolved URL:
 *
 *   POST {origin}/workflow/v1/signals/{srInstanceId}/trigger
 *
 * `srInstanceId` is the id returned by the CREATE call — mandatory; there is
 * no submit without it.
 */
export function buildSrSignalUrl(srInstanceId: string): string {
  if (!srInstanceId || typeof srInstanceId !== 'string') {
    throw new Error(
      `buildSrSignalUrl: srInstanceId must be a non-empty string (got ${JSON.stringify(srInstanceId)}).`,
    );
  }
  return `/v1/signals/${encodeURIComponent(srInstanceId)}/trigger`;
}

/** Inputs for the SR create request body. */
export interface SrExecuteBodyInput {
  /** Business-object id the SR acts on (boInstanceId). Mandatory. */
  entityReferenceId: string;
  /** Root business object name (`sr_definition.root_business_object`). Mandatory. */
  entityType: string;
  /**
   * The SR's dynamic form-context object, persisted to `sr_instance.payload`
   * — e.g. `{ client_id, account_id, …initial form values }`. Its shape
   * varies per SR (hence `Record<string, unknown>`). Mandatory: it is what a
   * later SR table row (holding only the `srInstanceId`) reads back to
   * restore context.
   */
  payload: Record<string, unknown>;
  /** Optional workflow arguments. Defaults to `{}`. */
  args?: Record<string, unknown>;
}

/** Shape of the SR create request body sent to `/v1/sr/execute/{name}`. */
export interface SrExecuteBody {
  srInstance: {
    entity_reference_id: string;
    entity_type: string;
    payload: Record<string, unknown>;
  };
  arguments: Record<string, unknown>;
}

/** True for a non-null, non-array plain object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Build the SR create request body. `entityReferenceId` (boInstanceId),
 * `entityType` (root BO name), and `payload` (the dynamic form-context
 * object) are ALL mandatory — throws if an id is empty or `payload` is not a
 * plain object, so a create can never be fired without them.
 *
 * Exported for unit tests.
 */
export function buildSrExecuteBody(input: SrExecuteBodyInput): SrExecuteBody {
  const { entityReferenceId, entityType, payload, args } = input ?? {};
  if (!entityReferenceId || typeof entityReferenceId !== 'string') {
    throw new Error(
      `buildSrExecuteBody: entityReferenceId (boInstanceId) is mandatory and must be a non-empty string (got ${JSON.stringify(entityReferenceId)}).`,
    );
  }
  if (!entityType || typeof entityType !== 'string') {
    throw new Error(
      `buildSrExecuteBody: entityType (root business object name) is mandatory and must be a non-empty string (got ${JSON.stringify(entityType)}).`,
    );
  }
  if (!isPlainObject(payload)) {
    throw new Error(
      `buildSrExecuteBody: payload (the SR form-context object persisted to sr_instance.payload) is mandatory and must be a plain object (got ${JSON.stringify(payload)}).`,
    );
  }
  return {
    srInstance: {
      entity_reference_id: entityReferenceId,
      entity_type: entityType,
      payload,
    },
    arguments: args ?? {},
  };
}

/**
 * Render the `const headers = getDataHeadersWithUser(...)` line that
 * goes inside each emitted `executeXxx` wrapper.
 *
 * Workflow execution requires the requesting user's id on every
 * request via the `X-Jiffy-User-Id` header (server authorises
 * per-user permission grants). `getDataHeadersWithUser` is a thin
 * wrapper around `getDataHeaders` that also stamps the user id when
 * one is available.
 *
 * Exists as a pure helper so the parenthesisation between `??` and
 * `||` is locked down by a unit test. The historical bug (PHX-3832)
 * emitted:
 *
 *   `options?.appDefinitionKey ?? PREFIX_APP_KEY || undefined`
 *
 * which trips TS5076 ("'??' and '||' operations cannot be mixed
 * without parentheses"). The required form is:
 *
 *   `options?.appDefinitionKey ?? (PREFIX_APP_KEY || undefined)`
 *
 * The parens are also semantically better — if the caller explicitly
 * passes `''` (deliberate empty), it's preserved instead of falling
 * through to the codegen-derived key.
 */
export function renderExecuteHeadersLine(prefix: string): string {
  if (!prefix || typeof prefix !== 'string') {
    throw new Error(
      `renderExecuteHeadersLine: prefix must be a non-empty string (got ${JSON.stringify(prefix)}).`,
    );
  }
  return `  const headers = getDataHeadersWithUser(options?.appDefinitionKey ?? (${prefix}_APP_KEY || undefined));`;
}

// ── Workflow definition shape ───────────────────────────────────────────

/**
 * Minimal workflow definition we read from
 * `/api/internal/component-definitions-all/workflow`. The Phoenix
 * endpoint emits more fields than this; only the ones the codegen needs
 * are declared.
 */
export interface WorkflowAttribute {
  name: string;
  label?: string;
  /** Type vocabulary: simple ('string', 'object', 'array', …) or BusinessType. */
  type?: string;
  /** Inputs vs outputs vs internals (named sub-shapes used via component_reference). */
  attributeType?: 'input' | 'output' | 'internal' | string;
  required?: boolean;
  description?: string | null;
  /**
   * Reference to a sibling internal attribute (same workflow) or to an
   * entity definition. Entity references collapse to `{ id: string }`
   * since workflows accept entity refs by id.
   */
  component_reference?: string | null;
  attributes?: WorkflowAttribute[] | null;
}

export interface WorkflowDefinition {
  name: string;
  label?: string;
  description?: string;
  type?: string;
  attributes?: WorkflowAttribute[];
  /**
   * When true, the workflow has an async execution path. V1 of the
   * codegen only supports sync workflows (the URL is
   * `/workflow/v1/execute/sync/{name}`). Async workflows are skipped
   * with a console.log so the next sub-task can pick them up without
   * rewriting the V1 surface.
   */
  is_async?: boolean;
  /**
   * App-definition key. Phoenix uses `app_definition_key` on the
   * `/api/internal` endpoint; the data-manager DTO uses
   * `target_app_definition_key`. Codegen prefers the DTO name when
   * present.
   */
  app_definition_key?: string;
  target_app_definition_key?: string;
  /**
   * Free-form classification tags from the Phoenix definition (e.g.
   * `["Service Request"]`). Surfaced in the registry + catalog so the agent
   * can discover workflows by domain (a Service-Request workflow vs. a
   * generic one) without inspecting the flow body.
   */
  tags?: string[];
  /** Workflow sub-type (e.g. "Normal"). Informational; surfaced in catalog. */
  sub_type?: string;
}

// ── Type vocabulary ─────────────────────────────────────────────────────

/**
 * Map attribute `type` (lowercased) to a TS scalar. Mirrors the
 * saved-query mapping; workflows use the same vocabulary.
 */
export const WORKFLOW_SCALAR_TS_TYPE: Record<string, string> = {
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

/**
 * True when a `component_reference` points at an entity definition
 * (`<app>.entity.<entity_name>`). Entity refs in workflow inputs collapse
 * to `{ id: string }` (the workflow execute endpoint accepts only the
 * entity's id, not the whole row) — matches the user's pasted example
 * for `create_user`: `orgId: { id: '...' }`.
 */
export function isEntityComponentReference(
  ref: string | null | undefined,
): boolean {
  if (!ref || typeof ref !== 'string') return false;
  return ref.includes('.entity.');
}

/**
 * If `ref` looks like `<app>.workflow.<thisWorkflow>.<internal_name>`,
 * return `<internal_name>`. Otherwise return null. Used to resolve
 * nested object/array attributes that point at a sibling `internal`
 * attribute within the same workflow.
 */
export function parseWorkflowInternalRef(
  ref: string | null | undefined,
  workflowName: string,
): string | null {
  if (!ref || typeof ref !== 'string') return null;
  const parts = ref.split('.');
  const wfIdx = parts.indexOf('workflow');
  if (wfIdx < 0 || wfIdx + 2 >= parts.length) return null;
  if (parts[wfIdx + 1] !== workflowName) return null;
  return parts[wfIdx + 2];
}

// ── Type emission ───────────────────────────────────────────────────────

export interface ResolverContext {
  workflowName: string;
  internals: Map<string, WorkflowAttribute[]>;
  /**
   * Index of sibling component definitions (partner modules, partner
   * categories, saved queries, other workflows) so workflow attributes
   * that reference structures on OTHER components can be resolved to
   * their inner shapes. When omitted (or `EMPTY_COMPONENT_INDEX`), the
   * resolver behaves as before: cross-component refs fall through to
   * `Record<string, unknown>` / `unknown[]`.
   */
  componentIndex: ComponentIndex;
  /**
   * Visited set for cross-component cycle detection. Keyed by the full
   * reference string. Each top-level `attrTsType` call gets a fresh
   * `new Set()`; recursive resolution passes `new Set(visited)` down so
   * sibling branches don't interfere.
   */
  crossComponentVisited: Set<string>;
}

export function buildResolverContext(
  wf: WorkflowDefinition,
  componentIndex: ComponentIndex = EMPTY_COMPONENT_INDEX,
): ResolverContext {
  const internals = new Map<string, WorkflowAttribute[]>();
  for (const a of wf.attributes ?? []) {
    if ((a.attributeType ?? '').toLowerCase() === 'internal') {
      internals.set(a.name, a.attributes ?? []);
    }
  }
  return {
    workflowName: wf.name,
    internals,
    componentIndex,
    crossComponentVisited: new Set<string>(),
  };
}

function resolveByRef(
  attr: WorkflowAttribute,
  ctx: ResolverContext,
  visited: Set<string>,
): WorkflowAttribute[] | null {
  if (attr.attributes && attr.attributes.length > 0) return attr.attributes;
  const refName = parseWorkflowInternalRef(
    attr.component_reference,
    ctx.workflowName,
  );
  if (!refName) return null;
  if (visited.has(refName)) return null;
  const target = ctx.internals.get(refName);
  if (!target) return null;
  visited.add(refName);
  return target;
}

/** Render the TS type for a single workflow attribute. */
export function attrTsType(
  attr: WorkflowAttribute,
  ctx: ResolverContext,
  indent: number,
  visited: Set<string>,
): string {
  const t = (attr.type ?? '').toLowerCase();

  // Entity references in inputs/outputs collapse to `{ id: string }`. The
  // workflow execute endpoint takes only the entity id; passing the full
  // entity row would be ignored. Arrays of entity refs become
  // `{ id: string }[]`.
  if (isEntityComponentReference(attr.component_reference)) {
    return t === 'array' ? '{ id: string }[]' : '{ id: string }';
  }

  // 1. Same-workflow `internal` ref (existing behaviour).
  if (t === 'array') {
    const inner = resolveByRef(attr, ctx, visited);
    if (inner) {
      return `${renderObjectInline(inner, ctx, indent + 1, visited)}[]`;
    }
    // 2. Cross-component ref fallback.
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
  return WORKFLOW_SCALAR_TS_TYPE[t] ?? 'unknown';
}

/**
 * Walk a workflow attribute's `component_reference` into a sibling
 * component definition via the shared resolver. Returns the cross-
 * component target's attributes as `WorkflowAttribute`s (the two
 * shapes are structurally compatible — same minimal surface).
 *
 * Visited set is forked per call so siblings don't interfere with
 * each other (one branch resolving ref A doesn't poison another
 * branch trying to resolve the same ref).
 */
function resolveCrossComponentForAttr(
  attr: WorkflowAttribute,
  ctx: ResolverContext,
): WorkflowAttribute[] | null {
  const ref = attr.component_reference;
  if (!ref) return null;
  // Skip entity refs — caller handles those separately (collapse to
  // `{ id: string }`).
  const parsed = parseComponentReference(ref);
  if (!parsed || parsed.componentType === 'entity') return null;
  // Skip refs that point at THIS workflow's own internals — those are
  // already handled by resolveByRef. Avoids double-resolution.
  if (
    parsed.componentType === 'workflow' &&
    parsed.componentName === ctx.workflowName
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
  // Track resolved refs at the context level so cycles spanning
  // multiple attrTsType calls in the same render still terminate.
  for (const v of branchVisited) ctx.crossComponentVisited.add(v);
  // One level of single-child unwrap to match the renderer.
  const { attrs: unwrapped } = unwrapSingleChildStructure(
    resolved as ComponentAttribute[],
  );
  return unwrapped as WorkflowAttribute[];
}

function renderObjectInline(
  attrs: WorkflowAttribute[],
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
    lines.push(`${pad}${workflowQuoteKey(a.name)}${optional}: ${ts};`);
  }
  lines.push(`${closePad}}`);
  return lines.join('\n');
}

/** Render `export interface Name { … }` (top-level, indent = 1). */
export function renderInterface(
  name: string,
  attrs: WorkflowAttribute[],
  ctx: ResolverContext,
): string {
  if (attrs.length === 0) {
    return `export interface ${name} {\n  [key: string]: unknown;\n}`;
  }
  const lines: string[] = [];
  lines.push(`export interface ${name} {`);
  for (const a of attrs) {
    const optional = a.required ? '' : '?';
    const ts = attrTsType(a, ctx, 2, new Set());
    if (a.label || a.description) {
      const docBits: string[] = [];
      if (a.label) docBits.push(a.label);
      if (a.description) docBits.push(a.description);
      lines.push(`  /** ${docBits.join(' — ')} */`);
    }
    lines.push(`  ${workflowQuoteKey(a.name)}${optional}: ${ts};`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

// ── Catalog rendering ───────────────────────────────────────────────────

export interface WorkflowCatalogField {
  name: string;
  required?: boolean;
  /**
   * Original `component_reference` string when the field's type was
   * resolved through the cross-component index. Surfaced in the
   * catalog markdown so the agent can trace the type back to its
   * source schema (saved-query / partner-module / workflow / entity).
   * `undefined` when the field has no ref, points at the same
   * component's internal, or its ref didn't resolve.
   */
  resolvedFrom?: string;
}

export interface WorkflowCatalogOutput {
  name: string;
  /** See `WorkflowCatalogField.resolvedFrom`. */
  resolvedFrom?: string;
}

export interface WorkflowCatalogEntry {
  name: string;
  label: string;
  description: string;
  appKey: string;
  inputs: WorkflowCatalogField[];
  outputs: WorkflowCatalogOutput[];
  /** True for async workflows the V1 codegen skipped. Useful to surface in the catalog so the agent knows the gap. */
  isAsyncSkipped?: boolean;
  /** Classification tags (e.g. "Service Request"). */
  tags?: string[];
  /** Workflow sub-type (e.g. "Normal"). */
  subType?: string;
}

const CATALOG_HEADER = `# Workflows Catalog

Auto-generated by \`scripts/fetch-workflows.ts\`. One entry per workflow
exposed by the tenant.

**To find a workflow by intent, grep this file by keyword** (e.g.
"create_user", "approve", "send"). Each entry shows the hook to use,
the inputs to pass, the output, and the description copied from the
Phoenix UI. Then open \`src/types/workflows/{name}.ts\` for the
precise TypeScript input/output shape.

Workflows have **side effects** — call them through
\`useWorkflow(name)\` and invoke \`mutate(input)\` or
\`mutateAsync(input)\` on user action. They are NOT auto-fired like
saved queries.

`;

function formatField(name: string, resolvedFrom?: string): string {
  return resolvedFrom
    ? `\`${name}\` → resolved from \`${resolvedFrom}\``
    : `\`${name}\``;
}

function formatInputs(inputs: WorkflowCatalogField[]): string {
  if (inputs.length === 0) return '_(none)_';
  return inputs
    .map((f) => {
      const base = formatField(f.name, f.resolvedFrom);
      return f.required ? `${base} (required)` : base;
    })
    .join(', ');
}

function formatOutputs(outputs: WorkflowCatalogOutput[]): string {
  if (outputs.length === 0) return '_(none)_';
  return outputs.map((o) => formatField(o.name, o.resolvedFrom)).join(', ');
}

function formatDescription(desc: string): string {
  const trimmed = desc.replace(/\r?\n+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : '_(no description provided)_';
}

function renderEntry(entry: WorkflowCatalogEntry): string {
  const lines: string[] = [];
  const heading = entry.label
    ? `### \`${entry.name}\` — "${entry.label}"`
    : `### \`${entry.name}\``;
  lines.push(heading);
  if (entry.isAsyncSkipped) {
    lines.push(
      `- **Hook:** _async workflow — not surfaced by V1 codegen. Skipped._`,
    );
    if (entry.tags && entry.tags.length > 0) {
      lines.push(`- **Tags:** ${entry.tags.map((t) => `\`${t}\``).join(', ')}`);
    }
    lines.push(formatDescription(entry.description));
    return lines.join('\n');
  }
  lines.push(`- **Hook:** \`useWorkflow(${JSON.stringify(entry.name)})\``);
  const appCol = entry.appKey ? `  ·  **App:** ${entry.appKey}` : '';
  lines.push(`- **Mode:** sync${appCol}`);
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`- **Tags:** ${entry.tags.map((t) => `\`${t}\``).join(', ')}`);
  }
  lines.push(`- **Inputs:** ${formatInputs(entry.inputs)}`);
  lines.push(`- **Outputs:** ${formatOutputs(entry.outputs)}`);
  lines.push(formatDescription(entry.description));
  return lines.join('\n');
}

/**
 * Render the markdown catalog as a single string. Entries are sorted
 * alphabetically by `name` so the file is deterministic across runs.
 */
export function renderWorkflowCatalog(
  entries: WorkflowCatalogEntry[],
): string {
  if (entries.length === 0) {
    return (
      CATALOG_HEADER +
      `_No workflows available. Either the tenant has none defined, or\n` +
      `\`PHOENIX_API_URL\` / \`TENANT_ID\` were not set when the catalog was\n` +
      `regenerated. Run \`npm run fetch:workflows\` to refresh._\n`
    );
  }
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const body = sorted.map(renderEntry).join('\n\n');
  return `${CATALOG_HEADER}---\n\n${body}\n`;
}
