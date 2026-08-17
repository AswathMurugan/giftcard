/**
 * Shared cross-component reference resolver.
 *
 * Workflow and partner-module definitions in Phoenix routinely reference
 * structures that live on a DIFFERENT component (different definition
 * endpoint). The reference string format is:
 *
 *   {appDefinition}.{componentType}.{componentName}[.{structureName}]
 *
 *   e.g.
 *     partner_module_salesforceapisv3_*.partner_module_request.describeSObjects.responseStructure
 *     advisorworkstation_*.saved-query.get_account_summary_details.responseStructure
 *     wealthdomain_*.entity.account
 *
 * The renderer's `parseComponentReference` (libs/editors/workflow/src/lib/
 * hooks/useScopeVariables.ts:400-411) and `resolveNonEntityComponentRef`
 * (same file, lines 791-869) is the reference pattern we mirror here.
 *
 * This module is the COMMON resolution layer used by both `workflows-codegen`
 * and `partner-modules-codegen`. Each consumer's `attrTsType` walks its
 * own type vocabulary; this module only answers "given this ref, here
 * are the target attributes" (or null when the target / structure isn't
 * available in the index).
 *
 * Pure module — no I/O. Callers populate the `ComponentIndex` from
 * already-fetched definitions (`/api/internal/component-definitions-all/*`).
 */

// ── Reference parsing ───────────────────────────────────────────────────

export interface ParsedComponentRef {
  /** First segment — typically the `app_definition_key` (e.g. `platform`, `wealthdomain_*`). */
  appDefinition: string;
  /** Component category — `entity`, `workflow`, `partner_module_request`, `partner_category`, `saved-query`. */
  componentType: string;
  /** The specific component name within the category. */
  componentName: string;
  /**
   * Sub-structure name (e.g. `responseStructure`, `bodyStructure`,
   * `requestStructure`). When the ref doesn't include a 4th segment,
   * the resolver returns the component's top-level attributes
   * filtered to `output` (falling back to `input` then "all").
   * Matches the renderer's behaviour in
   * `resolveNonEntityComponentRef` lines 827-849.
   */
  structureName: string | null;
}

/**
 * Parse a component reference string. Returns null when the ref has
 * fewer than three segments (under-specified) or when input is
 * empty/non-string.
 */
export function parseComponentReference(
  ref: string | null | undefined,
): ParsedComponentRef | null {
  if (!ref || typeof ref !== 'string') return null;
  const parts = ref.split('.');
  if (parts.length < 3) return null;
  return {
    appDefinition: parts[0],
    componentType: parts[1],
    componentName: parts[2],
    structureName: parts.length > 3 ? parts[3] : null,
  };
}

/** True iff `ref` is an `*.entity.*` reference (the codegen collapses these to `{ id: string }`). */
export function isEntityRef(ref: string | null | undefined): boolean {
  const parsed = parseComponentReference(ref);
  return parsed?.componentType === 'entity';
}

// ── Component definition shape (minimum we need) ────────────────────────

/**
 * The shape of an attribute we walk inside a component. Both workflow
 * and partner-module attributes share this minimal surface; each
 * codegen has its own richer type that's structurally compatible.
 */
export interface ComponentAttribute {
  name: string;
  type?: string;
  attributeType?: string;
  required?: boolean;
  description?: string | null;
  component_reference?: string | null;
  attributes?: ComponentAttribute[] | null;
  label?: string;
}

/** A component definition — shape `/component-definitions-all/<type>` returns. */
export interface ComponentDefinition {
  name: string;
  /** Where the codegen finds the attribute tree for this component. */
  attributes?: ComponentAttribute[];
  /** Used only for diagnostics — not part of resolution. */
  app_definition_key?: string;
}

// ── Index ───────────────────────────────────────────────────────────────

/**
 * Lookup table for cross-component resolution. Keyed by
 * `componentType + componentName`. App-key is intentionally NOT part
 * of the key — the renderer's own resolver also matches by name
 * within a type. If two tenants ever ship duplicate names within the
 * same component type, first-wins (sorted alphabetically by app key
 * during construction for determinism).
 */
export interface ComponentIndex {
  get(
    componentType: string,
    componentName: string,
  ): ComponentDefinition | null;
}

