/**
 * Fetches entity definitions for a configured tenant from the Phoenix
 * `/api/internal/component-definitions-all/entity` endpoint and emits one
 * TypeScript interface file per entity into `src/types/entities/`.
 *
 * Config (env-only, read from `.env` or the process env):
 *   - PHOENIX_API_URL          e.g. https://jiffy.us.sandbox.phoenix.jiffy.ai
 *   - TENANT_ID                e.g. aiwithdata
 *   - FETCH_ENTITIES_OUT_DIR   (optional) absolute path to write entity files
 *                              into. Defaults to <project>/src/types/entities.
 *                              Set this when running from the backend bootstrap
 *                              to redirect output into a workspace's tree.
 *
 * Invocation:
 *   npm run fetch:entities         # developer mode — writes to starter
 *   # or directly:
 *   npx tsx scripts/fetch-entities.ts
 *
 * The backend's workspace bootstrap (backend-node/src/workspace.ts) spawns
 * this script per workspace with FETCH_ENTITIES_OUT_DIR pointed at the
 * workspace's `src/types/entities/` so each session gets a fresh tenant
 * snapshot.
 *
 * Output is deterministic (sorted) and the script skips writes when a file's
 * content is unchanged.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import type {
  BusinessType,
  Constraint,
  ConstraintType,
  Entity,
  Field,
} from '../src/types/entity';
import { enumClassName } from '../src/lib/enumerations-codegen';
import {
  detectNameCollisions,
  formatCollisionWarning,
  appKeyDir,
} from '../src/lib/codegen-collisions';
import { phoenixUrl, withAuth, usingGatewayAuth } from './lib/phoenix-http';

// =============================================================================
// .env loader (no `dotenv` dep — keep the script lean)
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
// Naming helpers
// =============================================================================

/**
 * `user` → `User`, `user_role` → `UserRole`.
 *
 * The result is used verbatim as a TypeScript IDENTIFIER (interface names,
 * `export type <X>FieldName`, import bindings), so it must be a legal one. A TS
 * identifier cannot start with a digit, but Phoenix app keys can — e.g. the
 * tenant app `123aa_6a3d52e23440815cac51d012` produced
 *
 *     export type 123aa6a3d52e23440815cac51d012_AddressFieldName = …
 *
 * which is a syntax error that broke the ENTIRE generated file (and therefore
 * every app in that workspace, with an error pointing at generated code rather
 * than the cause). Prefix `_` when the leading character isn't a valid
 * identifier start. This is the same class of bug `tsPropertyKey` already
 * guards for field names like `1035_exchange_amount`.
 *
 * Exported for unit tests.
 */
export function entityClassName(name: string): string {
  const pascal = name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return /^[A-Za-z_$]/.test(pascal) ? pascal : `_${pascal}`;
}

/** Output filename stem — preserves the canonical entity name (snake_case). */
function entityFileStem(name: string): string {
  return name;
}

/**
 * `account_asset_allocation` → `ACCOUNT_ASSET_ALLOCATION` for const identifiers.
 * Digit-guarded for the same reason as {@link entityClassName}.
 */
function entityConstName(name: string): string {
  const upper = name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .join('_')
    .toUpperCase();
  return /^[A-Za-z_$]/.test(upper) ? upper : `_${upper}`;
}

/**
 * Raw entity names whose EMITTED TS identifier (`entityClassName`) collides.
 *
 * Collision must be detected on the PascalCase identifier, not the raw
 * snake_case name: two distinct raw names can normalise to the same identifier
 * — e.g. `entity_1` and `entity1` both become `Entity1` — which would emit
 * duplicate barrel exports / registry classes (TS2308) unless app-qualified.
 *
 * We count ENTITIES per className (not distinct raw names): a cross-app
 * same-name pair like `account`/`account` is a single raw name but two entities
 * that must still collide. Any className shared by 2+ entities marks all of
 * their raw names as collided. This is a superset of the old raw-name rule, so
 * entities that already aliased are unaffected.
 */
