import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SAVED_QUERY_PAGE_SIZE,
  RESERVED_SAVED_QUERY_PARAMS,
  buildSavedQueryRequest,
  buildSavedQueryWriteRequest,
  buildIncludesFilter,
  buildOrgScopeFilter,
  normaliseSavedQueryListResponse,
  normaliseSavedQuerySingleResponse,
  parseSortExpression,
  resolveAppDefinitionKey,
} from './saved-query-request';

describe(
  'saved-query-request',
  { tags: ['saved-query', 'logic'] },
  () => {
    describe('buildSavedQueryRequest', { tags: ['important'] }, () => {
      it(
        'list variant: bare name → /execute and empty body',
        { tags: ['smoke'] },
        () => {
          const { url, body } = buildSavedQueryRequest(
            'get_accounts',
            'list',
          );
          expect(url).toBe('/saved-queries/get_accounts/execute');
          expect(body).toEqual({});
        },
      );

      it(
        'single variant: bare name → /execute (NOT /execute/single) and empty body',
        { tags: ['smoke'] },
        () => {
          const { url, body } = buildSavedQueryRequest(
            'get_account_summary',
            'single',
          );
          // Single reads hit /execute and unwrap the first row; the
          // /execute/single route 404s for some apps.
          expect(url).toBe('/saved-queries/get_account_summary/execute');
          expect(body).toEqual({});
        },
      );

      it(
        'input params flow into URL query string in deterministic order',
        { tags: ['smoke'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            input: { accountId: 'acc-1', status: 'Active' },
          });
          // URLSearchParams iterates in insertion order.
          expect(url).toBe(
            '/saved-queries/q/execute?accountId=acc-1&status=Active',
          );
        },
      );

      it(
        'encodes a SPACE in a value as %20, never + (data-manager reads params literally)',
        { tags: ['important'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            input: { sr_definition_name: 'Account Onboarding' },
          });
          expect(url).toContain('sr_definition_name=Account%20Onboarding');
          expect(url).not.toContain('+');
        },
      );

      it(
        'list pagination without queryType (non-dynamic/legacy) → _page and _size URL params',
        { tags: ['smoke'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            page: 0,
            pageSize: 50,
          });
          expect(url).toBe('/saved-queries/q/execute?_page=0&_size=50');
        },
      );

      it(
        'single variant omits _page / _size even when supplied',
        { tags: ['edge-case'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'single', {
            // these should be dropped because pagination doesn't apply to
            // single-output responses.
            page: 3,
            pageSize: 25,
          });
          expect(url).toBe('/saved-queries/q/execute');
        },
      );

      it(
        'sort without queryType (legacy) → _sort URL param',
        { tags: ['smoke'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            sort: 'desc(name)',
          });
          expect(url).toBe(
            '/saved-queries/q/execute?_sort=desc%28name%29',
          );
        },
      );

      it(
        'filter without queryType (legacy) → _filter URL param only; body stays empty',
        { tags: ['logic', 'important'] },
        () => {
          const { url, body } = buildSavedQueryRequest('q', 'list', {
            filter: "status == 'Active'",
          });
          expect(url).toContain('_filter=');
          // URLSearchParams encodes spaces as `+`; decode through the
          // same machinery to round-trip them back.
          const decoded = new URLSearchParams(url.split('?')[1]).get(
            '_filter',
          );
          expect(decoded).toBe("status == 'Active'");
          // Legacy transport never uses the body for filter.
          expect(body).toEqual({});
        },
      );

      it(
        'reserved input keys are dropped (defence in depth)',
        { tags: ['edge-case'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            input: {
              accountId: 'acc-1',
              _page: 99,
              _size: 99,
              _sort: 'asc(id)',
              _filter: 'true',
            } as Record<string, unknown>,
            page: 2,
            pageSize: 20,
          });
          // The options-supplied page/pageSize wins; the input-supplied
          // reserved keys are ignored.
          expect(url).toBe(
            '/saved-queries/q/execute?accountId=acc-1&_page=2&_size=20',
          );
        },
      );

      it(
        'URL-encodes special characters in input values',
        { tags: ['edge-case'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            input: { q: 'foo & bar', email: 'a@b.c' },
          });
          // Spaces → %20 (not +), so the data-manager reads them as real spaces.
          expect(url).toBe(
            '/saved-queries/q/execute?q=foo%20%26%20bar&email=a%40b.c',
          );
        },
      );

      it(
        'URL-encodes the saved-query name itself',
        { tags: ['edge-case'] },
        () => {
          const { url } = buildSavedQueryRequest(
            'has space',
            'list',
          );
          expect(url).toBe('/saved-queries/has%20space/execute');
        },
      );

      it(
        'skips undefined, null, and empty-string input values',
        { tags: ['edge-case'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            input: {
              keep: 'yes',
              dropUndef: undefined,
              dropNull: null,
              dropEmpty: '',
            } as Record<string, unknown>,
          });
          expect(url).toBe('/saved-queries/q/execute?keep=yes');
        },
      );

      it(
        'preserves `false` and zero (not empty)',
        { tags: ['edge-case'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            input: {
              flag: false,
              n: 0,
            } as Record<string, unknown>,
          });
          expect(url).toBe('/saved-queries/q/execute?flag=false&n=0');
        },
      );

      it(
        'throws on empty name',
        { tags: ['edge-case'] },
        () => {
          expect(() => buildSavedQueryRequest('', 'list')).toThrow(
            /non-empty string/,
          );
        },
      );

      it(
        'page=0 and pageSize=0 are emitted (zero is a valid value)',
        { tags: ['edge-case'] },
        () => {
          const { url } = buildSavedQueryRequest('q', 'list', {
            page: 0,
            pageSize: 0,
          });
          expect(url).toBe('/saved-queries/q/execute?_page=0&_size=0');
        },
      );

      it(
        'all four legacy URL params together (no queryType); body stays empty',
        { tags: ['important'] },
        () => {
          const { url, body } = buildSavedQueryRequest('q', 'list', {
            input: { id: 'x' },
            page: 1,
            pageSize: 25,
            sort: 'desc(updated_at)',
            filter: 'is_active == true',
          });
          // Order matches insertion: input first, then page, size, sort, filter
          // Spaces in the CEL `_filter` encode as %20 (not +) so the comparison
          // survives the round-trip to the data-manager.
          expect(url).toBe(
            '/saved-queries/q/execute' +
              '?id=x&_page=1&_size=25&_sort=desc%28updated_at%29' +
              '&_filter=is_active%20%3D%3D%20true',
          );
          // Filter rides on `_filter` URL param only; body is always empty.
          expect(body).toEqual({});
        },
      );

      it(
        'non-dynamic query types (sql / multi_query / CTE) keep the legacy URL params',
        { tags: ['important'] },
        () => {
          for (const queryType of [
            'sql',
            'multi_query',
            'common_table_expression',
          ]) {
            const { url, body } = buildSavedQueryRequest('q', 'list', {
              page: 1,
              pageSize: 25,
              sort: '-name',
              filter: 'active == true',
              queryType,
            });
            expect(url).toContain('_page=1');
            expect(url).toContain('_size=25');
            expect(url).toContain('_sort=-name');
            expect(url).toContain('_filter=');
            expect(body).toEqual({});
          }
        },
      );
    });

    describe(
      'dynamic body contract (SSRM list request)',
      { tags: ['important'] },
      () => {
        it(
          'list pagination → body.page with ROW-OFFSET position; no URL params',
          { tags: ['smoke'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'list', {
              page: 2,
              pageSize: 25,
              queryType: 'dynamic',
            });
            expect(url).toBe('/saved-queries/q/execute');
            expect(body).toEqual({
              page: { mode: 'offset', position: '50', size: 25 },
            });
          },
        );

        it(
          'page without pageSize uses the default size for the offset',
          { tags: ['edge-case'] },
          () => {
            const { body } = buildSavedQueryRequest('q', 'list', {
              page: 1,
              queryType: 'dynamic',
            });
            expect(body.page).toEqual({
              mode: 'offset',
              position: String(DEFAULT_SAVED_QUERY_PAGE_SIZE),
              size: DEFAULT_SAVED_QUERY_PAGE_SIZE,
            });
          },
        );

        it(
          'sort → body.sort rules; page always included (SSRM detection)',
          { tags: ['smoke'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'list', {
              sort: 'status,-balance',
              queryType: 'dynamic',
            });
            expect(url).toBe('/saved-queries/q/execute');
            expect(body.sort).toEqual([
              { field: 'status', dir: 'ASC' },
              { field: 'balance', dir: 'DESC' },
            ]);
            // The server only treats the body as a list request when `page`
            // is present — it must ride along even when the caller only set
            // a sort.
            expect(body.page).toEqual({
              mode: 'offset',
              position: '0',
              size: DEFAULT_SAVED_QUERY_PAGE_SIZE,
            });
          },
        );

        it(
          'filter → body.filterExpression; nothing on the URL',
          { tags: ['logic', 'important'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'list', {
              filter: "status == 'Active'",
              queryType: 'dynamic',
            });
            expect(url).toBe('/saved-queries/q/execute');
            expect(body.filterExpression).toBe("status == 'Active'");
            expect(body.page).toBeDefined();
          },
        );

        it(
          'no list controls → empty body (no stray page)',
          { tags: ['edge-case'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'list', {
              input: { accountId: 'a1' },
              queryType: 'dynamic',
            });
            expect(url).toBe('/saved-queries/q/execute?accountId=a1');
            expect(body).toEqual({});
          },
        );

        it(
          'single variant with filter → page {0, size 1} + filterExpression',
          { tags: ['important'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'single', {
              filter: 'id == "x"',
              queryType: 'dynamic',
            });
            expect(url).toBe('/saved-queries/q/execute');
            expect(body).toEqual({
              page: { mode: 'offset', position: '0', size: 1 },
              filterExpression: 'id == "x"',
            });
          },
        );

        it(
          'single variant ignores page/pageSize entirely',
          { tags: ['edge-case'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'single', {
              page: 3,
              pageSize: 25,
              queryType: 'dynamic',
            });
            expect(url).toBe('/saved-queries/q/execute');
            expect(body).toEqual({});
          },
        );

        it(
          'named inputs stay on the URL alongside the body',
          { tags: ['logic'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'list', {
              input: { clientId: 'c-1' },
              page: 0,
              pageSize: 10,
              queryType: 'dynamic',
            });
            expect(url).toBe('/saved-queries/q/execute?clientId=c-1');
            expect(body.page).toEqual({
              mode: 'offset',
              position: '0',
              size: 10,
            });
          },
        );

        it(
          '_org stays a URL param even in body mode (no body equivalent)',
          { tags: ['important', 'org'] },
          () => {
            const { url, body } = buildSavedQueryRequest('q', 'list', {
              filter: 'active == true',
              orgFilter: 'includes(["o1"],org.id)',
              queryType: 'dynamic',
            });
            expect(decodeURIComponent(url.split('_org=')[1])).toBe(
              'includes(["o1"],org.id)',
            );
            expect(body.filterExpression).toBe('active == true');
            expect(body.filterExpression).not.toContain('org.id');
          },
        );
      },
    );

    describe('parseSortExpression', { tags: ['logic'] }, () => {
      it('returns [] for empty / undefined / null', { tags: ['edge-case'] }, () => {
        expect(parseSortExpression(undefined)).toEqual([]);
        expect(parseSortExpression(null)).toEqual([]);
        expect(parseSortExpression('')).toEqual([]);
        expect(parseSortExpression('  ,  ,')).toEqual([]);
      });

      it('bare field → ASC', { tags: ['smoke'] }, () => {
        expect(parseSortExpression('name')).toEqual([
          { field: 'name', dir: 'ASC' },
        ]);
      });

      it('-field → DESC, +field → ASC', { tags: ['smoke'] }, () => {
        expect(parseSortExpression('-balance')).toEqual([
          { field: 'balance', dir: 'DESC' },
        ]);
        expect(parseSortExpression('+name')).toEqual([
          { field: 'name', dir: 'ASC' },
        ]);
      });

      it('comma-separated multi-column keeps order', () => {
        expect(parseSortExpression('status,-balance')).toEqual([
          { field: 'status', dir: 'ASC' },
          { field: 'balance', dir: 'DESC' },
        ]);
      });

      it('legacy desc(field)/asc(field) fragments still parse', () => {
        expect(parseSortExpression('desc(updated_at)')).toEqual([
          { field: 'updated_at', dir: 'DESC' },
        ]);
        expect(parseSortExpression('asc(name)')).toEqual([
          { field: 'name', dir: 'ASC' },
        ]);
        expect(parseSortExpression('DESC(name)')).toEqual([
          { field: 'name', dir: 'DESC' },
        ]);
      });

      it('dotted link paths pass through untouched', () => {
        expect(parseSortExpression('-client.name')).toEqual([
          { field: 'client.name', dir: 'DESC' },
        ]);
      });

      it('whitespace around segments is tolerated', { tags: ['edge-case'] }, () => {
        expect(parseSortExpression(' status , -balance ')).toEqual([
          { field: 'status', dir: 'ASC' },
          { field: 'balance', dir: 'DESC' },
        ]);
      });

      it('degenerate fragments are dropped', { tags: ['edge-case'] }, () => {
        expect(parseSortExpression('desc()')).toEqual([]);
        expect(parseSortExpression('-')).toEqual([]);
        expect(parseSortExpression('+')).toEqual([]);
      });
    });

    describe('RESERVED_SAVED_QUERY_PARAMS', { tags: ['logic'] }, () => {
      it(
        'is exactly the pagination/sort/filter/org keys',
        { tags: ['smoke'] },
        () => {
          expect([...RESERVED_SAVED_QUERY_PARAMS].sort()).toEqual(
            ['_filter', '_org', '_page', '_size', '_sort'],
          );
        },
      );
    });

    describe(
      'DEFAULT_SAVED_QUERY_PAGE_SIZE',
      { tags: ['logic'] },
      () => {
        it(
          'is exported and equals 50 (mirrors data-manager DefaultQueryLimit)',
          { tags: ['smoke'] },
          () => {
            expect(DEFAULT_SAVED_QUERY_PAGE_SIZE).toBe(50);
          },
        );

        it(
          'is a positive integer (sanity check)',
          { tags: ['edge-case'] },
          () => {
            expect(Number.isInteger(DEFAULT_SAVED_QUERY_PAGE_SIZE)).toBe(true);
            expect(DEFAULT_SAVED_QUERY_PAGE_SIZE).toBeGreaterThan(0);
          },
        );
      },
    );

    describe(
      'normaliseSavedQueryListResponse',
      { tags: ['logic'] },
      () => {
        it('passes through a bare array', { tags: ['smoke'] }, () => {
          const rows = [{ id: 1 }, { id: 2 }];
          expect(normaliseSavedQueryListResponse(rows)).toEqual(rows);
        });

        it('unwraps `{ data: [...] }`', { tags: ['smoke'] }, () => {
          const rows = [{ id: 1 }];
          expect(
            normaliseSavedQueryListResponse({ data: rows }),
          ).toEqual(rows);
        });

        it(
          'unwraps single-key object whose value is an array',
          { tags: ['logic'] },
          () => {
            const rows = [{ id: 'a' }, { id: 'b' }];
            // The renderer's saved-query response sometimes wraps under
            // the saved-query output attribute name (e.g. `client_list`).
            expect(
              normaliseSavedQueryListResponse({ client_list: rows }),
            ).toEqual(rows);
          },
        );

        it(
          'returns [] for nulls / undefined / non-objects',
          { tags: ['edge-case'] },
          () => {
            expect(normaliseSavedQueryListResponse(null)).toEqual([]);
            expect(normaliseSavedQueryListResponse(undefined)).toEqual([]);
            expect(normaliseSavedQueryListResponse(42)).toEqual([]);
            expect(normaliseSavedQueryListResponse('hello')).toEqual([]);
          },
        );

        it(
          'returns [] for multi-key objects with no `data` array',
          { tags: ['edge-case'] },
          () => {
            // Ambiguous shape — refuse to guess.
            expect(
              normaliseSavedQueryListResponse({ a: 1, b: [1, 2] }),
            ).toEqual([]);
          },
        );
      },
    );

    describe(
      'normaliseSavedQuerySingleResponse',
      { tags: ['logic'] },
      () => {
        it('passes through a plain object', { tags: ['smoke'] }, () => {
          const obj = { id: 1, name: 'X' };
          expect(normaliseSavedQuerySingleResponse(obj)).toEqual(obj);
        });

        it('unwraps `{ data: {...} }`', { tags: ['logic'] }, () => {
          const inner = { id: 1 };
          expect(
            normaliseSavedQuerySingleResponse({ data: inner }),
          ).toEqual(inner);
        });

        it(
          'returns null for null / undefined',
          { tags: ['edge-case'] },
          () => {
            expect(normaliseSavedQuerySingleResponse(null)).toBeNull();
            expect(
              normaliseSavedQuerySingleResponse(undefined),
            ).toBeNull();
          },
        );

        it(
          'takes the first row when given an array (single read via /execute)',
          { tags: ['logic'] },
          () => {
            // Single reads now hit the LIST endpoint, so the response is an
            // array — unwrap the first row.
            expect(
              normaliseSavedQuerySingleResponse([{ id: 1 }, { id: 2 }]),
            ).toEqual({ id: 1 });
          },
        );

        it(
          'returns null for an empty array',
          { tags: ['edge-case'] },
          () => {
            expect(normaliseSavedQuerySingleResponse([])).toBeNull();
          },
        );

        it(
          'unwraps `{ data: [...] }` to the first row',
          { tags: ['logic'] },
          () => {
            expect(
              normaliseSavedQuerySingleResponse({ data: [{ id: 7 }] }),
            ).toEqual({ id: 7 });
          },
        );

        it(
          'unwraps a single-key array wrapper to the first row',
          { tags: ['logic'] },
          () => {
            expect(
              normaliseSavedQuerySingleResponse({ client_kpis: [{ total: 5 }] }),
            ).toEqual({ total: 5 });
          },
        );
      },
    );

    describe('resolveAppDefinitionKey', { tags: ['important'] }, () => {
      const MAP = {
        account_list: 'wealthdomain_abc',
        finplan_client_mailing_address_list: 'finplanbabutest_xyz',
        advisor_user_list: 'platform',
      };

      it('auto-resolves a cross-app query to its registry app key', () => {
        // The exact bug: this query is owned by finplanbabutest, not the
        // running app — without resolution it would hit the wrong app.
        expect(
          resolveAppDefinitionKey('finplan_client_mailing_address_list', MAP),
        ).toBe('finplanbabutest_xyz');
      });

      it('resolves same-app and platform queries from the registry', () => {
        expect(resolveAppDefinitionKey('account_list', MAP)).toBe('wealthdomain_abc');
        expect(resolveAppDefinitionKey('advisor_user_list', MAP)).toBe('platform');
      });

      it('lets an explicit override win over the registry', () => {
        expect(
          resolveAppDefinitionKey('account_list', MAP, 'override_key'),
        ).toBe('override_key');
      });

      it('returns undefined for an unknown query (falls back to current app)', { tags: ['edge-case'] }, () => {
        expect(resolveAppDefinitionKey('not_in_map', MAP)).toBeUndefined();
        expect(resolveAppDefinitionKey('not_in_map', {})).toBeUndefined();
      });
    });

    describe('buildSavedQueryWriteRequest', { tags: ['important'] }, () => {
      it('targets /execute with the flat body passed through', () => {
        const body = { id: 'abc', bo_instance_id: 'BO999', data: { foo: 1 } };
        expect(buildSavedQueryWriteRequest('patch_sr_instance', body)).toEqual({
          url: '/saved-queries/patch_sr_instance/execute',
          body,
        });
      });

      it('does not add URL query params (no _page/_sort/_filter)', () => {
        const { url } = buildSavedQueryWriteRequest('q', { id: 'x' });
        expect(url).not.toContain('?');
      });

      it('URL-encodes the name', { tags: ['edge-case'] }, () => {
        expect(buildSavedQueryWriteRequest('a/b', { id: 'x' }).url).toBe(
          '/saved-queries/a%2Fb/execute',
        );
      });

       it('throws on an empty name', { tags: ['edge-case'] }, () => {
         expect(() => buildSavedQueryWriteRequest('', { id: 'x' })).toThrow();
       });

       it('sends every write as a flat JSON body (no URL params)', () => {
         // A plain dynamic update/insert with $body.* placeholders — the
         // values go in the body, NOT the query string (regression: PHX
         // update_client/insert_client were sent as ?name=…&rating=…).
         const input = {
           id: 'abc',
           client_name: 'Acme',
           rating: 5,
           total_aum: 7600,
         };
         expect(buildSavedQueryWriteRequest('update_client', input)).toEqual({
           url: '/saved-queries/update_client/execute',
           body: input,
         });
       });

       it('passes a nested body object straight through', () => {
         const input = { body: { name: 'Acme' } };
         expect(buildSavedQueryWriteRequest('insert_clients_cte', input)).toEqual(
           { url: '/saved-queries/insert_clients_cte/execute', body: input },
         );
       });
     });

    describe('org scoping (_org)', { tags: ['important', 'org'] }, () => {
      it('reserves _org so it cannot come from input', () => {
        expect(RESERVED_SAVED_QUERY_PARAMS.has('_org')).toBe(true);
        const { url } = buildSavedQueryRequest('q', 'list', {
          input: { _org: 'hack', type: 'A' },
        });
        expect(url).not.toContain('_org=hack');
        expect(url).toContain('type=A');
      });

      it('buildIncludesFilter emits the includes([...],field) CEL form', () => {
        expect(buildIncludesFilter(['a', 'b'], 'org.id')).toBe(
          'includes(["a","b"],org.id)',
        );
        expect(buildIncludesFilter(['a'], 'org.id')).toBe('includes(["a"],org.id)');
      });

      it('buildIncludesFilter drops empties → empty string', { tags: ['edge-case'] }, () => {
        expect(buildIncludesFilter([], 'org.id')).toBe('');
        expect(buildIncludesFilter(['', ''], 'org.id')).toBe('');
      });

      it('buildOrgScopeFilter returns null when nothing selected', { tags: ['edge-case'] }, () => {
        expect(buildOrgScopeFilter({})).toBeNull();
        expect(buildOrgScopeFilter({ orgIds: [], advisorIds: [] })).toBeNull();
      });

      it('buildOrgScopeFilter org-only', () => {
        expect(buildOrgScopeFilter({ orgIds: ['o1', 'o2'] })).toBe(
          'includes(["o1","o2"],org.id)',
        );
      });

      it('buildOrgScopeFilter ANDs org + advisor into one expression', { tags: ['important'] }, () => {
        expect(
          buildOrgScopeFilter({ orgIds: ['o1'], advisorIds: ['a1', 'a2'] }),
        ).toBe('includes(["o1"],org.id) && includes(["a1","a2"],advisor.id)');
      });

      it('buildOrgScopeFilter advisor-only', () => {
        expect(buildOrgScopeFilter({ advisorIds: ['a1'] })).toBe(
          'includes(["a1"],advisor.id)',
        );
      });

      it('applies orgFilter to the _org param (URL-encoded)', () => {
        const { url } = buildSavedQueryRequest('q', 'list', {
          orgFilter: 'includes(["o1"],org.id)',
        });
        // URLSearchParams percent-encodes brackets/quotes/parens.
        expect(decodeURIComponent(url.split('_org=')[1])).toBe(
          'includes(["o1"],org.id)',
        );
      });

      it('omits _org when orgFilter is null/empty', { tags: ['edge-case'] }, () => {
        expect(buildSavedQueryRequest('q', 'list', { orgFilter: null }).url).not.toContain('_org');
        expect(buildSavedQueryRequest('q', 'list', { orgFilter: '' }).url).not.toContain('_org');
      });
    });
  },
);
