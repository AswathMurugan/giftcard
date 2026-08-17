import { describe, it, expect } from 'vitest';
import {
  renderSavedQueryCatalog,
  type SavedQueryCatalogEntry,
} from './saved-query-catalog';

function entry(
  overrides: Partial<SavedQueryCatalogEntry> = {},
): SavedQueryCatalogEntry {
  return {
    name: 'sample_query',
    label: 'Sample Query',
    description: 'A sample saved query for testing.',
    type: 'dynamic',
    isSingle: false,
    isComposite: false,
    appKey: 'wealthdomain_xxx',
    inputs: [{ name: 'accountId', required: true }],
    outputs: ['account_list'],
    ...overrides,
  };
}

describe(
  'saved-query-catalog',
  { tags: ['saved-query', 'logic'] },
  () => {
    describe('renderSavedQueryCatalog', { tags: ['important'] }, () => {
      it(
        'sorts entries alphabetically by name and emits one block per query',
        { tags: ['important'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ name: 'zebra' }),
            entry({ name: 'apple' }),
            entry({ name: 'mango' }),
          ]);
          // Strip header so we only count entry headings.
          const headings = md.match(/^### `[^`]+`/gm) ?? [];
          expect(headings).toEqual([
            '### `apple`',
            '### `mango`',
            '### `zebra`',
          ]);
        },
      );

      it(
        'emits the foldered Module path (per-app, not flat)',
        { tags: ['important'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ name: 'get_client_list_count', appKey: 'test95_abc' }),
          ]);
          expect(md).toContain(
            '**Module:** `src/types/saved-queries/test95_abc/get_client_list_count.ts`',
          );
          // Never the old flat path.
          expect(md).not.toContain(
            '`src/types/saved-queries/get_client_list_count.ts`',
          );
        },
      );

      it(
        'falls back to _unknown_app folder when appKey is empty',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ name: 'no_app', appKey: '' }),
          ]);
          expect(md).toContain(
            '**Module:** `src/types/saved-queries/_unknown_app/no_app.ts`',
          );
        },
      );

      it(
        'list query without a count companion renders the fetch-all useSavedQueryTable call',
        { tags: ['smoke'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ name: 'list_q', isSingle: false }),
          ]);
          expect(md).toContain(
            "**Hook:** `useSavedQueryTable(\"list_q\")`",
          );
          expect(md).toContain('no count companion in catalog');
          expect(md).not.toContain('useSavedQuerySingle');
        },
      );

      it(
        'list query with a count companion renders the paired useSavedQueryTable call',
        { tags: ['important'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_client_list',
              isSingle: false,
              countCompanion: 'get_client_count',
              countSelectorPath: 'client_aggregate.ID',
            }),
          ]);
          expect(md).toContain(
            '**Hook:** `useSavedQueryTable("get_client_list", { ' +
              'countQuery: "get_client_count", countSelector: (r) => ' +
              'r?.client_aggregate?.ID })`',
          );
          expect(md).toContain(
            '**Count companion:** `get_client_count`',
          );
        },
      );

      it(
        'unguessable count companion shape renders a TODO selector',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_thing_list',
              isSingle: false,
              countCompanion: 'get_thing_count',
              countSelectorPath: undefined,
            }),
          ]);
          expect(md).toContain('countSelector: (r) => undefined');
          expect(md).toContain(
            'TODO: count companion shape unclear; inspect get_thing_count',
          );
          expect(md).toContain(
            '**Count companion:** `get_thing_count`',
          );
        },
      );

      it(
        'list query with searchColumns puts them in the Hook line AND a bullet',
        { tags: ['important'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_client_list',
              isSingle: false,
              countCompanion: 'get_client_count',
              countSelectorPath: 'ID',
              searchColumns: ['client_name'],
            }),
          ]);
          expect(md).toContain(
            '**Hook:** `useSavedQueryTable("get_client_list", { ' +
              'countQuery: "get_client_count", countSelector: (r) => ' +
              'r?.ID, searchColumns: ["client_name"] })`',
          );
          expect(md).toContain(
            '**Searchable columns (heuristic):** `client_name`',
          );
        },
      );

      it(
        'list query with empty searchColumns surfaces a TODO without a bullet',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_obscure_list',
              isSingle: false,
              countCompanion: undefined,
              searchColumns: [],
            }),
          ]);
          // Hook line still mentions searchColumns so the agent sees it.
          expect(md).toContain('searchColumns: []');
          expect(md).toContain(
            'TODO: pick entity text fields to enable toolbar search',
          );
          // No "Searchable columns" bullet when the array is empty.
          expect(md).not.toContain('**Searchable columns');
        },
      );

      it(
        'list query without searchColumns at all renders no searchColumns fragment',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_simple_list',
              isSingle: false,
              countCompanion: undefined,
              searchColumns: undefined,
            }),
          ]);
          expect(md).toContain(
            '**Hook:** `useSavedQueryTable("get_simple_list")`',
          );
          expect(md).not.toContain('searchColumns');
          expect(md).not.toContain('**Searchable columns');
        },
      );

      it(
        'requiredInputs land in the Hook line and as a bullet',
        { tags: ['important'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_all_accounts',
              isSingle: false,
              countCompanion: undefined,
              searchColumns: ['name'],
              requiredInputs: ['isActive', 'type'],
            }),
          ]);
          expect(md).toContain(
            '**Hook:** `useSavedQueryTable("get_all_accounts", { ' +
              'searchColumns: ["name"], ' +
              'requiredInputs: ["isActive", "type"] })`',
          );
          expect(md).toContain(
            '**Required inputs (fetch gated until provided):** `isActive`, `type`',
          );
        },
      );

      it(
        'omits requiredInputs entirely when the saved query has none',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_no_required',
              isSingle: false,
              countCompanion: undefined,
              searchColumns: undefined,
              requiredInputs: [],
            }),
          ]);
          expect(md).not.toContain('requiredInputs');
          expect(md).not.toContain('**Required inputs');
        },
      );

      it(
        'requiredInputs combine with countCompanion + searchColumns in one Hook line',
        { tags: ['logic'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'get_combined',
              isSingle: false,
              countCompanion: 'get_combined_count',
              countSelectorPath: 'total',
              searchColumns: ['name'],
              requiredInputs: ['status'],
            }),
          ]);
          expect(md).toContain(
            '**Hook:** `useSavedQueryTable("get_combined", { ' +
              'countQuery: "get_combined_count", ' +
              'countSelector: (r) => r?.total, ' +
              'searchColumns: ["name"], ' +
              'requiredInputs: ["status"] })`',
          );
        },
      );

      it(
        'picks useSavedQuerySingle for is_single_output queries',
        { tags: ['smoke'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ name: 'single_q', isSingle: true }),
          ]);
          expect(md).toContain(
            "**Hook:** `useSavedQuerySingle(\"single_q\", { input })`",
          );
        },
      );

      it(
        'inputs list shows required marker and quotes names',
        { tags: ['logic'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              inputs: [
                { name: 'accountId', required: true },
                { name: 'asOfDate', required: false },
              ],
            }),
          ]);
          expect(md).toContain(
            '**Inputs:** `accountId` (required), `asOfDate`',
          );
        },
      );

      it(
        'inputs and outputs render as _(none)_ when empty',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ inputs: [], outputs: [] }),
          ]);
          expect(md).toContain('**Inputs:** _(none)_');
          expect(md).toContain('**Outputs:** _(none)_');
        },
      );

      it(
        'outputs list shows top-level keys',
        { tags: ['logic'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ outputs: ['account', 'primary_owner', 'advisors'] }),
          ]);
          expect(md).toContain(
            '**Outputs:** `account`, `primary_owner`, `advisors`',
          );
        },
      );

      it(
        'empty description renders as the explicit placeholder',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ name: 'no_desc', description: '   ' }),
          ]);
          expect(md).toContain('_(no description provided)_');
        },
      );

      it(
        'collapses newlines inside the description to spaces',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'multiline',
              description: 'Line one.\nLine two.\r\nLine three.',
            }),
          ]);
          expect(md).toContain('Line one. Line two. Line three.');
          // No literal newline inside the description line.
          const after = md.split('Line one.')[1];
          expect(after.startsWith(' Line two. Line three.')).toBe(true);
        },
      );

      it(
        'single-output composites (multi_query) use useSavedQuerySingle',
        { tags: ['edge-case', 'important'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'multi',
              type: 'multi_query',
              isComposite: true,
              // The data-manager forces is_single_output=true for multi_query:
              // the result is ONE object keyed by sub-query name. The list
              // hook's normaliser would turn that multi-key object into [],
              // so the catalog must route through useSavedQuerySingle.
              isSingle: true,
            }),
          ]);
          expect(md).toContain('**Type:** multi_query');
          expect(md).toContain('useSavedQuerySingle');
          expect(md).not.toContain('useSavedQueryList');
          expect(md).toContain(
            '⚠ Composite — return type is `unknown` until typed by hand.',
          );
        },
      );

      it(
        'list-output composites keep the bare list hook + warning note',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({
              name: 'combo_read',
              type: 'common_table_expression',
              isComposite: true,
              isSingle: false,
            }),
          ]);
          expect(md).toContain('useSavedQueryList');
          expect(md).not.toContain('useSavedQuerySingle');
          expect(md).toContain(
            '⚠ Composite — return type is `unknown` until typed by hand.',
          );
        },
      );

      it(
        'omits the app column when appKey is empty',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([
            entry({ name: 'no_app', appKey: '' }),
          ]);
          expect(md).not.toContain('**App:**');
          expect(md).toContain('**Single output:** no');
        },
      );

      it(
        'empty catalog renders a helpful placeholder, not an empty body',
        { tags: ['edge-case'] },
        () => {
          const md = renderSavedQueryCatalog([]);
          expect(md).toContain('# Saved Queries Catalog');
          expect(md).toContain('No saved queries available');
          // No entry headings.
          expect(md.match(/^### `/gm)).toBeNull();
        },
      );

      it(
        'always starts with the catalog header',
        { tags: ['smoke'] },
        () => {
          const md = renderSavedQueryCatalog([entry()]);
          expect(md.startsWith('# Saved Queries Catalog')).toBe(true);
          expect(md).toContain('grep this file by keyword');
          expect(md).toContain('the **only** data mechanism');
        },
      );
    });

    describe('patch (write) queries', { tags: ['important'] }, () => {
      it('renders useSavedQueryMutation hook for type=patch', () => {
        const md = renderSavedQueryCatalog([
          entry({ name: 'patch_sr_instance', type: 'patch' }),
        ]);
        expect(md).toContain(
          '**Hook:** `useSavedQueryMutation("patch_sr_instance")`',
        );
        // Never a read hook for a patch query.
        expect(md).not.toContain('useSavedQueryTable("patch_sr_instance"');
        expect(md).not.toContain('useSavedQueryList("patch_sr_instance"');
      });

      it('adds a WRITE note for patch queries', () => {
        const md = renderSavedQueryCatalog([
          entry({ name: 'patch_sr_instance', type: 'patch' }),
        ]);
        expect(md).toContain('WRITE (patch)');
        expect(md).toContain('useSavedQueryMutation');
      });

      it('does not add the WRITE note for read queries', { tags: ['edge-case'] }, () => {
        const md = renderSavedQueryCatalog([entry({ type: 'dynamic' })]);
        expect(md).not.toContain('WRITE (patch)');
      });
    });

    describe('dynamic write queries (insert/update/delete)', { tags: ['important'] }, () => {
      for (const op of ['insert', 'update', 'delete'] as const) {
        it(`renders the mutation hook + WRITE (${op}) note, never a read hook`, () => {
          const md = renderSavedQueryCatalog([
            entry({ name: `q_${op}`, type: 'dynamic', operation: op }),
          ]);
          expect(md).toContain(`**Hook:** \`useSavedQueryMutation("q_${op}")\``);
          expect(md).toContain(`WRITE (${op})`);
          expect(md).not.toContain(`useSavedQueryTable("q_${op}"`);
          expect(md).not.toContain(`useSavedQuerySingle("q_${op}"`);
        });
      }
    });
  },
);