export function computeCollidedEntityNames(
  entities: readonly { name: string }[],
): Set<string> {
  const classCounts = new Map<string, number>();
  for (const e of entities) {
    const cls = entityClassName(e.name);
    classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
  }
  const collided = new Set<string>();
  for (const e of entities) {
    if ((classCounts.get(entityClassName(e.name)) ?? 0) > 1) {
      collided.add(e.name);
    }
  }
  return collided;
}

/**
 * Registry identity for an entity in `entities.generated.ts`. App-qualified
 * (`<appKeyDir>/<name>`) ONLY when the name collides across apps — unique
 * names keep their clean bare key, so the registry stays familiar and the
 * DynQL wire name (the bare snake_case `name`) is unaffected for the common
 * case.
 */
function entityRegistryKey(e: Entity, collided: ReadonlySet<string>): string {
  return collided.has(e.name)
    ? `${appKeyDir(e.app_definition_key ?? '')}/${e.name}`
    : e.name;
}

/** Unique TS identifier base for a registry entry (collision-qualified). */
function entityRegistryClass(e: Entity, collided: ReadonlySet<string>): string {
  return collided.has(e.name)
    ? `${entityClassName(appKeyDir(e.app_definition_key ?? ''))}_${entityClassName(e.name)}`
    : entityClassName(e.name);
}

// =============================================================================
// BusinessType → TypeScript primitive
// =============================================================================

const SCALAR_TS_TYPE: Partial<Record<BusinessType, string>> = {
  UUID: 'string',
  Text: 'string',
  Multilinetext: 'string',
  Email: 'string',
  Phonenumber: 'string',
  SSN: 'string',
  URL: 'string',
  File: 'string',
  Seal: 'string',
  Signature: 'string',
  Enumeration: 'string',
  Date: 'string',
  Datetime: 'string',
  Duration: 'string',
  Ltree: 'string',
  Integer: 'number',
  Decimal: 'number',
  Float: 'number',
  Currency: 'number',
  Percent: 'number',
  Autonumber: 'number',
  Checkbox: 'boolean',
  Json: 'Record<string, unknown>',
  Computed: 'unknown',
};

interface ResolvedFieldType {
  /** TypeScript type expression (e.g. `string`, `Org`, `UserRole[]`). */
  expr: string;
  /** Linked target entity name if this references another interface (for imports). */
  importTarget?: string;
  /** Enumeration name resolved for this field (snake_case), if any. */
  enumImportTarget?: string;
}

/**
 * Resolve an `Enumeration`-typed field to a known enum name from the
 * lookup map. Search order:
 *   1. `<entity>_<field>`   (e.g. `account_type`)
 *   2. `<field>`            (e.g. `type`)
 *   3. `<entity>_<field>_enum` / `<field>_enum`
 * Returns the matching enum name or `undefined` when nothing matches.
 */
function resolveEnumerationName(
  entityName: string,
  field: Field,
  enums: Set<string>,
): string | undefined {
  if (enums.size === 0) return undefined;
  const candidates = [
    `${entityName}_${field.name}`,
    field.name,
    `${entityName}_${field.name}_enum`,
    `${field.name}_enum`,
  ];
  for (const c of candidates) {
    if (enums.has(c)) return c;
  }
  return undefined;
}

function resolveFieldType(
  field: Field,
  knownEntityNames: Set<string>,
  knownEnumerationNames: Set<string>,
  entityName: string,
): ResolvedFieldType {
  const cardinality = field.cardinality;
  const isMany = cardinality === 'oneToMany' || cardinality === 'manyToMany';

  let base: string;
  let importTarget: string | undefined;
  let enumImportTarget: string | undefined;

  if (field.type === 'Link') {
    const target = field.linkTarget;
    if (target && knownEntityNames.has(target)) {
      base = entityClassName(target);
      importTarget = target;
    } else {
      base = 'unknown';
    }
    if (isMany) base = `${base}[]`;
  } else if (field.type === 'Backlink') {
    const target = field.backlinkSourceEntity ?? field.linkTarget;
    if (target && knownEntityNames.has(target)) {
      base = entityClassName(target);
      importTarget = target;
    } else {
      base = 'unknown';
    }
    base = `${base}[]`;
  } else if (field.type === 'Enumeration') {
    // Try to resolve to a known enum union; otherwise fall back to `string`
    // (matches the previous behaviour for tenants without `/enum` data).
    const enumName = resolveEnumerationName(entityName, field, knownEnumerationNames);
    if (enumName) {
      base = enumClassName(enumName);
      enumImportTarget = enumName;
    } else {
      base = SCALAR_TS_TYPE[field.type] ?? 'string';
    }
  } else {
    base = SCALAR_TS_TYPE[field.type] ?? 'unknown';
  }

  if (field.isArray && !base.endsWith('[]')) {
    base = `${base}[]`;
  }

  return { expr: base, importTarget, enumImportTarget };
}