export interface ComponentIndexInputs {
  workflows?: ComponentDefinition[];
  partnerModules?: ComponentDefinition[];
  partnerCategories?: ComponentDefinition[];
  savedQueries?: ComponentDefinition[];
  /**
   * `entity` resolution is not handled here — workflow/partner codegens
   * collapse entity refs to `{ id: string }` themselves. Including
   * entities is optional and ignored by `resolveCrossComponentStructure`.
   */
  entities?: ComponentDefinition[];
}

function indexKey(componentType: string, componentName: string): string {
  return `${componentType}::${componentName}`;
}

/**
 * Build a `ComponentIndex` from the four definition lists fetched at
 * codegen time. Returns an interface (rather than a Map) so future
 * implementations can swap to fancier lookup logic (e.g. app-key tie
 * breakers) without changing call sites.
 */
export function buildComponentIndex(
  inputs: ComponentIndexInputs,
): ComponentIndex {
  const map = new Map<string, ComponentDefinition>();
  const insert = (type: string, defs: ComponentDefinition[] | undefined) => {
    if (!defs) return;
    // Deterministic insertion: stable sort by app_definition_key then name
    // so first-wins behaviour is reproducible.
    const sorted = [...defs].sort((a, b) => {
      const ka = a.app_definition_key ?? '';
      const kb = b.app_definition_key ?? '';
      if (ka !== kb) return ka.localeCompare(kb);
      return a.name.localeCompare(b.name);
    });
    for (const def of sorted) {
      const key = indexKey(type, def.name);
      if (!map.has(key)) map.set(key, def);
    }
  };
  insert('workflow', inputs.workflows);
  insert('partner_module_request', inputs.partnerModules);
  insert('partner_category', inputs.partnerCategories);
  insert('saved-query', inputs.savedQueries);
  // Mirror Phoenix's two saved-query type spellings — see useScopeVariables
  // which also normalises. We index both keys against the same defs.
  insert('saved_query', inputs.savedQueries);
  insert('entity', inputs.entities);
  return {
    get(componentType, componentName) {
      return map.get(indexKey(componentType, componentName)) ?? null;
    },
  };
}

/**
 * Empty index for tests / contexts where cross-component resolution
 * shouldn't fire. `attrTsType` consumers that pass this fall back to
 * the existing `Record<string, unknown>` / `unknown[]` defaults.
 */
export const EMPTY_COMPONENT_INDEX: ComponentIndex = {
  get: () => null,
};

// ── Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a cross-component reference to the target attributes.
 *
 * Algorithm:
 *   1. Parse the ref. Reject when the parser fails (under-specified ref).
 *   2. Skip when the ref is an `entity` ref — entity refs are the
 *      consumer's responsibility (collapse to `{ id: string }`).
 *   3. Look up the target component in the index. Miss → null.
 *   4. When `structureName` is set:
 *        - Find the target's `attributeType: 'internal'` attribute whose
 *          name matches `structureName`.
 *        - Return its `attributes[]`.
 *      When `structureName` is null:
 *        - Return the target's `output` attributes (fallback to `input`
 *          then to all). Mirrors renderer lines 834-849.
 *   5. Return null when the structure is missing.
 *
 * Cycle protection: callers pass a `visited: Set<string>` keyed by the
 * full ref string. The resolver early-returns null when a ref recurs.
 * Callers that walk inner attributes should pass `new Set(visited)`
 * down so siblings don't trip each other.
 */
