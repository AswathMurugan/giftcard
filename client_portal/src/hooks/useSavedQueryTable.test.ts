import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FETCH_ALL_PAGE_SIZE,
  DEFAULT_INITIAL_PAGE_SIZE,
  buildSavedQuerySort,
  buildFilterCEL,
  buildSearchCEL,
  buildGatedMessage,
  combineFilterCEL,
  findMissingRequiredInputs,
  applyCountSelector,
  isCountSelectorLikelyBroken,
  resolveTableError,
} from './useSavedQueryTable';

describe(
  'useSavedQueryTable',
  { tags: ['saved-query', 'logic'] },
  () => {
    describe('constants', { tags: ['smoke'] }, () => {
      it(
        'DEFAULT_FETCH_ALL_PAGE_SIZE is capped small (<= 100) for performance',
        () => {
          // Kept small so an un-companioned table never pulls a huge dataset
          // in one request. Larger tables must ship a count companion.
          expect(DEFAULT_FETCH_ALL_PAGE_SIZE).toBeLessThanOrEqual(100);
          expect(DEFAULT_FETCH_ALL_PAGE_SIZE).toBeGreaterThan(0);
          expect(Number.isFinite(DEFAULT_FETCH_ALL_PAGE_SIZE)).toBe(true);
        },
      );

      it('DEFAULT_INITIAL_PAGE_SIZE is reasonable (10–100)', () => {
        expect(DEFAULT_INITIAL_PAGE_SIZE).toBeGreaterThanOrEqual(10);
        expect(DEFAULT_INITIAL_PAGE_SIZE).toBeLessThanOrEqual(100);
      });
    });

    describe('buildSavedQuerySort', { tags: ['logic'] }, () => {
      it(
        'returns undefined for empty / missing sort model',
        { tags: ['edge-case'] },
        () => {
          expect(buildSavedQuerySort([])).toBeUndefined();
          expect(buildSavedQuerySort(undefined)).toBeUndefined();
        },
      );

      it('emits `field` for ascending sort', { tags: ['smoke'] }, () => {
        expect(
          buildSavedQuerySort([{ colId: 'name', sort: 'asc' }]),
        ).toBe('name');
      });

      it('emits `-field` for descending sort', { tags: ['smoke'] }, () => {
        expect(
          buildSavedQuerySort([{ colId: 'created_at', sort: 'desc' }]),
        ).toBe('-created_at');
      });

      it(
        'joins multi-column sort with comma',
        { tags: ['important'] },
        () => {
          expect(
            buildSavedQuerySort([
              { colId: 'status', sort: 'asc' },
              { colId: 'created_at', sort: 'desc' },
            ]),
          ).toBe('status,-created_at');
        },
      );

      it(
        'drops AG-Grid auto-numeric colIds (field-less columns)',
        { tags: ['important', 'edge-case'] },
        () => {
          // A column declared with only `valueGetter` (no `field`/`colId`)
          // gets colId "0" from AG-Grid. Sorting that header would emit
          // `_sort=0` which the data-manager either errors on or ignores.
          // We silently drop it instead.
          expect(
            buildSavedQuerySort([{ colId: '0', sort: 'asc' }]),
          ).toBeUndefined();
          expect(
            buildSavedQuerySort([{ colId: '42', sort: 'desc' }]),
          ).toBeUndefined();
        },
      );

      it(
        'in mixed sort, keeps only entries with usable colIds',
        { tags: ['important'] },
        () => {
          expect(
            buildSavedQuerySort([
              { colId: '0', sort: 'asc' },
              { colId: 'name', sort: 'desc' },
            ]),
          ).toBe('-name');
        },
      );

      it(
        'accepts dotted nested-field colIds',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildSavedQuerySort([
              { colId: 'roles.roles.name', sort: 'asc' },
            ]),
          ).toBe('roles.roles.name');
        },
      );
    });

    describe('buildFilterCEL', { tags: ['logic'] }, () => {
      it(
        'returns undefined for null / undefined / empty filter model',
        { tags: ['edge-case'] },
        () => {
          expect(buildFilterCEL(null)).toBeUndefined();
          expect(buildFilterCEL(undefined)).toBeUndefined();
          expect(buildFilterCEL({})).toBeUndefined();
        },
      );

      it(
        'emits containsIgnoreCase (literal semantics) for a single text filter',
        { tags: ['smoke'] },
        () => {
          expect(
            buildFilterCEL({ name: { filter: 'alice', type: 'contains' } }),
          ).toBe("containsIgnoreCase(name, 'alice')");
        },
      );

      it(
        'escapes single quotes in filter values',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildFilterCEL({
              name: { filter: "O'Brien", type: 'contains' },
            }),
          ).toBe("containsIgnoreCase(name, 'O\\'Brien')");
        },
      );

      it(
        'LIKE metacharacters pass through as literals (server escapes them)',
        { tags: ['edge-case', 'important'] },
        () => {
          // A user typing % or _ searches for those characters — the
          // data-manager escapes them inside contains-family functions, so
          // the starter must NOT wrap them in an explicit ilike pattern.
          expect(
            buildFilterCEL({ symbol: { filter: '%', type: 'contains' } }),
          ).toBe("containsIgnoreCase(symbol, '%')");
          expect(
            buildFilterCEL({ symbol: { filter: '_', type: 'contains' } }),
          ).toBe("containsIgnoreCase(symbol, '_')");
        },
      );

      it(
        'doubles backslashes so CEL parses them as literals',
        { tags: ['edge-case'] },
        () => {
          // Without doubling, CEL would parse `\t` in the quoted literal
          // as a TAB character.
          expect(
            buildFilterCEL({ path: { filter: 'C:\\temp', type: 'contains' } }),
          ).toBe("containsIgnoreCase(path, 'C:\\\\temp')");
        },
      );

      it(
        'joins multi-column filter with &&',
        { tags: ['important'] },
        () => {
          expect(
            buildFilterCEL({
              name: { filter: 'alice', type: 'contains' },
              email: { filter: '@example.com', type: 'contains' },
            }),
          ).toBe(
            "containsIgnoreCase(name, 'alice') && containsIgnoreCase(email, '@example.com')",
          );
        },
      );

      it(
        'skips whitespace-only filter values',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildFilterCEL({ name: { filter: '   ', type: 'contains' } }),
          ).toBeUndefined();
        },
      );

      it(
        'skips entries without a recognised filterType / operator',
        { tags: ['edge-case'] },
        () => {
          // `balance` here has no `filterType`, so it defaults to text — and
          // `greaterThan` is not a text operator, so the entry is skipped.
          expect(
            buildFilterCEL({
              balance: { filter: 1000, type: 'greaterThan' },
              name: { filter: 'alice', type: 'contains' },
            } as never),
          ).toBe("containsIgnoreCase(name, 'alice')");
        },
      );

      // ── Expanded text operators ────────────────────────────────────
      it(
        'text.notContains → !containsIgnoreCase',
        { tags: ['logic'] },
        () => {
          expect(
            buildFilterCEL({
              name: { filterType: 'text', type: 'notContains', filter: 'alice' },
            } as never),
          ).toBe("!containsIgnoreCase(name, 'alice')");
        },
      );

      it('text.equals → ==', { tags: ['logic'] }, () => {
        expect(
          buildFilterCEL({
            status: { filterType: 'text', type: 'equals', filter: 'Open' },
          } as never),
        ).toBe("status == 'Open'");
      });

      it('text.notEqual → !=', { tags: ['logic'] }, () => {
        expect(
          buildFilterCEL({
            status: { filterType: 'text', type: 'notEqual', filter: 'Closed' },
          } as never),
        ).toBe("status != 'Closed'");
      });

      it(
        'text.startsWith and endsWith → lower(field) forms with lowercased value',
        { tags: ['logic'] },
        () => {
          // Case-insensitive prefix/suffix via the server's own structured
          // caseInsensitive shape (LIKE metachars escaped server-side).
          expect(
            buildFilterCEL({
              name: { filterType: 'text', type: 'startsWith', filter: 'Al' },
            } as never),
          ).toBe("startsWith(lower(name), 'al')");
          expect(
            buildFilterCEL({
              name: { filterType: 'text', type: 'endsWith', filter: 'SON' },
            } as never),
          ).toBe("endsWith(lower(name), 'son')");
        },
      );

      it(
        'text.blank / notBlank emit null-or-empty checks',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildFilterCEL({
              name: { filterType: 'text', type: 'blank' },
            } as never),
          ).toBe("(name == null || name == '')");
          expect(
            buildFilterCEL({
              name: { filterType: 'text', type: 'notBlank' },
            } as never),
          ).toBe("(name != null && name != '')");
        },
      );

      // ── Number operators ──────────────────────────────────────────
      it(
        'number filters cover the full operator set',
        { tags: ['important'] },
        () => {
          const mk = (type: string, filter: number, filterTo?: number) =>
            buildFilterCEL({
              balance: { filterType: 'number', type, filter, filterTo },
            } as never);
          expect(mk('equals', 100)).toBe('balance == 100');
          expect(mk('notEqual', 100)).toBe('balance != 100');
          expect(mk('greaterThan', 100)).toBe('balance > 100');
          expect(mk('greaterThanOrEqual', 100)).toBe('balance >= 100');
          expect(mk('lessThan', 100)).toBe('balance < 100');
          expect(mk('lessThanOrEqual', 100)).toBe('balance <= 100');
          expect(mk('inRange', 100, 200)).toBe(
            '(balance >= 100 && balance <= 200)',
          );
        },
      );

      it(
        'number filter accepts numeric string and skips NaN',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildFilterCEL({
              balance: { filterType: 'number', type: 'greaterThan', filter: '50' },
            } as never),
          ).toBe('balance > 50');
          expect(
            buildFilterCEL({
              balance: {
                filterType: 'number',
                type: 'greaterThan',
                filter: 'notanumber',
              },
            } as never),
          ).toBeUndefined();
        },
      );

      // ── Date operators ────────────────────────────────────────────
      it('date filters use ISO string literals', { tags: ['logic'] }, () => {
        expect(
          buildFilterCEL({
            opened: {
              filterType: 'date',
              type: 'equals',
              dateFrom: '2024-01-01',
            },
          } as never),
        ).toBe("opened == '2024-01-01'");
        expect(
          buildFilterCEL({
            opened: {
              filterType: 'date',
              type: 'inRange',
              dateFrom: '2024-01-01',
              dateTo: '2024-12-31',
            },
          } as never),
        ).toBe("(opened >= '2024-01-01' && opened <= '2024-12-31')");
      });

      // ── Set filter ────────────────────────────────────────────────
      it(
        'set filter single value → `includes(field, v)`',
        { tags: ['logic'] },
        () => {
          expect(
            buildFilterCEL({
              status: {
                filterType: 'set',
                values: ['Open'],
              },
            } as never),
          ).toBe("includes(status, 'Open')");
        },
      );

      it(
        'set filter multiple values → OR-joined includes',
        { tags: ['important'] },
        () => {
          expect(
            buildFilterCEL({
              status: {
                filterType: 'set',
                values: ['Open', 'Pending'],
              },
            } as never),
          ).toBe("(includes(status, 'Open') || includes(status, 'Pending'))");
        },
      );

      it(
        'set filter with numeric values keeps numbers unquoted',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildFilterCEL({
              rank: {
                filterType: 'set',
                values: [1, 2, 3],
              },
            } as never),
          ).toBe(
            '(includes(rank, 1) || includes(rank, 2) || includes(rank, 3))',
          );
        },
      );

      // ── Combined filters across columns of different types ───────
      it(
        'mixed text + number filters combine with &&',
        { tags: ['important'] },
        () => {
          expect(
            buildFilterCEL({
              name: { filterType: 'text', type: 'contains', filter: 'alice' },
              balance: { filterType: 'number', type: 'greaterThan', filter: 100 },
            } as never),
          ).toBe(
            "containsIgnoreCase(name, 'alice') && balance > 100",
          );
        },
      );

      // ── Bogus colId rejection ─────────────────────────────────────
      // AG-Grid auto-assigns a colId of "0", "1", … to columns
      // declared without a `field` or `colId` (typically valueGetter-only
      // columns used for derived display). Those keys are NOT real
      // backend field names — `containsIgnoreCase(0, 'foo')` is parsed by the
      // data-manager as a numeric literal and matches nothing. The
      // filter builder silently drops them so the CEL on the wire
      // stays clean even when the page author forgets `field`/`colId`.
      it(
        'drops pure-numeric colIds (AG-Grid auto-assigned)',
        { tags: ['important', 'edge-case'] },
        () => {
          expect(
            buildFilterCEL({
              '0': { filterType: 'text', type: 'contains', filter: 'o' },
            } as never),
          ).toBeUndefined();
          expect(
            buildFilterCEL({
              '42': { filterType: 'text', type: 'contains', filter: 'o' },
            } as never),
          ).toBeUndefined();
        },
      );

      it(
        'drops empty / digit-leading colIds',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildFilterCEL({
              '': { filterType: 'text', type: 'contains', filter: 'o' },
            } as never),
          ).toBeUndefined();
          expect(
            buildFilterCEL({
              '1foo': { filterType: 'text', type: 'contains', filter: 'o' },
            } as never),
          ).toBeUndefined();
        },
      );

      it(
        'in mixed model, keeps only clauses with usable colIds',
        { tags: ['important'] },
        () => {
          // Mirrors the real Accounts-page bug: a valueGetter-only
          // "Account Name" column ends up keyed "0" alongside
          // "account_number". Only the latter should reach the wire.
          expect(
            buildFilterCEL({
              '0': { filterType: 'text', type: 'contains', filter: 'o' },
              account_number: {
                filterType: 'text',
                type: 'contains',
                filter: '00',
              },
            } as never),
          ).toBe("containsIgnoreCase(account_number, '00')");
        },
      );

      it(
        'accepts dotted nested-field colIds',
        { tags: ['edge-case'] },
        () => {
          expect(
            buildFilterCEL({
              'roles.roles.name': {
                filterType: 'text',
                type: 'contains',
                filter: 'admin',
              },
            } as never),
          ).toBe("containsIgnoreCase(roles.roles.name, 'admin')");
        },
      );
    });

    describe('buildSearchCEL', { tags: ['logic'] }, () => {
      it(
        'returns undefined when value or searchColumns missing',
        { tags: ['edge-case'] },
        () => {
          expect(buildSearchCEL(undefined, ['name'])).toBeUndefined();
          expect(buildSearchCEL('', ['name'])).toBeUndefined();
          expect(buildSearchCEL('   ', ['name'])).toBeUndefined();
          expect(buildSearchCEL('alice', undefined)).toBeUndefined();
          expect(buildSearchCEL('alice', [])).toBeUndefined();
        },
      );

      it('single column → containsIgnoreCase literal', { tags: ['smoke'] }, () => {
        expect(buildSearchCEL('willi', ['client_name'])).toBe(
          "containsIgnoreCase(client_name, 'willi')",
        );
      });

      it(
        'multi-column → uses only the 0th, ignores extras',
        { tags: ['important'] },
        () => {
          // Saved-query backend's search is single-field; we surface
          // only `searchColumns[0]` and silently drop the rest.
          expect(
            buildSearchCEL('willi', ['first_name', 'last_name']),
          ).toBe("containsIgnoreCase(first_name, 'willi')");
        },
      );

      it(
        'escapes single quotes in the value',
        { tags: ['edge-case'] },
        () => {
          expect(buildSearchCEL("O'Brien", ['name'])).toBe(
            "containsIgnoreCase(name, 'O\\'Brien')",
          );
        },
      );

      it(
        'LIKE metacharacters search literally (server escapes them)',
        { tags: ['edge-case', 'important'] },
        () => {
          // A `%` typed into the toolbar search must not match everything.
          expect(buildSearchCEL('%', ['symbol'])).toBe(
            "containsIgnoreCase(symbol, '%')",
          );
        },
      );

      it('trims whitespace before quoting', { tags: ['edge-case'] }, () => {
        expect(buildSearchCEL('  willi  ', ['name'])).toBe(
          "containsIgnoreCase(name, 'willi')",
        );
      });
    });

    describe('combineFilterCEL', { tags: ['logic'] }, () => {
      it(
        'returns undefined when nothing is present',
        { tags: ['edge-case'] },
        () => {
          expect(combineFilterCEL()).toBeUndefined();
          expect(combineFilterCEL(undefined, undefined)).toBeUndefined();
          expect(combineFilterCEL('')).toBeUndefined();
        },
      );

      it(
        'returns the single clause unchanged when only one is present',
        { tags: ['smoke'] },
        () => {
          expect(combineFilterCEL(undefined, 'name == "alice"')).toBe(
            'name == "alice"',
          );
        },
      );

      it(
        'joins multiple clauses with && (search first, filter second)',
        { tags: ['important'] },
        () => {
          expect(
            combineFilterCEL(
              "containsIgnoreCase(name, 'willi')",
              'balance > 100',
            ),
          ).toBe(
            "containsIgnoreCase(name, 'willi') && balance > 100",
          );
        },
      );
    });

    describe('findMissingRequiredInputs', { tags: ['logic'] }, () => {
      it(
        'returns [] when no required inputs are declared',
        { tags: ['edge-case'] },
        () => {
          expect(findMissingRequiredInputs(undefined, {})).toEqual([]);
          expect(findMissingRequiredInputs([], {})).toEqual([]);
          expect(
            findMissingRequiredInputs(undefined, undefined),
          ).toEqual([]);
        },
      );

      it(
        'flags inputs that are absent from the bag',
        { tags: ['important'] },
        () => {
          expect(
            findMissingRequiredInputs(
              ['isActive', 'type'],
              { isActive: 'true' },
            ),
          ).toEqual(['type']);
        },
      );

      it(
        'flags inputs with undefined or null values',
        { tags: ['edge-case'] },
        () => {
          expect(
            findMissingRequiredInputs(
              ['a', 'b', 'c'],
              { a: undefined, b: null, c: 'present' },
            ),
          ).toEqual(['a', 'b']);
        },
      );

      it(
        'treats empty string as an intentional explicit value, not missing',
        { tags: ['important', 'edge-case'] },
        () => {
          // Pages that use a sentinel like `__ALL__` to mean "no filter"
          // translate the sentinel back to '' before passing to input.
          // The URL builder strips empty strings from the URL, but we
          // must still let the fetch fire — otherwise the table will
          // always show the gated "Provide…" empty state.
          expect(
            findMissingRequiredInputs(
              ['isActive', 'type'],
              { isActive: 'true', type: '' },
            ),
          ).toEqual([]);
        },
      );

      it(
        'treats false and 0 as present (not missing)',
        { tags: ['edge-case'] },
        () => {
          expect(
            findMissingRequiredInputs(
              ['flag', 'n'],
              { flag: false, n: 0 },
            ),
          ).toEqual([]);
        },
      );

      it(
        'returns the full required list when input is null/undefined',
        { tags: ['edge-case'] },
        () => {
          expect(
            findMissingRequiredInputs(['x', 'y'], null),
          ).toEqual(['x', 'y']);
          expect(
            findMissingRequiredInputs(['x', 'y'], undefined),
          ).toEqual(['x', 'y']);
        },
      );
    });

    describe('buildGatedMessage', { tags: ['logic'] }, () => {
      it('returns empty string for no missing', { tags: ['edge-case'] }, () => {
        expect(buildGatedMessage([])).toBe('');
      });

      it('singular form for one missing', { tags: ['smoke'] }, () => {
        expect(buildGatedMessage(['type'])).toBe(
          'Provide a value for `type` to load this list.',
        );
      });

      it('plural form joins with comma and "and"', { tags: ['logic'] }, () => {
        expect(buildGatedMessage(['isActive', 'type'])).toBe(
          'Provide values for `isActive` and `type` to load this list.',
        );
        expect(buildGatedMessage(['a', 'b', 'c'])).toBe(
          'Provide values for `a`, `b` and `c` to load this list.',
        );
      });
    });

    describe('resolveTableError', { tags: ['logic'] }, () => {
      it('no error → not an error state', { tags: ['smoke'] }, () => {
        expect(resolveTableError(null)).toEqual({
          isError: false,
          errorMessage: undefined,
        });
        expect(resolveTableError(undefined)).toEqual({
          isError: false,
          errorMessage: undefined,
        });
      });

      it(
        'a list error → error state with a user-facing message',
        { tags: ['important'] },
        () => {
          const state = resolveTableError(new Error('500 boom'));
          expect(state.isError).toBe(true);
          expect(state.errorMessage).toBe(
            "Couldn't load this list. Please try again.",
          );
        },
      );

      it(
        'a non-Error truthy value still counts as an error',
        { tags: ['edge-case'] },
        () => {
          expect(resolveTableError('failed').isError).toBe(true);
        },
      );
    });

    describe('applyCountSelector', { tags: ['logic'] }, () => {
      it(
        'returns undefined when no selector is supplied',
        { tags: ['edge-case'] },
        () => {
          expect(applyCountSelector({ total: 5 }, undefined)).toBeUndefined();
        },
      );

      it(
        'calls the selector with the result when present',
        { tags: ['smoke'] },
        () => {
          expect(
            applyCountSelector(
              { client_aggregate: { ID: 563 } },
              (r) => r?.client_aggregate?.ID,
            ),
          ).toBe(563);
        },
      );

      it(
        'calls the selector with null when result is null/undefined',
        { tags: ['edge-case'] },
        () => {
          let received: unknown = 'unset';
          applyCountSelector<{ total: number }>(null, (r) => {
            received = r;
            return undefined;
          });
          expect(received).toBeNull();
        },
      );

      it(
        'returns undefined when selector returns a non-number',
        { tags: ['edge-case'] },
        () => {
          expect(
            applyCountSelector(
              { total: '563' as unknown as number },
              (r) => r?.total,
            ),
          ).toBeUndefined();
        },
      );

      it(
        'returns undefined when selector returns NaN',
        { tags: ['edge-case'] },
        () => {
          expect(
            applyCountSelector({ total: NaN }, (r) => r?.total),
          ).toBeUndefined();
        },
      );

      it(
        'preserves zero as a valid count',
        { tags: ['edge-case'] },
        () => {
          expect(
            applyCountSelector({ total: 0 }, (r) => r?.total),
          ).toBe(0);
        },
      );
    });

    describe('isCountSelectorLikelyBroken', { tags: ['logic', 'important'] }, () => {
      const base = {
        isServerSide: true,
        countIsLoading: false,
        countResult: { count: 563 },
        resolvedCount: 563,
      };

      it('flags a wrong selector: data returned but no number extracted', () => {
        // e.g. selector `r?.client_aggregate?.ID` against `{ count: 563 }`
        expect(
          isCountSelectorLikelyBroken({
            ...base,
            countResult: { count: 563 },
            resolvedCount: undefined,
          }),
        ).toBe(true);
      });

      it('does not flag when the selector resolved a number', () => {
        expect(isCountSelectorLikelyBroken(base)).toBe(false);
      });

      it('does not flag while the count query is still loading', { tags: ['edge-case'] }, () => {
        expect(
          isCountSelectorLikelyBroken({
            ...base,
            countIsLoading: true,
            resolvedCount: undefined,
          }),
        ).toBe(false);
      });

      it('does not flag in fetch-all (client-side) mode', { tags: ['edge-case'] }, () => {
        expect(
          isCountSelectorLikelyBroken({
            ...base,
            isServerSide: false,
            resolvedCount: undefined,
          }),
        ).toBe(false);
      });

      it('does not flag when the count companion returned no data', { tags: ['edge-case'] }, () => {
        expect(
          isCountSelectorLikelyBroken({ ...base, countResult: null, resolvedCount: undefined }),
        ).toBe(false);
        expect(
          isCountSelectorLikelyBroken({ ...base, countResult: {}, resolvedCount: undefined }),
        ).toBe(false);
      });
    });
  },
);