// =============================================================================
// File emission
// =============================================================================

/**
 * Render an interface property key. TypeScript only allows an UNQUOTED key
 * when it's a valid identifier; Phoenix field names are not guaranteed to be
 * — e.g. `1035_exchange_amount` starts with a digit, which is a syntax error
 * as a bare key (`1035_exchange_amount?: number;`). Quote any non-identifier
 * key via `JSON.stringify` (`'1035_exchange_amount'?: number;`). Valid
 * identifiers are left unquoted so the generated files stay clean.
 *
 * Exported for unit tests.
 */
export function tsPropertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * First-wins dedupe of an entity's fields by `name` (PHX-4986). Phoenix can
 * return two attributes that share the same stored `name` — distinct fieldIds,
 * often the same label (e.g. two `closing_price` columns). Emitting both
 * produces DUPLICATE interface members / object keys in the generated types.
 * Every field-iterating emitter runs its input through this first.
 */
export function dedupeFieldsByName(fields: Field[]): Field[] {
  const seen = new Set<string>();
  const out: Field[] = [];
  for (const f of fields) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    out.push(f);
  }
  return out;
}

/**
 * Resolve which app-folder a link target lives in. Entities are written under
 * `entities/<appKeyDir>/<name>.ts`, so a cross-entity import must point at the
 * target's app folder. Prefer the SAME app as the source entity (links are
 * usually intra-app); otherwise fall back to the first app that declares the
 * target name.
 */
function resolveTargetAppDir(
  targetName: string,
  sourceAppKey: string,
  entityAppKeys: Map<string, Set<string>>,
): string {
  const apps = entityAppKeys.get(targetName);
  if (apps && apps.has(sourceAppKey)) return appKeyDir(sourceAppKey);
  if (apps && apps.size > 0) return appKeyDir([...apps].sort()[0]);
  return appKeyDir(sourceAppKey);
}

/**
 * Render a field's `constraints` object (from the Phoenix entity response) as a
 * TS object literal — e.g. `{ maxLength: { value: "255" } }`. Returns '' when
 * there are no usable constraints. Only the data-carrying keys of each
 * `Constraint` (`value` / `allowedValues` / `message`) are emitted.
 */
function renderConstraintsObject(
  constraints: Partial<Record<ConstraintType, Constraint>> | undefined,
): string {
  if (!constraints) return '';
  const parts: string[] = [];
  for (const key of Object.keys(constraints) as ConstraintType[]) {
    const c = constraints[key];
    if (!c) continue;
    const cParts: string[] = [];
    if (c.value !== undefined) cParts.push(`value: ${JSON.stringify(c.value)}`);
    if (c.allowedValues !== undefined)
      cParts.push(`allowedValues: ${JSON.stringify(c.allowedValues)}`);
    if (c.message !== undefined) cParts.push(`message: ${JSON.stringify(c.message)}`);
    if (cParts.length === 0) continue;
    parts.push(`${tsPropertyKey(key)}: { ${cParts.join(', ')} }`);
  }
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '';
}

/**
 * Render the `<ENTITY>_FIELD_CONSTRAINTS` const: a map of field name to its
 * Phoenix-declared validation metadata (`required` + `constraints`). Only
 * fields that are required or carry at least one constraint are listed, so the
 * const stays small. Consumed as the DEFAULT UI validation when building a form
 * for the entity (required markers, maxLength, min/max, regex, oneOf).
 *
 * Returns [] when no field has metadata — the const is then omitted entirely.
 * Exported for unit tests.
 */
