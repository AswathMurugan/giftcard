import { describe, it, expect } from 'vitest';
import {
  buildComponentIndex,
  EMPTY_COMPONENT_INDEX,
  isEntityRef,
  parseComponentReference,
  resolveAliasedStructure,
  resolveCrossComponentStructure,
  unwrapSingleChildStructure,
  type ComponentDefinition,
} from './cross-component-refs';

describe(
  'cross-component-refs',
  { tags: ['codegen', 'logic'] },
  () => {
    describe('parseComponentReference', { tags: ['important'] }, () => {
      it('parses a workflow ref', () => {
        expect(
          parseComponentReference('platform.workflow.create_user'),
        ).toEqual({
          appDefinition: 'platform',
          componentType: 'workflow',
          componentName: 'create_user',
          structureName: null,
        });
      });

      it('parses a saved-query ref with structure', () => {
        expect(
          parseComponentReference(
            'app__V1.saved-query.get_accounts.responseStructure',
          ),
        ).toEqual({
          appDefinition: 'app__V1',
          componentType: 'saved-query',
          componentName: 'get_accounts',
          structureName: 'responseStructure',
        });
      });

      it('parses a partner-module ref (from the user-pasted salesforce example)', () => {
        expect(
          parseComponentReference(
            'partner_module_salesforceapisv3_69fb4d07bfb5aa759bc338f1.partner_module_request.describeSObjects.responseStructure',
          ),
        ).toEqual({
          appDefinition:
            'partner_module_salesforceapisv3_69fb4d07bfb5aa759bc338f1',
          componentType: 'partner_module_request',
          componentName: 'describeSObjects',
          structureName: 'responseStructure',
        });
      });

      it('parses an entity ref (no structure name)', () => {
        expect(
          parseComponentReference('wealthdomain_*.entity.account'),
        ).toEqual({
          appDefinition: 'wealthdomain_*',
          componentType: 'entity',
          componentName: 'account',
          structureName: null,
        });
      });

      it(
        'returns null for under-specified or empty refs',
        { tags: ['edge-case'] },
        () => {
          expect(parseComponentReference('foo.bar')).toBeNull();
          expect(parseComponentReference('')).toBeNull();
          expect(parseComponentReference(null)).toBeNull();
          expect(parseComponentReference(undefined)).toBeNull();
        },
      );
    });

    describe('isEntityRef', { tags: ['logic'] }, () => {
      it('recognises entity refs and rejects others', () => {
        expect(isEntityRef('wealthdomain_*.entity.account')).toBe(true);
        expect(
          isEntityRef('platform.workflow.create_user'),
        ).toBe(false);
        expect(
          isEntityRef('app.partner_module_request.foo.responseStructure'),
        ).toBe(false);
        expect(isEntityRef(null)).toBe(false);
      });
    });

    // Shared fixtures across the rest of the suite.
    const describeSObjects: ComponentDefinition = {
      name: 'describeSObjects',
      app_definition_key: 'partner_module_salesforceapisv3_*',
      attributes: [
        {
          name: 'responseStructure',
          attributeType: 'internal',
          attributes: [
            { name: 'objects', type: 'array', attributeType: 'output' },
            { name: 'maxBatchSize', type: 'integer', attributeType: 'output' },
          ],
        },
      ],
    };

    const getAccounts: ComponentDefinition = {
      name: 'get_accounts',
      app_definition_key: 'wealthdomain_*',
      attributes: [
        {
          name: 'responseStructure',
          attributeType: 'internal',
          attributes: [
            {
              name: 'Account',
              type: 'array',
              attributes: [
                {
                  name: 'item',
                  type: 'object',
                  attributes: [
                    { name: 'id', type: 'string' },
                    { name: 'name', type: 'string' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const noOutputsSavedQuery: ComponentDefinition = {
      name: 'mystery_query',
      app_definition_key: 'app_*',
      attributes: [
        // No internal structure, no `output` attributes — falls back to all.
        { name: 'p', type: 'string', attributeType: 'input' },
      ],
    };

    const index = buildComponentIndex({
      partnerModules: [describeSObjects],
      savedQueries: [getAccounts, noOutputsSavedQuery],
    });

    describe('buildComponentIndex', { tags: ['important'] }, () => {
      it('looks up partner-module by name', () => {
        const def = index.get('partner_module_request', 'describeSObjects');
        expect(def?.name).toBe('describeSObjects');
      });

      it('looks up saved-query under both `saved-query` and `saved_query` keys', () => {
        expect(index.get('saved-query', 'get_accounts')?.name).toBe(
          'get_accounts',
        );
        expect(index.get('saved_query', 'get_accounts')?.name).toBe(
          'get_accounts',
        );
      });

      it('returns null on miss', () => {
        expect(index.get('partner_module_request', 'unknown')).toBeNull();
        expect(index.get('workflow', 'anything')).toBeNull();
      });

      it(
        'first-wins on duplicate names within same component type',
        { tags: ['edge-case'] },
        () => {
          const dup: ComponentDefinition = {
            name: 'describeSObjects',
            app_definition_key: 'aa_first',
            attributes: [{ name: 'sentinel-first', attributeType: 'internal' }],
          };
          const dup2: ComponentDefinition = {
            name: 'describeSObjects',
            app_definition_key: 'zz_second',
            attributes: [{ name: 'sentinel-second', attributeType: 'internal' }],
          };
          // Insertion order is sorted by app_definition_key, so 'aa_first' wins.
          const idx = buildComponentIndex({ partnerModules: [dup2, dup] });
          const got = idx.get('partner_module_request', 'describeSObjects');
          expect(got?.attributes?.[0]?.name).toBe('sentinel-first');
        },
      );
    });

    describe(
      'resolveCrossComponentStructure',
      { tags: ['important', 'logic'] },
      () => {
        it(
          'resolves the partner-module responseStructure to its inner attributes',
          () => {
            const out = resolveCrossComponentStructure(
              'partner_module_salesforceapisv3_*.partner_module_request.describeSObjects.responseStructure',
              index,
              new Set(),
            );
            expect(out).not.toBeNull();
            expect(out?.map((a) => a.name)).toEqual([
              'objects',
              'maxBatchSize',
            ]);
          },
        );

        it(
          'falls back to output attributes when no structureName provided',
          { tags: ['edge-case'] },
          () => {
            // Build a target with output attrs at the top level.
            const target: ComponentDefinition = {
              name: 'top_level_out',
              attributes: [
                { name: 'a', type: 'string', attributeType: 'output' },
                { name: 'b', type: 'integer', attributeType: 'output' },
                { name: 'ignored', type: 'string', attributeType: 'input' },
              ],
            };
            const idx = buildComponentIndex({ savedQueries: [target] });
            const out = resolveCrossComponentStructure(
              'app.saved-query.top_level_out',
              idx,
              new Set(),
            );
            expect(out?.map((a) => a.name)).toEqual(['a', 'b']);
          },
        );

        it(
          'falls back to inputs when no outputs declared and no structureName',
          { tags: ['edge-case'] },
          () => {
            const out = resolveCrossComponentStructure(
              'app_*.saved-query.mystery_query',
              index,
              new Set(),
            );
            expect(out?.map((a) => a.name)).toEqual(['p']);
          },
        );

        it('returns null for entity refs (handled by consumer)', () => {
          expect(
            resolveCrossComponentStructure(
              'wealthdomain_*.entity.account',
              index,
              new Set(),
            ),
          ).toBeNull();
        });

        it('returns null when target not in index', () => {
          expect(
            resolveCrossComponentStructure(
              'app.partner_module_request.unknown.responseStructure',
              index,
              new Set(),
            ),
          ).toBeNull();
        });

        it(
          'returns null when structureName missing on target',
          { tags: ['edge-case'] },
          () => {
            expect(
              resolveCrossComponentStructure(
                'partner_module_salesforceapisv3_*.partner_module_request.describeSObjects.missing_structure',
                index,
                new Set(),
              ),
            ).toBeNull();
          },
        );

        it('protects against cycles via the visited set', () => {
          const visited = new Set<string>();
          const ref =
            'partner_module_salesforceapisv3_*.partner_module_request.describeSObjects.responseStructure';
          // First call succeeds and adds to visited.
          const first = resolveCrossComponentStructure(ref, index, visited);
          expect(first).not.toBeNull();
          // Second call with the same visited set short-circuits to null.
          const second = resolveCrossComponentStructure(ref, index, visited);
          expect(second).toBeNull();
        });

        it('EMPTY_COMPONENT_INDEX always misses', () => {
          expect(
            resolveCrossComponentStructure(
              'app.workflow.foo.responseStructure',
              EMPTY_COMPONENT_INDEX,
              new Set(),
            ),
          ).toBeNull();
        });
      },
    );

    describe(
      'resolveCrossComponentStructure — saved-query alias (PHX-3832)',
      { tags: ['important', 'logic'] },
      () => {
        // Saved-query targets store their response shape as top-level
        // `attributeType: 'output'` attributes, NOT inside an `internal`
        // attribute named `responseStructure`. This block locks in the
        // keyword-alias fallback that closes the gap.
        const getClientKpi: ComponentDefinition = {
          name: 'get_client_kpi',
          app_definition_key: 'wealthdomain_*',
          attributes: [
            {
              name: 'client_aggregate',
              type: 'object',
              attributeType: 'output',
              attributes: [
                { name: 'ID', type: 'integer' },
              ],
            },
          ],
        };

        const indexWithAlias = buildComponentIndex({
          savedQueries: [getClientKpi],
        });

        it(
          'resolves saved-query responseStructure → top-level outputs (alias fallback)',
          { tags: ['important'] },
          () => {
            const out = resolveCrossComponentStructure(
              'wealthdomain__V0_0_943.saved-query.get_client_kpi.responseStructure',
              indexWithAlias,
              new Set(),
            );
            // Returns the top-level output attribute (`client_aggregate`).
            // Caller can then unwrap one level if it wants the inner.
            expect(out).not.toBeNull();
            expect(out?.map((a) => a.name)).toEqual(['client_aggregate']);
          },
        );

        it(
          'strict-match still wins when target has BOTH an internal AND top-level outputs',
          { tags: ['logic'] },
          () => {
            // No accidental override: a target that DOES declare a literal
            // `internal responseStructure` (like a partner module) keeps
            // the strict-match behaviour even if it also has top-level
            // outputs that would otherwise satisfy the alias.
            const dualShape: ComponentDefinition = {
              name: 'dual',
              attributes: [
                {
                  name: 'responseStructure',
                  attributeType: 'internal',
                  attributes: [
                    { name: 'strict_wins', type: 'string' },
                  ],
                },
                {
                  name: 'distractor',
                  type: 'object',
                  attributeType: 'output',
                },
              ],
            };
            const idx = buildComponentIndex({ partnerModules: [dualShape] });
            const out = resolveCrossComponentStructure(
              'app.partner_module_request.dual.responseStructure',
              idx,
              new Set(),
            );
            expect(out?.map((a) => a.name)).toEqual(['strict_wins']);
          },
        );

        it(
          'requestStructure alias resolves to top-level inputs',
          { tags: ['edge-case'] },
          () => {
            const inputShape: ComponentDefinition = {
              name: 'thing_with_inputs',
              attributes: [
                { name: 'p1', type: 'string', attributeType: 'input' },
                { name: 'p2', type: 'integer', attributeType: 'input' },
                { name: 'ignored', type: 'string', attributeType: 'output' },
              ],
            };
            const idx = buildComponentIndex({ savedQueries: [inputShape] });
            const out = resolveCrossComponentStructure(
              'app.saved-query.thing_with_inputs.requestStructure',
              idx,
              new Set(),
            );
            expect(out?.map((a) => a.name)).toEqual(['p1', 'p2']);
          },
        );
      },
    );

    describe('resolveAliasedStructure', { tags: ['logic'] }, () => {
      const target: ComponentDefinition = {
        name: 't',
        attributes: [
          { name: 'a', type: 'string', attributeType: 'input' },
          { name: 'b', type: 'integer', attributeType: 'output' },
          { name: 'c', type: 'string', attributeType: 'internal' },
        ],
      };

      it('responseStructure → outputs', () => {
        expect(resolveAliasedStructure('responseStructure', target)).toEqual([
          { name: 'b', type: 'integer', attributeType: 'output' },
        ]);
      });

      it('requestStructure → inputs', () => {
        expect(resolveAliasedStructure('requestStructure', target)).toEqual([
          { name: 'a', type: 'string', attributeType: 'input' },
        ]);
      });

      it('bodyStructure → inputs', () => {
        expect(resolveAliasedStructure('bodyStructure', target)).toEqual([
          { name: 'a', type: 'string', attributeType: 'input' },
        ]);
      });

      it('lowercase + alternate forms recognised', { tags: ['edge-case'] }, () => {
        expect(resolveAliasedStructure('outputs', target)?.length).toBe(1);
        expect(resolveAliasedStructure('inputs', target)?.length).toBe(1);
        expect(resolveAliasedStructure('outputStructure', target)?.length).toBe(
          1,
        );
        expect(resolveAliasedStructure('inputStructure', target)?.length).toBe(
          1,
        );
      });

      it('unknown keyword returns null', { tags: ['edge-case'] }, () => {
        expect(
          resolveAliasedStructure('mystery_structure', target),
        ).toBeNull();
      });

      it(
        'returns null when role-filter matches no attributes',
        { tags: ['edge-case'] },
        () => {
          const noOutputs: ComponentDefinition = {
            name: 'x',
            attributes: [
              { name: 'a', type: 'string', attributeType: 'input' },
            ],
          };
          expect(
            resolveAliasedStructure('responseStructure', noOutputs),
          ).toBeNull();
        },
      );
    });

    describe('unwrapSingleChildStructure', { tags: ['logic'] }, () => {
      it(
        'unwraps when there is a single object child with inner attrs',
        { tags: ['important'] },
        () => {
          const result = unwrapSingleChildStructure([
            {
              name: 'wrapper',
              type: 'object',
              attributes: [
                { name: 'a', type: 'string' },
                { name: 'b', type: 'integer' },
              ],
            },
          ]);
          expect(result.attrs.map((a) => a.name)).toEqual(['a', 'b']);
          expect(result.isArray).toBe(false);
        },
      );

      it('flags the array case so callers can append `[]`', () => {
        const result = unwrapSingleChildStructure([
          {
            name: 'Account',
            type: 'array',
            attributes: [
              {
                name: 'item',
                type: 'object',
                attributes: [{ name: 'id', type: 'string' }],
              },
            ],
          },
        ]);
        // Note we unwrap ONE level — the inner is the `item` wrapper.
        // Callers further drill on `item` themselves (renderer does too).
        expect(result.attrs[0]?.name).toBe('item');
        expect(result.isArray).toBe(true);
      });

      it('leaves multi-attribute lists unchanged', () => {
        const list = [
          { name: 'a', type: 'string' },
          { name: 'b', type: 'integer' },
        ];
        const result = unwrapSingleChildStructure(list);
        expect(result.attrs).toBe(list);
        expect(result.isArray).toBe(false);
      });

      it(
        'leaves a single attribute with no inner children unchanged',
        { tags: ['edge-case'] },
        () => {
          const list = [{ name: 'a', type: 'string' }];
          const result = unwrapSingleChildStructure(list);
          expect(result.attrs).toBe(list);
          expect(result.isArray).toBe(false);
        },
      );
    });
  },
);
