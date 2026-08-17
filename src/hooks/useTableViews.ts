/**
 * useTableViews — shared + per-user saved VIEWS for a DataTable, persisted via
 * the platform Preferences API (PHXSR-106, PHXSR-208). A "view" is a named
 * preset of grid state (column order/width/visibility/pinned + sort + column
 * filters). Organization views are selectable/read-only; users can create,
 * update, rename, and delete their own views.
 *
 * Storage:
 *   shared → `App.Screen.<page>.<componentId>` from the app's merged prefs
 *   user   → ONE `User.Datatable.<page>.<componentId>` record per table/user
 * Both use `type: 'table_preference'` and a JSON-string array of views.
 *
 *   read   → GET  /api/preferences?name_prefix=User.Datatable.<page>.&user_id=<id>
 *   create → POST /api/preferences            (first save; server assigns id)
 *   update → PUT  /api/preferences/{id}        (subsequent saves/rename/delete)
 *
 * Deleting a VIEW just PUTs the record with that view removed from the array —
 * there is no per-view endpoint. Pair with the DataTable's `onGridReady` (to
 * read `api.getColumnState()`/`getFilterModel()` on save) and `initialState` /
 * `applyColumnState`+`setFilterModel` (to restore).
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiManager } from '@/services/api-manager';
import { getAppConfig } from '@/config/api-config';
import { getAuthService } from '@/config/auth-service-manager';
import { usePreferences } from '@/queries/use-preferences';
import {
  tableViewsPrefName,
  tableViewsPrefPrefix,
  sharedTableViewsPrefName,
  findTableViewPreference,
  parseViews,
  serializeViews,
  mergeTableViews,
  editableUserViewId,
  addView,
  updateViewState,
  renameView as renameInArray,
  deleteView as deleteInArray,
  type TableView,
  type ScopedTableView,
  type GridViewState,
} from './table-views-helpers';

const PREF_SERVICE = 'proxy';
const PREF_BASE = '/api/preferences';

/** The preference record shape (subset we read/write). */
interface PreferenceRecord {
  id?: string;
  name: string;
  category: string;
  component_id: string;
  type: string;
  preference_target: string;
  user?: { id: string } | null;
  value: string;
  app_definition_key?: string;
  app_definition?: string;
  disabled?: boolean;
  draft?: boolean;
}

function prefHeaders(): Record<string, string> {
  const c = getAppConfig();
  return { 'X-Jiffy-App-Name': c.appName, 'X-Jiffy-Tenant': c.tenant };
}

export interface UseTableViewsResult {
  /** Shared views first, then personal views. Shared views are read-only. */
  views: ScopedTableView[];
  loading: boolean;
  /** True while a save/rename/delete write is in flight. */
  saving: boolean;
  /** Create a new view from captured grid state; resolves to the new view. */
  saveNewView: (name: string, state: GridViewState) => Promise<ScopedTableView | null>;
  /** Overwrite an existing view's grid state — "Save Changes to View". */
  updateView: (runtimeId: string, state: GridViewState) => Promise<void>;
  /** Rename an editable personal view by runtime id. */
  renameView: (runtimeId: string, name: string) => Promise<void>;
  /** Delete an editable personal view by runtime id. */
  deleteView: (runtimeId: string) => Promise<void>;
  /** Re-read both shared and personal preference records. */
  refresh: () => void;
}

export function useTableViews(page: string, componentId: string): UseTableViewsResult {
  const userId = getAuthService().getJiffyUserId() ?? '';
  const name = tableViewsPrefName(page, componentId);
  const sharedName = sharedTableViewsPrefName(page, componentId);
  const [saving, setSaving] = useState(false);
  const sharedPreferences = usePreferences();

  const query = useQuery({
    queryKey: ['table-views', page, componentId, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<{ record: PreferenceRecord | null; views: TableView[] }> => {
      const res = await apiManager.get(
        PREF_SERVICE,
        `${PREF_BASE}?name_prefix=${encodeURIComponent(tableViewsPrefPrefix(page))}&user_id=${encodeURIComponent(userId)}`,
        prefHeaders(),
      );
      const list = Array.isArray(res.data) ? (res.data as PreferenceRecord[]) : [];
      const record = findTableViewPreference(list, name) ?? null;
      return { record, views: record ? parseViews(record.value) : [] };
    },
  });

  const record = query.data?.record ?? null;
  const userViews = useMemo(() => query.data?.views ?? [], [query.data]);
  const sharedViews = useMemo(() => {
    const sharedRecord = findTableViewPreference(sharedPreferences.data, sharedName);
    return sharedRecord ? parseViews(sharedRecord.value) : [];
  }, [sharedPreferences.data, sharedName]);
  const views = useMemo(() => mergeTableViews(sharedViews, userViews), [sharedViews, userViews]);

  const persist = useCallback(
    async (nextViews: TableView[]): Promise<void> => {
      if (!userId) return;
      const c = getAppConfig();
      const body: PreferenceRecord = {
        ...(record ?? {}),
        name,
        category: name,
        component_id: componentId,
        type: 'table_preference',
        preference_target: 'user',
        user: { id: userId },
        app_definition_key: record?.app_definition_key ?? c.appDefinitionKey,
        app_definition: record?.app_definition ?? c.appDefinition,
        disabled: false,
        draft: false,
        value: serializeViews(nextViews),
      };
      setSaving(true);
      try {
        if (record?.id) {
          await apiManager.put(
            PREF_SERVICE,
            `${PREF_BASE}/${encodeURIComponent(record.id)}`,
            body,
            prefHeaders(),
          );
        } else {
          await apiManager.post(PREF_SERVICE, PREF_BASE, body, prefHeaders());
        }
        await query.refetch();
      } finally {
        setSaving(false);
      }
    },
    [record, name, componentId, userId, query],
  );

  const saveNewView = useCallback(
    async (viewName: string, state: GridViewState): Promise<ScopedTableView | null> => {
      const next = addView(userViews, viewName, state);
      await persist(next);
      const created = next[next.length - 1];
      return created ? mergeTableViews([], [created])[0] : null;
    },
    [userViews, persist],
  );

  const editableId = useCallback(
    (runtimeId: string): number => {
      const id = editableUserViewId(userViews, runtimeId);
      if (id === undefined) {
        throw new Error('Organization table views are read-only');
      }
      return id;
    },
    [userViews],
  );

  const updateView = useCallback(
    async (runtimeId: string, state: GridViewState): Promise<void> => {
      await persist(updateViewState(userViews, editableId(runtimeId), state));
    },
    [userViews, editableId, persist],
  );

  const renameView = useCallback(
    async (runtimeId: string, viewName: string): Promise<void> => {
      await persist(renameInArray(userViews, editableId(runtimeId), viewName));
    },
    [userViews, editableId, persist],
  );

  const deleteView = useCallback(
    async (runtimeId: string): Promise<void> => {
      await persist(deleteInArray(userViews, editableId(runtimeId)));
    },
    [userViews, editableId, persist],
  );

  const refresh = useCallback(() => {
    void Promise.all([query.refetch(), sharedPreferences.refetch()]);
  }, [query, sharedPreferences]);

  return {
    views,
    loading: query.isLoading || sharedPreferences.isLoading,
    saving,
    saveNewView,
    updateView,
    renameView,
    deleteView,
    refresh,
  };
}