export function renderFieldConstraints(entity: Entity): string[] {
  const sorted = dedupeFieldsByName(entity.fields).sort((a, b) => {
    if (a.name === 'id' && b.name !== 'id') return -1;
    if (b.name === 'id' && a.name !== 'id') return 1;
    return a.name.localeCompare(b.name);
  });

  const entries: string[] = [];
  for (const f of sorted) {
    const parts: string[] = [];
    if (f.name === 'id' || f.required === true) parts.push('required: true');
    const constraintsExpr = renderConstraintsObject(f.constraints);
    if (constraintsExpr) parts.push(`constraints: ${constraintsExpr}`);
    if (parts.length === 0) continue;
    entries.push(`  ${tsPropertyKey(f.name)}: { ${parts.join(', ')} },`);
  }

  if (entries.length === 0) return [];

  const constName = `${entityConstName(entity.name)}_FIELD_CONSTRAINTS`;
  return [
    `/**`,
    ` * Field-level validation declared in Phoenix for \`${entity.name}\`.`,
    ` * Use as DEFAULT UI constraints when building a form for this entity`,
    ` * (mark required fields, set maxLength / min / max, apply regex / oneOf).`,
    ` * Only fields that are required or carry a constraint are listed.`,
    ` */`,
    `export const ${constName} = {`,
    ...entries,
    `} as const;`,
    ``,
  ];
}

function renderEntityFile(
  entity: Entity,
  knownEntityNames: Set<string>,
  knownEnumerationNames: Set<string>,
  entityAppKeys: Map<string, Set<string>>,
): string {
  const interfaceName = entityClassName(entity.name);
  const lines: string[] = [];

  lines.push(`// AUTO-GENERATED by scripts/fetch-entities.ts - do not edit by hand.`);
  lines.push(`// Source: Phoenix /api/internal/component-definitions-all/entity`);
  lines.push(`// Tenant scope: see TENANT_ID used at generation time.`);
  lines.push(``);

  // Stable field ordering: `id` first, then by name. (Deduped by name first —
  // Phoenix may return two attributes with the same name; see PHX-4986.)
  const fields = dedupeFieldsByName(entity.fields).sort((a, b) => {
    if (a.name === 'id' && b.name !== 'id') return -1;
    if (b.name === 'id' && a.name !== 'id') return 1;
    return a.name.localeCompare(b.name);
  });

  // Resolve all field types, collect unique import targets (skip self-refs).
  const resolved = fields.map((f) => ({
    field: f,
    ...resolveFieldType(f, knownEntityNames, knownEnumerationNames, entity.name),
  }));
  const importTargets = new Set<string>();
  const enumImportTargets = new Set<string>();
  for (const r of resolved) {
    if (r.importTarget && r.importTarget !== entity.name) {
      importTargets.add(r.importTarget);
    }
    if (r.enumImportTarget) {
      enumImportTargets.add(r.enumImportTarget);
    }
  }

  // Use the `@/` alias (not relative `./`) so imports are independent of the
  // per-app folder depth (`entities/<appKeyDir>/<name>.ts`).
  const srcAppKey = entity.app_definition_key ?? '';
  const sortedImports = [...importTargets].sort();
  for (const target of sortedImports) {
    const tgtDir = resolveTargetAppDir(target, srcAppKey, entityAppKeys);
    lines.push(
      `import type { ${entityClassName(target)} } from '@/types/entities/${tgtDir}/${entityFileStem(target)}';`,
    );
  }
  const sortedEnumImports = [...enumImportTargets].sort();
  for (const enumName of sortedEnumImports) {
    lines.push(
      `import type { ${enumClassName(enumName)} } from '@/types/enumerations';`,
    );
  }
  if (sortedImports.length > 0 || sortedEnumImports.length > 0) lines.push(``);

  if (entity.label || entity.description) {
    lines.push(`/**`);
    if (entity.label) lines.push(` * ${entity.label}`);
    if (entity.description) lines.push(` * ${entity.description}`);
    lines.push(` */`);
  }
  lines.push(`export interface ${interfaceName} {`);

  for (const r of resolved) {
    const { field, expr } = r;
    const isRequired = field.name === 'id' || field.required === true;
    const optionalMark = isRequired ? '' : '?';
    if (field.label || field.description) {
      const docBits: string[] = [];
      if (field.label) docBits.push(field.label);
      if (field.description) docBits.push(field.description);
      lines.push(`  /** ${docBits.join(' — ')} */`);
    }
    lines.push(`  ${tsPropertyKey(field.name)}${optionalMark}: ${expr};`);
  }

  lines.push(`}`);
  lines.push(``);

  // App key + Schema type. NO dynamic-query execute fn — reads go through
  // saved queries (the create_saved_query tool), never POST /query/{entity}.
  //   - <ENTITY>_APP_KEY: exported so the agent can resolve the entity's app
  //     when creating a saved query (and so noUnusedLocals stays happy).
  //   - <Entity>Schema: the snake_case body-key mapping; consumed by
  //     useEntityMutation's `data` typing.
  const constPrefix = entityConstName(entity.name);
  const schemaTypeName = `${interfaceName}Schema`;
  const appKeyConst = `${constPrefix}_APP_KEY`;
  lines.push(`export const ${appKeyConst} = ${JSON.stringify(entity.app_definition_key ?? '')};`);
  lines.push(``);
  lines.push(`export type ${schemaTypeName} = { '${entity.name}': ${interfaceName} };`);
  lines.push(``);

  // Field-level validation metadata (required + constraints) for form building.
  lines.push(...renderFieldConstraints(entity));

  return lines.join('\n');
}

