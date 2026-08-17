/**
 * Type-safe TypeScript representation of the Go `DynamicQuery` shape defined in
 * `db/dynql/dynql_types.go`.
 *
 * Consumers pass their existing entity interfaces directly (no wrapper required).
 * Scalar vs. link fields are inferred automatically:
 *   - Primitive-typed fields (`string`, `number`, `boolean`, `bigint`, `Date`, ...)
 *     are scalar fields, allowed as `true` in `select`, in `groupBy`/`orderBy`,
 *     and as aggregate field references.
 *   - Object-typed fields and arrays of objects are link fields, allowed as
 *     `true` (auto-expand to id) or a nested `DynamicQueryOp<LinkedEntity>`.
 */

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type ScalarValue = Primitive | Date;

/** True when `T` (after unwrapping null/undefined and arrays) refers to another entity. */
export type IsLink<T> =
  NonNullable<T> extends ScalarValue
    ? false
    : NonNullable<T> extends Array<infer U>
      ? NonNullable<U> extends ScalarValue
        ? false
        : true
      : NonNullable<T> extends object
        ? true
        : false;

/** Keys of `E` whose values are linked entities (single or multi-valued). */
export type LinkKey<E> = {
  [K in keyof E]-?: IsLink<E[K]> extends true ? K : never;
}[keyof E] &
  string;

/** Keys of `E` whose values are scalar (primitive / Date). */
export type ScalarKey<E> = Exclude<keyof E & string, LinkKey<E>>;

/** Unwraps `T | T[]` to `T` for recursing into linked entities. */
export type LinkedEntity<T> =
  NonNullable<T> extends Array<infer U> ? NonNullable<U> : NonNullable<T>;

/** Supported aggregate functions. */
export type AggFn = 'sum' | 'avg' | 'min' | 'max' | 'count';

/**
 * Map-style aggregate value, e.g. `"${sum(balance)}"`.
 * The inner field reference must be a scalar key of `E`.
 */
export type AggExpr<E> = `\${${AggFn}(${ScalarKey<E>})}`;

/**
 * Order-by expression, e.g. `"name"`, `"asc(name)"`, `"desc(createdAt)"`.
 * Constrained to scalar keys of `E`.
 */
export type OrderByExpr<E> =
  | ScalarKey<E>
  | `${'asc' | 'desc'}(${ScalarKey<E>})`;

/**
 * Body of a `select` / `selectsingle` operation.
 *
 * Scalar fields take `true`; link fields take `true` (auto-expand) or a nested
 * `DynamicQueryOp` describing how to traverse the linked entity.
 */
export type SelectBody<E> = {
  [K in ScalarKey<E>]?: true;
} & {
  [K in LinkKey<E>]?: true | DynamicQueryOp<LinkedEntity<E[K]>>;
};

/** Array-style aggregate field (matches Go `AggregateField`). */
export interface AggregateField<E> {
  function: AggFn;
  field: ScalarKey<E>;
  alias: string;
}

/** Aggregate body: either map-style (`{alias: "${fn(field)}"}`) or array-style. */
export type AggregateBody<E> =
  | Record<string, AggExpr<E>>
  | AggregateField<E>[];

/**
 * Operation body for a single entity within a `DynamicQuery`.
 * Mirrors Go's `DynamicQueryOp` struct.
 */
export interface DynamicQueryOp<E> {
  select?: SelectBody<E>;
  selectsingle?: SelectBody<E>;
  insert?: Partial<E>;
  update?: Partial<E>;
  delete?: Record<string, never>;
  count?: Record<string, never>;
  distinct?: { [K in ScalarKey<E>]?: true };
  aggregate?: AggregateBody<E>;
  filter?: string | string[];
  orderBy?: OrderByExpr<E> | OrderByExpr<E>[];
  groupBy?: ScalarKey<E> | ScalarKey<E>[];
  join?: string;
  limit?: number;
  offset?: number;
}

/**
 * Top-level dynamic query keyed by entity name.
 *
 * `TSchema` is a record mapping entity name to its TypeScript interface, e.g.
 * `{ Account: Account; AccountAssetAllocation: AccountAssetAllocation }`.
 */
export type DynamicQuery<TSchema extends Record<string, object>> = {
  [K in keyof TSchema]?: DynamicQueryOp<TSchema[K]>;
};