export function resolveCrossComponentStructure(
  ref: string | null | undefined,
  index: ComponentIndex,
  visited: Set<string>,
): ComponentAttribute[] | null {
  const parsed = parseComponentReference(ref);
  if (!parsed) return null;
  // Entity refs handled by the consumer.
  if (parsed.componentType === 'entity') return null;
  if (!ref || visited.has(ref)) return null;
  visited.add(ref);

  const target = index.get(parsed.componentType, parsed.componentName);
  if (!target?.attributes) return null;

  if (parsed.structureName) {
    // 1. Strict — literal `internal` attribute matching structureName.
    //    Partner modules + workflows that declare a wrapping internal
    //    (e.g. `partner_module_request.<name>.responseStructure`) hit
    //    this path.
    const structure = target.attributes.find(
      (a) =>
        a.name === parsed.structureName &&
        (a.attributeType ?? '').toLowerCase() === 'internal',
    );
    if (structure?.attributes && structure.attributes.length > 0) {
      return structure.attributes;
    }

    // 2. Keyword-alias fallback — saved queries (and any other component
    //    type whose definition exposes request/response shape as
    //    top-level role attributes rather than as a wrapping internal)
    //    store their response as the top-level `output` attributes.
    //    Map the structure keyword to the role and return the matching
    //    attributes. The renderer's `resolveNonEntityComponentRef`
    //    strict-match returns null on this path; we treat that as a
    //    codegen-side limitation worth fixing rather than mirroring.
    const aliased = resolveAliasedStructure(parsed.structureName, target);
    if (aliased && aliased.length > 0) return aliased;

    return null;
  }

  // No structureName — prefer outputs, then inputs, then all. Matches
  // renderer's resolveNonEntityComponentRef branch.
  const outputs = target.attributes.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === 'output',
  );
  if (outputs.length > 0) return outputs;
  const inputs = target.attributes.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === 'input',
  );
  if (inputs.length > 0) return inputs;
  if (target.attributes.length > 0) return target.attributes;
  return null;
}

/**
 * Map common structure keywords (`responseStructure`, `requestStructure`,
 * `bodyStructure`, …) to the appropriate role-filtered attributes on a
 * target component when the target stores its shape as top-level
 * attributes rather than inside a wrapping `internal`.
 *
 * Saved-query definitions are the canonical case: their response is
 * the list of `attributeType: 'output'` attributes at the top level,
 * not an `internal` attribute named `responseStructure`. Workflow refs
 * that point at saved-query response shapes can't resolve via the
 * strict-match path; this alias closes the gap.
 *
 * Returns null when the keyword isn't recognised — caller treats that
 * as "no soft match" and returns the strict-match null.
 *
 * Exported for unit tests.
 */
export function resolveAliasedStructure(
  structureName: string,
  target: ComponentDefinition,
): ComponentAttribute[] | null {
  const attrs = target.attributes;
  if (!attrs || attrs.length === 0) return null;

  // Lowercase comparison so PascalCase / snake_case alternates all hit.
  const key = structureName.toLowerCase();

  const RESPONSE_KEYWORDS = new Set([
    'responsestructure',
    'output',
    'outputstructure',
    'outputs',
  ]);
  const REQUEST_KEYWORDS = new Set([
    'requeststructure',
    'bodystructure',
    'input',
    'inputstructure',
    'inputs',
  ]);

  let roleFilter: 'output' | 'input' | null = null;
  if (RESPONSE_KEYWORDS.has(key)) roleFilter = 'output';
  else if (REQUEST_KEYWORDS.has(key)) roleFilter = 'input';
  if (!roleFilter) return null;

  const matched = attrs.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === roleFilter,
  );
  return matched.length > 0 ? matched : null;
}

/**
 * One level of single-child unwrap, matching the renderer's
 * `useScopeVariables.ts:856-868` behaviour.
 *
 * When a resolved structure contains exactly one attribute AND that
 * attribute is `object` or `array` with inner fields, treat the wrapper
 * as transparent and return the inner attributes directly. The caller
 * then emits the workflow / partner output type AS the inner shape
 * rather than `{ <singleKey>: <innerShape> }`.
 *
 * Returns the unwrapped attributes when applicable; otherwise returns
 * the original list unchanged.
 *
 * Capped at one level by design — multi-level pathological structures
 * keep their wrappers so we never trip into infinite-unwrap surprises.
 */
export function unwrapSingleChildStructure(
  attrs: ComponentAttribute[],
): { attrs: ComponentAttribute[]; isArray: boolean } {
  if (attrs.length !== 1) return { attrs, isArray: false };
  const only = attrs[0];
  const inner = only.attributes;
  if (!inner || inner.length === 0) return { attrs, isArray: false };
  const isArray = (only.type ?? '').toLowerCase() === 'array';
  return { attrs: inner, isArray };
}