function renderBarrelFile(
  entities: Entity[],
  collidedNames: ReadonlySet<string>,
): string {
  const lines: string[] = [];
  lines.push(`// AUTO-GENERATED by scripts/fetch-entities.ts - do not edit by hand.`);
  lines.push(``);
  const sorted = [...entities].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.app_definition_key ?? '').localeCompare(b.app_definition_key ?? ''),
  );
  for (const e of sorted) {
    const className = entityClassName(e.name);
    const appDir = appKeyDir(e.app_definition_key ?? '');
    const path = `./${appDir}/${entityFileStem(e.name)}`;
    if (collidedNames.has(e.name)) {
      // Same name in 2+ apps — alias the re-export so identifiers stay unique.
      const prefix = entityClassName(appDir);
      lines.push(
        `export type { ${className} as ${prefix}_${className}, ${className}Schema as ${prefix}_${className}Schema } from '${path}';`,
      );
    } else {
      lines.push(`export type { ${className}, ${className}Schema } from '${path}';`);
    }
  }
  lines.push(``);
  return lines.join('\n');
}

// =============================================================================
// entities.generated.ts emitter
// =============================================================================

function renderEntitiesGeneratedFile(
  entities: Entity[],
  collidedNames: ReadonlySet<string>,
): string {
  const lines: string[] = [];
  lines.push(`/* eslint-disable */`);
  lines.push(`// AUTO-GENERATED by scripts/fetch-entities.ts - do not edit by hand.`);
  lines.push(`// Source: Phoenix /api/internal/component-definitions-all/entity`);
  lines.push(`// Regenerated on every workspace bootstrap; in sync with src/types/entities/**.`);
  lines.push(``);

  // EntityName union. Names that collide across apps are app-qualified
  // (`<appKeyDir>/<name>`); unique names stay bare.
  const namesUnion = entities
    .map((e) => JSON.stringify(entityRegistryKey(e, collidedNames)))
    .join(' | ');
  lines.push(`// All known entity names (typed union).`);
  lines.push(`export type EntityName = ${namesUnion};`);
  lines.push(``);

  // Per-entity FieldName unions
  for (const e of entities) {
    const cls = entityRegistryClass(e, collidedNames);
    const fieldNames = dedupeFieldsByName(e.fields).map((f) => f.name);
    lines.push(`/** Fields on entity \`${entityRegistryKey(e, collidedNames)}\` (${e.label}). */`);
    lines.push(`export type ${cls}FieldName =`);
    for (let i = 0; i < fieldNames.length; i++) {
      const suffix = i === fieldNames.length - 1 ? ';' : '';
      lines.push(`  | ${JSON.stringify(fieldNames[i])}${suffix}`);
    }
    lines.push(``);
  }

  // EntitySchema interface
  lines.push(`/**`);
  lines.push(` * Master entity registry consumed by useEntityMutation (+ saved-query / DynQL typing).`);
  lines.push(` * fields:  union of valid field names (used to constrain select/where/data).`);
  lines.push(` * appKey:  app_definition_key the data API expects.`);
  lines.push(` * links:   map of link-field-name -> target entity (for nested selects).`);
  lines.push(` */`);
  lines.push(`export interface EntitySchema {`);
  for (const e of entities) {
    const cls = entityRegistryClass(e, collidedNames);
    const links = dedupeFieldsByName(e.fields).filter(
      (f) => f.type === 'Link' || f.type === 'Backlink',
    );
    lines.push(`  ${JSON.stringify(entityRegistryKey(e, collidedNames))}: {`);
    lines.push(`    fields: ${cls}FieldName;`);
    lines.push(`    appKey: ${JSON.stringify(e.app_definition_key ?? '')};`);
    if (links.length > 0) {
      lines.push(`    links: {`);
      for (const l of links) {
        const target = l.type === 'Link' ? l.linkTarget : l.backlinkSourceEntity;
        if (!target) continue;
        lines.push(
          `      ${JSON.stringify(l.name)}: { target: ${JSON.stringify(target)}; cardinality: ${JSON.stringify(
            l.cardinality ?? 'oneToOne',
          )}; kind: ${JSON.stringify(l.type)} };`,
        );
      }
      lines.push(`    };`);
    } else {
      lines.push(`    links: {};`);
    }
    lines.push(`  };`);
  }
  lines.push(`}`);
  lines.push(``);

  // Helper types
  lines.push(`/** Valid field names on a given entity. */`);
  lines.push(`export type FieldOf<E extends EntityName> = EntitySchema[E]['fields'];`);
  lines.push(``);
  lines.push(`/** Names of Link/Backlink fields on a given entity. */`);
  lines.push(`export type LinkOf<E extends EntityName> = keyof EntitySchema[E]['links'] & string;`);
  lines.push(``);
  lines.push(`/** App-definition-key constant for a given entity. */`);
  lines.push(`export type AppKeyOf<E extends EntityName> = EntitySchema[E]['appKey'];`);
  lines.push(``);
  lines.push(`/** Shape of \`select\` argument when authoring a saved-query DynQL body. */`);
  lines.push(`export type SelectFor<E extends EntityName> = Partial<{`);
  lines.push(`  [K in FieldOf<E>]:`);
  lines.push(`    | boolean`);
  lines.push(`    | (K extends LinkOf<E>`);
  lines.push(`        ? {`);
  lines.push(`            select?: Partial<Record<string, unknown>>;`);
  lines.push(`            where?: Record<string, unknown>;`);
  lines.push(`            limit?: number;`);
  lines.push(`            offset?: number;`);
  lines.push(`          }`);
  lines.push(`        : never);`);
  lines.push(`}>;`);
  lines.push(``);
  lines.push(`/** Comparison conditions allowed inside a \`where\` clause. */`);
  lines.push(`export interface WhereCondition {`);
  lines.push(`  equals?: unknown;`);
  lines.push(`  not?: unknown;`);
  lines.push(`  in?: readonly unknown[];`);
  lines.push(`  gt?: unknown;`);
  lines.push(`  gte?: unknown;`);
  lines.push(`  lt?: unknown;`);
  lines.push(`  lte?: unknown;`);
  lines.push(`  contains?: string;`);
  lines.push(`  startsWith?: string;`);
  lines.push(`  endsWith?: string;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`/** Shape of \`where\` argument. Keys constrained to known field names. */`);
  lines.push(`export type WhereFor<E extends EntityName> = Partial<Record<FieldOf<E>, WhereCondition>>;`);
  lines.push(``);
  lines.push(`/** Shape of \`data\` argument for create/update. */`);
  lines.push(`export type DataFor<E extends EntityName> = Partial<Record<FieldOf<E>, unknown>>;`);
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
function listTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFilesRecursive(full));
    else if (ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// =============================================================================
// API call
// =============================================================================

async function fetchEntities(apiUrl: string, tenant: string): Promise<Entity[]> {
  const base = apiUrl.replace(/\/+$/, '');
  const url = phoenixUrl(`${base}/api/internal/component-definitions-all/entity`);
  const gateway = usingGatewayAuth();

  // Diagnostic: show the ACTUAL request (the path differs from the literal
  // when gateway-auth strips `/internal`), and whether bearer auth is on.
  console.log(
    `fetch-entities: GET ${url}  (tenant=${tenant}, ` +
      `mode=${gateway ? 'gateway+bearer' : 'internal/header-only'})`,
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
  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected response shape from ${url}: expected an array, got ${typeof data}`,
    );
  }

  // Diagnostic: break the returned entities down by app_definition_key. If this
  // shows ONLY `platform` (no wealthdomain/servicing/etc.), the gateway is
  // RBAC-scoping the result to the authenticated user's apps — i.e. the login
  // user isn't a member of those apps in this tenant (or they live elsewhere),
  // NOT a codegen bug. The internal endpoint returns the full tenant set.
  const byApp = new Map<string, number>();
  for (const e of data as Array<{ app_definition_key?: string }>) {
    const k = e.app_definition_key ?? '(none)';
    byApp.set(k, (byApp.get(k) ?? 0) + 1);
  }
  const breakdown = [...byApp.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(', ');
  console.log(
    `fetch-entities: received ${data.length} entit${data.length === 1 ? 'y' : 'ies'} ` +
      `across ${byApp.size} app(s): ${breakdown}`,
  );
  if (gateway && byApp.size <= 1 && byApp.has('platform')) {
    console.log(
      `fetch-entities: ⚠️  ONLY platform entities returned via the gateway. ` +
        `This means the authenticated user can't see app-specific apps in tenant ` +
        `'${tenant}' (wrong tenant, or no membership in the target/dependency apps). ` +
        `The internal endpoint would return the full set; the public gateway is user-scoped.`,
    );
  }

  return data as Entity[];
}

