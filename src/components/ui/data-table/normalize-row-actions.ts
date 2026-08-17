/**
 * Row-action helpers for the DataTable's opt-in actions column.
 *
 * A `RowAction` describes one entry in the per-row kebab (⋮) menu — View /
 * Edit / Delete and friends. The DataTable renders a standardized, pinned-right
 * actions column (`RowActionsCell`) so every table gets identical button size,
 * alignment, and row height; pages only describe WHAT the actions are, never
 * how the cell is laid out.
 *
 * These helpers are pure so they can be unit-tested without a DOM.
 */

/** A single entry in a row's actions (⋮) menu. */
export interface RowAction<TData = unknown> {
  /** Menu item label, e.g. "Edit". */
  label: string;
  /** Optional Nucleo glyph class, e.g. `'icon_-Tb_pencil'`. */
  icon?: string;
  /** Fired when the item is chosen. The page owns any confirm (e.g. an
   *  AlertDialog before a destructive mutation). */
  onSelect: (row: TData) => void;
  /** `'destructive'` renders the DS red menu item (e.g. Delete). */
  variant?: 'default' | 'destructive';
  /** Disable the item — boolean, or a predicate evaluated per row. */
  disabled?: boolean | ((row: TData) => boolean);
  /** Hide the item entirely for a given row. */
  hidden?: (row: TData) => boolean;
}

/**
 * Source shape callers pass to the DataTable: either one static list applied
 * to every row, or a function that returns the list for a specific row.
 */
export type RowActionsSource<TData = unknown> =
  | RowAction<TData>[]
  | ((row: TData) => RowAction<TData>[]);

/** A `RowAction` with its per-row `disabled` predicate already resolved. */
export interface ResolvedRowAction<TData = unknown> {
  label: string;
  icon?: string;
  onSelect: (row: TData) => void;
  variant: 'default' | 'destructive';
  disabled: boolean;
}

/**
 * Resolve the menu items to show for one row: pick the right source (array vs
 * per-row function), drop `hidden` items, and collapse each `disabled`
 * (boolean | predicate) into a concrete boolean.
 *
 * Returns `[]` for a nullish source or row, so a cell renderer can safely
 * render nothing.
 */
export function resolveRowActions<TData>(
  source: RowActionsSource<TData> | undefined | null,
  row: TData | undefined | null,
): ResolvedRowAction<TData>[] {
  if (source == null || row == null) return [];

  const list = typeof source === 'function' ? source(row) : source;
  if (!Array.isArray(list)) return [];

  const out: ResolvedRowAction<TData>[] = [];
  for (const action of list) {
    if (!action) continue;
    if (typeof action.hidden === 'function' && action.hidden(row)) continue;

    const disabled =
      typeof action.disabled === 'function'
        ? action.disabled(row)
        : Boolean(action.disabled);

    out.push({
      label: action.label,
      icon: action.icon,
      onSelect: action.onSelect,
      variant: action.variant ?? 'default',
      disabled,
    });
  }
  return out;
}
