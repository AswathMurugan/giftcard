// =============================================================================
// Enumerations
// =============================================================================

export type EntityType =
  | "regular"
  | "referenceData"
  | "audit"
  | "enumeration"
  | "messages"
  | "aggregate"
  | "view";

export type EntityTarget = "transactional" | "warehouse";

export type ViewQueryType = "sql" | "dynamic";

export type BusinessType =
  // Numeric
  | "Autonumber"
  | "Decimal"
  | "Integer"
  | "Float"
  | "Currency"
  | "Percent"
  // String
  | "Text"
  | "Multilinetext"
  | "Email"
  | "Phonenumber"
  | "SSN"
  | "URL"
  | "File"
  | "Seal"
  | "Signature"
  | "Enumeration"
  // Date
  | "Date"
  | "Datetime"
  | "Duration"
  // Link
  | "Link"
  | "Backlink"
  // Other
  | "Checkbox"
  | "Json"
  | "UUID"
  | "Computed"
  | "Ltree";

export type CardinalityType =
  | "oneToOne"
  | "oneToMany"
  | "manyToOne"
  | "manyToMany";

export type SourceDeletionPolicy =
  | "allow"
  | "deleteTarget"
  | "deleteTargetIfOrphan";

export type TargetDeletionPolicy =
  | "restrict"
  | "deleteSource"
  | "allow"
  | "deferredRestrict";

export type ConstraintType =
  | "minValue"
  | "maxValue"
  | "minLength"
  | "maxLength"
  | "regex"
  | "oneOf"
  | "precision"
  | "scale"
  | "expression";

export type IndexType =
  | "primary"
  | "unique"
  | "regular"
  | "fulltext"
  | "trgmGin"
  | "gist";

export type AccessControlEffect = "allow" | "deny";

export type SortOrder = "asc" | "desc";

// =============================================================================
// Core Entity Structures
// =============================================================================

export interface EntityDefinition {
  entities: Entity[];
}

export interface Entity {
  entityId: string;
  label: string;
  name: string;
  description?: string;
  entityType?: EntityType;
  features?: Feature;
  fields: Field[];
  indexes?: Index[];
  accessControl?: AccessControl;
  audit?: AuditConfig;
  target?: EntityTarget[];
  targetResolution?: TargetResolution;
  viewConfig?: ViewConfig;
  attributes?: EntityAttribute[];
  /**
   * App-definition key the data API expects in the `appDefinitionKey`
   * argument of useEntityMutation (and as the `appKey` for create_saved_query).
   * Returned
   * by the `/api/internal/component-definitions-all/entity` endpoint;
   * preserved verbatim in the generated EntitySchema.
   */
  app_definition_key?: string;
}

export interface TargetResolution {
  /** Field to evaluate (e.g. "created_at") */
  field: string;
  /** Comparison operator (e.g. ">=") */
  operator: string;
  /** ISO 8601 duration threshold (e.g. "P2M" for 2 months, "P30D" for 30 days) */
  duration: string;
}

export interface EntityAttribute {
  name: string;
  label?: string;
  type: string;
  attributeType?: string;
  required?: boolean;
  description?: string | null;
  component_reference?: string | null;
  maximum?: number | null;
  minimum?: number | null;
  maxLength?: number | null;
  minLength?: number | null;
  pattern?: string | null;
  attributes?: EntityAttribute[] | null;
}

export interface Feature {
  audit?: boolean;
  changeTracking?: boolean;
  bulkLoad?: boolean;
  /** @deprecated Use Entity.target instead */
  warehouse?: boolean;
}

export interface ViewQueryEntry {
  target: EntityTarget;
  type: ViewQueryType;
  query: string;
}

export interface ViewConfig {
  baseEntity: string;
  baseQuery: ViewQueryEntry[];
}

// =============================================================================
// Field Structures
// =============================================================================

export interface Field {
  fieldId: string;
  label: string;
  name: string;
  description?: string;
  type: BusinessType;
  isArray?: boolean;
  required?: boolean;
  readonly?: boolean;
  default?: string;
  enumType?: string;
  constraints?: Partial<Record<ConstraintType, Constraint>>;
  computedExpression?: Expression;
  masking?: MaskingRule;
  linkTarget?: string;
  backlinkSourceEntity?: string;
  backlinkSourceField?: string;
  cardinality?: CardinalityType;
  targetAppName?: string;
  backLinkEnabled?: boolean;
  sourceDeletionPolicy?: SourceDeletionPolicy;
  targetDeletionPolicy?: TargetDeletionPolicy;
}

export interface MaskingRule {
  pattern: string;
  replacement?: string;
  overridePermission?: string;
}

// =============================================================================
// Field Constraints
// =============================================================================

export interface Constraint {
  value?: string;
  allowedValues?: string[];
  message?: string;
}

// =============================================================================
// Index Structures
// =============================================================================

export interface Index {
  name?: string;
  fields: string[];
  indexType: IndexType;
}

// =============================================================================
// Access Control Structures
// =============================================================================

export interface AccessControl {
  effect?: AccessControlEffect;
  rule?: Rule;
  useSharingAccessKeys?: boolean;
}

export interface Rule {
  name?: string;
  applyWhen?: Expression;
  allOf?: Rule[];
  anyOf?: Rule[];
  requirement?: Requirement;
}

export interface Requirement {
  field: string;
  operator: string;
  value?: string;
  arguments?: Record<string, unknown>;
}

// =============================================================================
// Expression & Computed Fields
// =============================================================================

export interface Expression {
  title?: string;
  text?: string;
  returnType?: string;
  variables?: string[];
  functions?: string[];
}

// =============================================================================
// Audit & Features
// =============================================================================

export interface AuditConfig {
  auditEntity?: string;
  auditedEntity?: string;
}

// =============================================================================
// Ordering & Sorting
// =============================================================================

export interface OrderBy {
  fieldName?: string;
  order?: SortOrder;
}

// =============================================================================
// Server-Only Structures
// =============================================================================

export interface JunctionTable {
  name: string;
  fieldName: string;
  sourceEntity: string;
  targetEntity: string;
  sourceField: string;
  targetField: string;
  isExclusive: boolean;
  targetAppName?: string;
  isArrayTable: boolean;
  valueColumn: string;
  valueType: string;
}