// =============================================================================
// Main
// =============================================================================

interface RunOptions {
  envPath: string;
  outDir: string;
  /**
   * Sibling directory containing per-enum modules from
   * `scripts/fetch-enumerations.ts`. Defaults to `<outDir>/../enumerations`.
   * When omitted or empty, `Enumeration` fields fall back to `string`.
   */
  enumDir?: string;
}

/**
 * Scan the enumeration outDir for per-enum modules (excluding the barrel)
 * to build a set of available enum names. Each `.ts` filename stem IS
 * the enum name (per `fetch-enumerations.ts`'s `enumFileStem`).
 */
function discoverEnumerationNames(enumDir: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(enumDir)) return out;
  for (const ent of readdirSync(enumDir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      // Recurse into per-app-key subfolders (enumerations/<appKeyDir>/<stem>.ts).
      for (const name of discoverEnumerationNames(resolve(enumDir, ent.name))) {
        out.add(name);
      }
      continue;
    }
    if (!ent.name.endsWith('.ts')) continue;
    if (ent.name === 'index.ts') continue;
    out.add(ent.name.slice(0, -'.ts'.length));
  }
  return out;
}

async function run(opts: RunOptions): Promise<void> {
  loadDotEnv(opts.envPath);

  const apiUrl = process.env.PHOENIX_API_URL?.trim();
  const tenant = process.env.TENANT_ID?.trim();

  if (!apiUrl || !tenant) {
    const missing = !apiUrl && !tenant ? 'PHOENIX_API_URL and TENANT_ID' : !apiUrl ? 'PHOENIX_API_URL' : 'TENANT_ID';
    console.log(
      `fetch-entities: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:entities\` to populate ` +
        `src/types/entities/ with live tenant data.`,
    );
    return;
  }

  const entities = await fetchEntities(apiUrl, tenant);

  const valid = entities.filter(
    (e): e is Entity => !!e && typeof e.name === 'string' && Array.isArray(e.fields),
  );
  // Surface cross-app name collisions instead of silently dropping them.
  const collisionWarning = formatCollisionWarning(
    'entity',
    detectNameCollisions(
      valid.map((e) => ({ name: e.name, appKey: e.app_definition_key ?? '' })),
    ),
  );
  if (collisionWarning) console.warn(collisionWarning);

  // Dedupe by (appKey, name) — keep BOTH when the same name exists in
  // different apps (previously the second was silently dropped first-wins,
  // and would have overwritten the first's file).
  const byKey = new Map<string, Entity>();
  for (const e of valid) {
    const k = `${e.app_definition_key ?? ''}\u0000${e.name}`;
    if (!byKey.has(k)) byKey.set(k, e);
  }
  const sorted = [...byKey.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.app_definition_key ?? '').localeCompare(b.app_definition_key ?? ''),
  );
  const knownNames = new Set(sorted.map((e) => e.name));

  // name -> set of apps declaring it. Used for cross-app Link target
  // resolution (resolveTargetAppDir).
  const entityAppKeys = new Map<string, Set<string>>();
  for (const e of sorted) {
    let s = entityAppKeys.get(e.name);
    if (!s) {
      s = new Set<string>();
      entityAppKeys.set(e.name, s);
    }
    s.add(e.app_definition_key ?? '');
  }

  // Collided = entities whose emitted PascalCase identifier is shared by 2+
  // entities (cross-app same-name OR distinct names that normalise to the same
  // identifier, e.g. `entity_1`/`entity1` -> `Entity1`). These get app-prefixed
  // aliases + registry keys; the per-app folder already keeps their files apart.
  const collidedNames = computeCollidedEntityNames(sorted);

  // Discover available enumeration names from the sibling enumerations/
  // directory (written earlier by fetch-enumerations.ts). When empty,
  // Enumeration-typed fields fall back to `string`.
  const enumDir = opts.enumDir ?? resolve(opts.outDir, '../enumerations');
  const knownEnumerationNames = discoverEnumerationNames(enumDir);
  if (knownEnumerationNames.size > 0) {
    console.log(
      `fetch-entities: resolved ${knownEnumerationNames.size} enumerations from ${enumDir}`,
    );
  }

  mkdirSync(opts.outDir, { recursive: true });

  const generatedFiles = new Set<string>();
  let written = 0;
  let unchanged = 0;
  for (const e of sorted) {
    // Each entity is written under its app-definition-key folder so two apps
    // declaring the same entity name never overwrite each other.
    const appDir = appKeyDir(e.app_definition_key ?? '');
    const filePath = resolve(opts.outDir, appDir, `${entityFileStem(e.name)}.ts`);
    generatedFiles.add(filePath);
    const source = renderEntityFile(
      e,
      knownNames,
      knownEnumerationNames,
      entityAppKeys,
    );
    if (writeIfChanged(filePath, source)) written++;
    else unchanged++;
  }

  // Barrel
  const barrelPath = resolve(opts.outDir, 'index.ts');
  generatedFiles.add(barrelPath);
  if (writeIfChanged(barrelPath, renderBarrelFile(sorted, collidedNames)))
    written++;
  else unchanged++;

  // Consolidated entities.generated.ts used by the data hooks
  const generatedTypesPath = resolve(opts.outDir, '../entities.generated.ts');
  const generatedTypesContents = renderEntitiesGeneratedFile(
    sorted,
    collidedNames,
  );
  if (writeIfChanged(generatedTypesPath, generatedTypesContents)) {
    written++;
    console.log(`fetch-entities: also wrote ${generatedTypesPath}`);
  } else {
    unchanged++;
  }

  // Prune stale .ts files recursively (removes old flat-layout files from a
  // previous run + any per-app file no longer produced).
  let removed = 0;
  for (const full of listTsFilesRecursive(opts.outDir)) {
    if (!generatedFiles.has(full)) {
      unlinkSync(full);
      removed++;
    }
  }

  console.log(
    `fetch-entities: ${sorted.length} entities → ${opts.outDir} ` +
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
  const outDir = process.env.FETCH_ENTITIES_OUT_DIR
    ? resolve(process.env.FETCH_ENTITIES_OUT_DIR)
    : resolve(root, 'src/types/entities');
  run({
    envPath: resolve(root, '.env'),
    outDir,
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
