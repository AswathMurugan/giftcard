// Pure, DOM-free helpers for DataTable saved views (node-testable).
// PHXSR-106, PHXSR-208.
//
// Shared views are read from `App.Screen.<page>.<componentId>` and personal
// views persist as ONE `User.Datatable.<page>.<componentId>` record per user.
// Both records hold a JSON string containing an ARRAY of platform-shaped views:
//   { id, key: <display name>, value: { columnState, filterModel, sortModel,
//     selectedFilterName } }

/** The AG Grid state a view captures/restores. */
export interface GridViewState {
  /** `api.getColumnState()` — order, width, visibility, pinned, sort per column. */
  columnState: unknown[];
  /** `api.getFilterModel()` — active column filters. */
  filterModel: Record<string, unknown>;
  /** Sort model (also encoded in columnState; kept for parity with the platform). */
  sortModel: unknown[];
  /** Reserved platform field (name of a selected saved filter). */
  selectedFilterName?: string;
}

/** One saved view within the preference `value` array. */
export interface TableView {
  id: number;
  /** Display name (the platform stores the name under `key`). */
  key: string;
  value: GridViewState;
}

export type TableViewScope = 'organization' | 'user';

/** A stored view decorated with runtime-only ownership and editability. */
export interface ScopedTableView extends TableView {
  /** Composite identity prevents shared/user views with the same numeric id colliding. */
  runtimeId: string;
  scope: TableViewScope;
  readOnly: boolean;
}

/** Minimal API record shape needed to locate a table-preference value. */
export interface TableViewPreferenceRecord {
  name: string;
  type?: string | null;
  value: string;
  disabled?: boolean;
}

/** Preference name/category for a table's per-user views. */
export function tableViewsPrefName(page: string, componentId: string): string {
  return `User.Datatable.${page}.${componentId}`;
}

/** The `name_prefix` used to fetch a page's per-user table preferences. */
export function tableViewsPrefPrefix(page: string): string {
  return `User.Datatable.${page}.`;
}

/** Preference name for the organization-level shared views of a table. */
export function sharedTableViewsPrefName(page: string, componentId: string): string {
  return `App.Screen.${page}.${componentId}`;
}

/** Runtime identity for a view within one preference scope. */
export function tableViewRuntimeId(scope: TableViewScope, id: number): string {
  return `${scope}:${id}`;
}

/**
 * Select the effective exact-name table-preference record. The merged API
 * normally returns one record, but last-match-wins is deterministic if it does
 * not. Disabled and explicitly non-table records are ignored; a missing type
 * is accepted for legacy personal records created before the API returned it.
 */
export function findTableViewPreference<T extends TableViewPreferenceRecord>(
  records: readonly T[] | undefined,
  name: string
): T | undefined {
  let match: T | undefined;
  for (const record of records ?? []) {
    if (
      record.name === name &&
      (record.type == null || record.type === 'table_preference') &&
      !record.disabled
    ) {
      match = record;
    }
  }
  return match;
}

/** Parse the preference `value` (a JSON-string array) into views, defensively. */
export function parseViews(value: unknown): TableView[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  let arr: unknown;
  try {
    arr = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: TableView[] = [];
  const seenIds = new Set<number>();
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'number' ? r.id : Number(r.id);
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    if (!Number.isFinite(id) || !key || seenIds.has(id)) continue;
    seenIds.add(id);
    const v = (r.value && typeof r.value === 'object' ? r.value : {}) as Record<string, unknown>;
    out.push({
      id,
      key,
      value: {
        columnState: Array.isArray(v.columnState) ? v.columnState : [],
        filterModel:
          v.filterModel && typeof v.filterModel === 'object'
            ? (v.filterModel as Record<string, unknown>)
            : {},
        sortModel: Array.isArray(v.sortModel) ? v.sortModel : [],
        selectedFilterName: typeof v.selectedFilterName === 'string' ? v.selectedFilterName : '',
      },
    });
  }
  return out;
}

/** Serialize views back to the preference `value` string. */
export function serializeViews(views: TableView[]): string {
  return JSON.stringify(views.map(({ id, key, value }) => ({ id, key, value })));
}

/** Shared views first, then personal views, with collision-safe runtime ids. */
export function mergeTableViews(
  sharedViews: readonly TableView[],
  userViews: readonly TableView[]
): ScopedTableView[] {
  return [
    ...sharedViews.map((view) => ({
      ...view,
      runtimeId: tableViewRuntimeId('organization', view.id),
      scope: 'organization' as const,
      readOnly: true,
    })),
    ...userViews.map((view) => ({
      ...view,
      runtimeId: tableViewRuntimeId('user', view.id),
      scope: 'user' as const,
      readOnly: false,
    })),
  ];
}

/** Next numeric id for a new view (max existing + 1, starting at 1). */
export function nextViewId(views: TableView[]): number {
  return views.reduce((m, v) => Math.max(m, v.id), 0) + 1;
}

/** Add a new view with a unique id. Returns a NEW array (view appended). */
export function addView(views: TableView[], name: string, state: GridViewState): TableView[] {
  return [...views, { id: nextViewId(views), key: name.trim(), value: state }];
}

/** Replace a view's captured grid state by id — "Save Changes to View"
 *  (returns a NEW array). */
export function updateViewState(views: TableView[], id: number, state: GridViewState): TableView[] {
  return views.map((v) => (v.id === id ? { ...v, value: state } : v));
}

/** Rename a view by id (returns a NEW array). */
export function renameView(views: TableView[], id: number, name: string): TableView[] {
  const key = name.trim();
  return views.map((v) => (v.id === id ? { ...v, key } : v));
}

/** Delete a view by id (returns a NEW array). */
export function deleteView(views: TableView[], id: number): TableView[] {
  return views.filter((v) => v.id !== id);
}

/** Find a view by id (null id → undefined, i.e. the base view). */
export function findView(views: TableView[], id: number | null): TableView | undefined {
  return id == null ? undefined : views.find((v) => v.id === id);
}

/** Find a merged shared/personal view by its collision-safe runtime identity. */
export function findScopedView(
  views: readonly ScopedTableView[],
  runtimeId: string | null
): ScopedTableView | undefined {
  return runtimeId == null ? undefined : views.find((view) => view.runtimeId === runtimeId);
}

/** Resolve a runtime id to an editable personal view id. */
export function editableUserViewId(
  userViews: readonly TableView[],
  runtimeId: string
): number | undefined {
  return userViews.find((view) => tableViewRuntimeId('user', view.id) === runtimeId)?.id;
}

/**
 * Validate a view name: non-empty and not a case-insensitive duplicate of
 * another view's name. Pass `excludeId` when renaming (ignore the view itself).
 */
export function isValidViewName(views: TableView[], name: string, excludeId?: number): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return !views.some((v) => v.id !== excludeId && v.key.trim().toLowerCase() === n);
}

/** Validate a name across both scopes, excluding one exact runtime view. */
export function isValidScopedViewName(
  views: readonly ScopedTableView[],
  name: string,
  excludeRuntimeId?: string
): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return !views.some(
    (view) => view.runtimeId !== excludeRuntimeId && view.key.trim().toLowerCase() === normalized
  );
}
