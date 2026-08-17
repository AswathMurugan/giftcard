import { describe, it, expect } from 'vitest';
import {
  tableViewsPrefName,
  tableViewsPrefPrefix,
  sharedTableViewsPrefName,
  tableViewRuntimeId,
  findTableViewPreference,
  parseViews,
  serializeViews,
  mergeTableViews,
  nextViewId,
  addView,
  updateViewState,
  renameView,
  deleteView,
  findView,
  findScopedView,
  editableUserViewId,
  isValidViewName,
  isValidScopedViewName,
  type TableView,
  type ScopedTableView,
  type GridViewState,
} from './table-views-helpers';

const STATE: GridViewState = {
  columnState: [{ colId: 'client_name', width: 246, hide: false, pinned: null, sort: null }],
  filterModel: {},
  sortModel: [],
  selectedFilterName: '',
};

const VIEWS: TableView[] = [
  { id: 1, key: 'Filter By ClientName', value: STATE },
  { id: 2, key: 'Active only', value: STATE },
];

describe('table-views-helpers', { tags: ['data-table', 'table-views', 'logic'] }, () => {
  describe('pref name', { tags: ['smoke'] }, () => {
    it('builds the per-user table preference name + prefix', () => {
      expect(tableViewsPrefName('clients', 'ClientTable2')).toBe('User.Datatable.clients.ClientTable2');
      expect(tableViewsPrefPrefix('clients')).toBe('User.Datatable.clients.');
    });

    it('builds the shared organization preference name', () => {
      expect(sharedTableViewsPrefName('accounts', 'datatable-2')).toBe(
        'App.Screen.accounts.datatable-2'
      );
    });
  });

  describe('findTableViewPreference', { tags: ['important'] }, () => {
    const name = 'App.Screen.accounts.datatable-2';

    it('selects the last enabled exact-name table preference', () => {
      const first = { name, type: 'table_preference', value: 'first' };
      const last = { name, type: 'table_preference', value: 'last' };
      expect(
        findTableViewPreference(
          [
            first,
            {
              name: `${name}.other`,
              type: 'table_preference',
              value: 'wrong',
            },
            { name, type: 'style', value: 'wrong type' },
            last,
          ],
          name
        )
      ).toBe(last);
    });

    it('ignores disabled records', { tags: ['edge-case'] }, () => {
      expect(
        findTableViewPreference(
          [{ name, type: 'table_preference', value: '[]', disabled: true }],
          name
        )
      ).toBeUndefined();
    });

    it('accepts a legacy record without type but rejects an explicit non-table type', () => {
      const legacy = { name, value: 'legacy' };
      expect(findTableViewPreference([legacy], name)).toBe(legacy);
      expect(findTableViewPreference([{ name, type: 'style', value: 'wrong' }], name)).toBeUndefined();
    });
  });

  describe('parseViews', { tags: ['important'] }, () => {
    it('parses the platform value shape (JSON string array)', () => {
      const value = JSON.stringify([
        { id: 1, key: 'Filter By ClientName', value: { columnState: [{ colId: 'a' }], filterModel: {}, sortModel: [], selectedFilterName: '' } },
      ]);
      expect(parseViews(value)).toEqual([
        { id: 1, key: 'Filter By ClientName', value: { columnState: [{ colId: 'a' }], filterModel: {}, sortModel: [], selectedFilterName: '' } },
      ]);
    });

    it('returns [] for empty / malformed / non-array values', { tags: ['edge-case'] }, () => {
      expect(parseViews('')).toEqual([]);
      expect(parseViews('[]')).toEqual([]);
      expect(parseViews('not json')).toEqual([]);
      expect(parseViews('{"a":1}')).toEqual([]);
      expect(parseViews(null)).toEqual([]);
      expect(parseViews(undefined)).toEqual([]);
    });

    it('drops entries missing id or key, and defaults missing state fields', { tags: ['edge-case'] }, () => {
      const value = JSON.stringify([
        { key: 'no id' },
        { id: 2 },
        { id: 3, key: 'ok' }, // no value → defaults
      ]);
      expect(parseViews(value)).toEqual([
        { id: 3, key: 'ok', value: { columnState: [], filterModel: {}, sortModel: [], selectedFilterName: '' } },
      ]);
    });

    it('drops duplicate ids within one preference scope', { tags: ['edge-case'] }, () => {
      const value = JSON.stringify([
        { id: 1, key: 'First', value: STATE },
        { id: 1, key: 'Duplicate', value: STATE },
      ]);
      expect(parseViews(value).map((view) => view.key)).toEqual(['First']);
    });

    it('round-trips with serializeViews', () => {
      expect(parseViews(serializeViews(VIEWS))).toEqual(VIEWS);
    });

    it('does not persist runtime scope metadata', () => {
      const scoped = mergeTableViews([], [VIEWS[0]]);
      expect(JSON.parse(serializeViews(scoped))).toEqual([VIEWS[0]]);
    });
  });

  describe('shared and personal merge', { tags: ['important'] }, () => {
    const scoped: ScopedTableView[] = mergeTableViews(
      [{ id: 1, key: 'Wealth', value: STATE }],
      [{ id: 1, key: 'My View', value: STATE }]
    );

    it('keeps same numeric ids collision-free and shared views first', () => {
      expect(scoped.map((view) => view.runtimeId)).toEqual(['organization:1', 'user:1']);
      expect(scoped.map((view) => view.key)).toEqual(['Wealth', 'My View']);
    });

    it('marks only organization views read-only', () => {
      expect(scoped[0]).toMatchObject({
        scope: 'organization',
        readOnly: true,
      });
      expect(scoped[1]).toMatchObject({ scope: 'user', readOnly: false });
    });

    it('finds by runtime id and resolves only personal ids as editable', () => {
      expect(findScopedView(scoped, 'organization:1')?.key).toBe('Wealth');
      expect(editableUserViewId(VIEWS, tableViewRuntimeId('user', 1))).toBe(1);
      expect(editableUserViewId(VIEWS, 'organization:1')).toBeUndefined();
    });
  });

  describe('view CRUD', { tags: ['important'] }, () => {
    it('assigns the next id (max + 1)', () => {
      expect(nextViewId([])).toBe(1);
      expect(nextViewId(VIEWS)).toBe(3);
    });

    it('adds a view with a unique id and trimmed name', () => {
      const next = addView(VIEWS, '  My View  ', STATE);
      expect(next).toHaveLength(3);
      expect(next[2]).toEqual({ id: 3, key: 'My View', value: STATE });
      expect(VIEWS).toHaveLength(2); // pure — original untouched
    });

    it('renames a view by id', () => {
      expect(renameView(VIEWS, 2, 'Renamed').find((v) => v.id === 2)?.key).toBe('Renamed');
    });

    it('updates a view\'s captured state by id (Save Changes), keeping its name', () => {
      const newState: GridViewState = { columnState: [{ colId: 'z' }], filterModel: { x: 1 }, sortModel: [], selectedFilterName: '' };
      const out = updateViewState(VIEWS, 2, newState);
      expect(out.find((v) => v.id === 2)).toEqual({ id: 2, key: 'Active only', value: newState });
      expect(out.find((v) => v.id === 1)?.value).toBe(STATE); // other views untouched
      expect(VIEWS[1].value).toBe(STATE); // pure — original untouched
    });

    it('deletes a view by id', () => {
      expect(deleteView(VIEWS, 1).map((v) => v.id)).toEqual([2]);
    });

    it('finds a view by id (null → undefined base view)', { tags: ['edge-case'] }, () => {
      expect(findView(VIEWS, 2)?.key).toBe('Active only');
      expect(findView(VIEWS, null)).toBeUndefined();
      expect(findView(VIEWS, 99)).toBeUndefined();
    });
  });

  describe('isValidViewName', { tags: ['logic'] }, () => {
    it('rejects blank and duplicate names (case-insensitive)', () => {
      expect(isValidViewName(VIEWS, '')).toBe(false);
      expect(isValidViewName(VIEWS, '   ')).toBe(false);
      expect(isValidViewName(VIEWS, 'active only')).toBe(false);
      expect(isValidViewName(VIEWS, 'Brand New')).toBe(true);
    });
    it('allows a view to keep its own name when renaming (excludeId)', () => {
      expect(isValidViewName(VIEWS, 'Active only', 2)).toBe(true);
      expect(isValidViewName(VIEWS, 'Filter By ClientName', 2)).toBe(false);
    });
  });

  describe('isValidScopedViewName', { tags: ['logic'] }, () => {
    const scoped = mergeTableViews(
      [{ id: 1, key: 'Wealth', value: STATE }],
      [{ id: 1, key: 'Personal', value: STATE }]
    );

    it('rejects duplicates across shared and personal scopes', () => {
      expect(isValidScopedViewName(scoped, 'wealth')).toBe(false);
      expect(isValidScopedViewName(scoped, 'PERSONAL')).toBe(false);
      expect(isValidScopedViewName(scoped, 'Annuity')).toBe(true);
    });

    it('excludes only the exact runtime view when renaming', () => {
      expect(isValidScopedViewName(scoped, 'Personal', 'user:1')).toBe(true);
      expect(isValidScopedViewName(scoped, 'Wealth', 'user:1')).toBe(false);
    });
  });
});
