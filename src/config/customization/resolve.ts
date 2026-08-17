/**
 * Pure resolution logic (no React) — extracted so it can be unit-tested
 * directly in the node vitest environment.
 *
 * Two concerns:
 *   1. resolveComponentConfig — merge code defaults + server preference
 *      override into a ComponentConfig for a `Cfg*` component.
 *   2. applyColumnOverrides — merge admin column-prop overrides onto a set
 *      of AG Grid column definitions, keyed by each column's field/colId.
 */
import type { ComponentConfig, ComponentType } from './types';
import { COMPONENT_DEFAULTS } from './defaults';
import { pickStyle } from './preference-index';

/**
 * Property names that map to typed ComponentConfig fields (non-style).
 * Everything else is treated as a candidate inline-style property.
 */
const BOOLEAN_PROPS = new Set(['required', 'visible', 'disabled']);
const STRING_PROPS = new Set([
  'label',
  'placeholder',
  'helpText',
  'variant',
  'className',
]);

function coerceBool(v: string): boolean {
  return v === 'true' || v === '1';
}

/**
 * Merge code defaults with a server-resolved override map into a final
 * ComponentConfig. The override always wins. Style properties are filtered
 * to the allow-list; unknown keys are ignored.
 *
 * @param type     Component type (drives defaults).
 * @param override Raw `{ property: value }` map from the preference index
 *                 for this component's address, or undefined when none.
 */
export function resolveComponentConfig(
  type: ComponentType,
  override: Record<string, string> | undefined,
): ComponentConfig {
  const config: ComponentConfig = { type, ...COMPONENT_DEFAULTS[type] };
  if (!override) return config;

  const writable = config as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (BOOLEAN_PROPS.has(key)) {
      writable[key] = coerceBool(value);
    } else if (STRING_PROPS.has(key)) {
      writable[key] = value;
    }
    // style properties handled below in one pass
  }

  const style = pickStyle(override);
  if (style) config.style = style;

  return config;
}

/**
 * Minimal shape of an AG Grid column def we read/merge here.
 *
 * No index signature — that would make AG Grid's `ColDef` (which has none)
 * fail to satisfy `T extends ColumnLike`. We only need to read field/colId;
 * merging is done over a local `Record<string, unknown>` copy.
 */
export interface ColumnLike {
  field?: string;
  colId?: string;
}

/** Column-def keys an admin override must never replace (safety). */
const BLOCKED_COLUMN_KEYS = new Set([
  'field',
  'colId',
  'valueGetter',
  'valueSetter',
  'cellRenderer',
  'cellRendererSelector',
  'comparator',
  'onCellClicked',
  'onCellValueChanged',
]);

const NUMERIC_COLUMN_KEYS = new Set([
  'width',
  'minWidth',
  'maxWidth',
  'flex',
  'rowSpan',
  'colSpan',
]);
const BOOLEAN_COLUMN_KEYS = new Set(['hide', 'sortable', 'resizable', 'editable']);

/**
 * Apply admin column-prop overrides to a list of column defs.
 *
 * Each column is matched by its `colId` (preferred) or `field`. Overrides
 * are coerced to the right primitive type. Blocked keys (value getters,
 * renderers, identity) are never replaced.
 *
 * @param columns Base column defs (agent-authored).
 * @param byCol   `{ [colId]: { [prop]: value } }` from the preference index.
 */
export function applyColumnOverrides<T extends ColumnLike>(
  columns: T[],
  byCol: Record<string, Record<string, string>> | undefined,
): T[] {
  if (!byCol || Object.keys(byCol).length === 0) return columns;

  return columns.map((col) => {
    const key = col.colId ?? col.field;
    const overrides = key ? byCol[key] : undefined;
    if (!overrides) return col;

    const merged = { ...col } as Record<string, unknown>;
    for (const [prop, value] of Object.entries(overrides)) {
      if (BLOCKED_COLUMN_KEYS.has(prop)) continue;
      if (NUMERIC_COLUMN_KEYS.has(prop)) {
        const n = Number(value);
        if (Number.isFinite(n)) merged[prop] = n;
      } else if (BOOLEAN_COLUMN_KEYS.has(prop)) {
        merged[prop] = value === 'true' || value === '1';
      } else if (prop === 'pinned') {
        merged[prop] =
          value === 'true' ? true : value === 'false' ? false : value;
      } else {
        // headerName, headerClass, cellClass, tooltipField, type, etc.
        merged[prop] = value;
      }
    }
    return merged as T;
  });
}
