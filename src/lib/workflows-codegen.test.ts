import { describe, it, expect } from 'vitest';
import {
  attrTsType,
  buildResolverContext,
  buildWorkflowExecuteUrl,
  buildSrExecuteUrl,
  buildSrSignalUrl,
  buildSrExecuteBody,
  isEntityComponentReference,
  parseWorkflowInternalRef,
  renderExecuteHeadersLine,
  renderInterface,
  renderWorkflowCatalog,
  workflowConstCase,
  workflowFileStem,
  workflowNeedsQuotedKey,
  workflowPascalCase,
  workflowQuoteKey,
  workflowSafeIdent,
  type WorkflowDefinition,
} from './workflows-codegen';
import {
  buildComponentIndex,
  type ComponentDefinition,
} from './cross-component-refs';

describe(
  'workflows-codegen',
  { tags: ['workflow', 'codegen', 'logic'] },
  () => {
    describe('naming helpers', { tags: ['smoke'] }, () => {
      it('workflowPascalCase converts snake/kebab/space to PascalCase', () => {
        expect(workflowPascalCase('create_user')).toBe('CreateUser');
        expect(workflowPascalCase('approve-account')).toBe('ApproveAccount');
        expect(workflowPascalCase('send notification')).toBe('SendNotification');
        expect(workflowPascalCase('')).toBe('');
      });

      it('workflowConstCase converts to UPPER_SNAKE', () => {
        expect(workflowConstCase('create_user')).toBe('CREATE_USER');
        expect(workflowConstCase('approve-account')).toBe('APPROVE_ACCOUNT');
        expect(workflowConstCase('a_b')).toBe('A_B');
      });

      it('workflowFileStem preserves canonical name', () => {
        expect(workflowFileStem('create_user')).toBe('create_user');
        expect(workflowFileStem('approve-account')).toBe('approve-account');
      });

      it(
        'workflowSafeIdent replaces non-ident chars with underscore',
        { tags: ['edge-case'] },
        () => {
          expect(workflowSafeIdent('create-user!')).toBe('create_user_');
          expect(workflowSafeIdent('user.id')).toBe('user_id');
          expect(workflowSafeIdent('clean_name')).toBe('clean_name');
        },
      );

      it(
        'workflowNeedsQuotedKey detects when a key must be quoted',
        { tags: ['logic'] },
        () => {
          expect(workflowNeedsQuotedKey('clean_name')).toBe(false);
          expect(workflowNeedsQuotedKey('_underscore')).toBe(false);
          expect(workflowNeedsQuotedKey('with-dash')).toBe(true);
          expect(workflowNeedsQuotedKey('1starts_with_digit')).toBe(true);
          expect(workflowNeedsQuotedKey('with.dot')).toBe(true);
        },
      );

      it('workflowQuoteKey quotes only when required', () => {
        expect(workflowQuoteKey('clean')).toBe('clean');
        expect(workflowQuoteKey('with-dash')).toBe('"with-dash"');
      });
    });

    describe(
      'renderExecuteHeadersLine',
      { tags: ['important', 'logic'] },
      () => {
        // The historical bug (PHX-3832): emitted
        //   `options?.appDefinitionKey ?? PREFIX_APP_KEY || undefined`
        // which trips TS5076 in every generated file. The fix wraps
        // the `||` half in parens.
        it(
          'emits parens around `PREFIX_APP_KEY || undefined` (TS5076 guard)',
          { tags: ['important'] },
          () => {
            const line = renderExecuteHeadersLine('CREATE_USER');
            expect(line).toContain(
              '?? (CREATE_USER_APP_KEY || undefined)',
            );
            // Bad form must NOT appear (regression guard).
            expect(line).not.toMatch(
              /\?\?\s*CREATE_USER_APP_KEY\s+\|\|\s+undefined/,
            );
          },
        );

        it(
          'uses getDataHeadersWithUser so X-Jiffy-User-Id is stamped',
          { tags: ['important'] },
          () => {
            // Workflows require the requesting user's id on every
            // request — the `WithUser` variant of the headers helper
            // adds `X-Jiffy-User-Id` from the current JWT.
            const line = renderExecuteHeadersLine('CREATE_USER');
            expect(line).toContain('getDataHeadersWithUser(');
            expect(line).not.toMatch(/getDataHeaders\(/);
          },
        );

        it('emits the full canonical line shape', () => {
          expect(renderExecuteHeadersLine('CREATE_USER')).toBe(
            '  const headers = getDataHeadersWithUser(options?.appDefinitionKey ?? (CREATE_USER_APP_KEY || undefined));',
          );
        });

        it('throws on empty / non-string prefix', { tags: ['edge-case'] }, () => {
          expect(() => renderExecuteHeadersLine('')).toThrow(/non-empty/);
          // @ts-expect-error — testing runtime guard.
          expect(() => renderExecuteHeadersLine(undefined)).toThrow(/non-empty/);
        });
      },
    );

    describe(
      'buildWorkflowExecuteUrl',
      { tags: ['important', 'logic'] },
      () => {
        it(
          'builds the sync execute URL relative to the `workflow` apiManager service',
          { tags: ['important'] },
          () => {
            // Path is RELATIVE to the workflow service's base URL
            // (`{origin}/workflow`). The full resolved URL is
            // `{origin}/workflow/v1/execute/sync/create_user`. The
            // builder must NOT include a leading `/workflow/` — that
            // would produce `{origin}/workflow/workflow/v1/...`.
            expect(buildWorkflowExecuteUrl('create_user')).toBe(
              '/v1/execute/sync/create_user',
            );
            expect(buildWorkflowExecuteUrl('create_user')).not.toMatch(
              /^\/workflow\//,
            );
          },
        );

        it('URL-encodes characters that would otherwise break the path', () => {
          expect(buildWorkflowExecuteUrl('a b')).toBe(
            '/v1/execute/sync/a%20b',
          );
        });

        it('throws on empty / non-string name', { tags: ['edge-case'] }, () => {
          expect(() => buildWorkflowExecuteUrl('')).toThrow(/non-empty/);
          // @ts-expect-error — testing runtime guard.
          expect(() => buildWorkflowExecuteUrl(undefined)).toThrow(/non-empty/);
        });
      },
    );

    describe(
      'buildSrExecuteUrl',
      { tags: ['important', 'logic', 'service-request'] },
      () => {
        it(
          'builds the SR create URL relative to the `workflow` service',
          { tags: ['important'] },
          () => {
            // Resolves to `{origin}/workflow/v1/sr/execute/sr_test_a1`.
            // No leading `/workflow/` (the service base supplies it).
            expect(buildSrExecuteUrl('sr_test_a1')).toBe(
              '/v1/sr/execute/sr_test_a1',
            );
            expect(buildSrExecuteUrl('sr_test_a1')).not.toMatch(/^\/workflow\//);
          },
        );

        it('URL-encodes the name', () => {
          expect(buildSrExecuteUrl('a b')).toBe('/v1/sr/execute/a%20b');
        });

        it('throws on empty / non-string name', { tags: ['edge-case'] }, () => {
          expect(() => buildSrExecuteUrl('')).toThrow(/non-empty/);
          // @ts-expect-error — testing runtime guard.
          expect(() => buildSrExecuteUrl(undefined)).toThrow(/non-empty/);
        });
      },
    );

    describe(
      'buildSrSignalUrl',
      { tags: ['important', 'logic', 'service-request'] },
      () => {
        it(
          'builds the SR submit (signal trigger) URL relative to the `workflow` service',
          { tags: ['important'] },
          () => {
            // Resolves to `{origin}/workflow/v1/signals/{id}/trigger`.
            expect(
              buildSrSignalUrl('2ed72427-d22d-4317-aa0a-9e607fa3660a'),
            ).toBe('/v1/signals/2ed72427-d22d-4317-aa0a-9e607fa3660a/trigger');
            expect(
              buildSrSignalUrl('2ed72427-d22d-4317-aa0a-9e607fa3660a'),
            ).not.toMatch(/^\/workflow\//);
          },
        );

        it('URL-encodes the srInstanceId', () => {
          expect(buildSrSignalUrl('a/b')).toBe('/v1/signals/a%2Fb/trigger');
        });

        it(
          'throws on empty / non-string srInstanceId (mandatory)',
          { tags: ['edge-case'] },
          () => {
            expect(() => buildSrSignalUrl('')).toThrow(/non-empty/);
            // @ts-expect-error — testing runtime guard.
            expect(() => buildSrSignalUrl(undefined)).toThrow(/non-empty/);
          },
        );
      },
    );

    describe(
      'buildSrExecuteBody',
      { tags: ['important', 'logic', 'service-request'] },
      () => {
        it(
          'builds the create body with the mandatory ids + nested payload',
          { tags: ['important'] },
          () => {
            expect(
              buildSrExecuteBody({
                entityReferenceId: '11',
                entityType: 'account',
                payload: { client_id: 'c1', account_id: 'a1' },
              }),
            ).toEqual({
              srInstance: {
                entity_reference_id: '11',
                entity_type: 'account',
                payload: { client_id: 'c1', account_id: 'a1' },
              },
              arguments: {},
            });
          },
        );

        it('passes through provided arguments', () => {
          expect(
            buildSrExecuteBody({
              entityReferenceId: '11',
              entityType: 'account',
              payload: { client_id: 'c1' },
              args: { foo: 'bar' },
            }).arguments,
          ).toEqual({ foo: 'bar' });
        });

        it(
          'throws when entityReferenceId (boInstanceId) is missing',
          { tags: ['edge-case'] },
          () => {
            expect(() =>
              buildSrExecuteBody({
                entityReferenceId: '',
                entityType: 'account',
                payload: { client_id: 'c1' },
              }),
            ).toThrow(/entityReferenceId/);
          },
        );

        it(
          'throws when entityType (root BO name) is missing',
          { tags: ['edge-case'] },
          () => {
            expect(() =>
              buildSrExecuteBody({
                entityReferenceId: '11',
                entityType: '',
                payload: { client_id: 'c1' },
              }),
            ).toThrow(/entityType/);
          },
        );

        it(
          'throws when payload is missing or not a plain object (mandatory)',
          { tags: ['important', 'edge-case'] },
          () => {
            expect(() =>
              // @ts-expect-error — payload omitted entirely.
              buildSrExecuteBody({
                entityReferenceId: '11',
                entityType: 'account',
              }),
            ).toThrow(/payload/);
            expect(() =>
              buildSrExecuteBody({
                entityReferenceId: '11',
                entityType: 'account',
                // @ts-expect-error — wrong runtime type.
                payload: null,
              }),
            ).toThrow(/payload/);
            expect(() =>
              buildSrExecuteBody({
                entityReferenceId: '11',
                entityType: 'account',
                // @ts-expect-error — arrays are not plain objects.
                payload: ['nope'],
              }),
            ).toThrow(/payload/);
          },
        );

        it('accepts an empty payload object', { tags: ['edge-case'] }, () => {
          expect(
            buildSrExecuteBody({
              entityReferenceId: '11',
              entityType: 'account',
              payload: {},
            }).srInstance.payload,
          ).toEqual({});
        });
      },
    );

    describe('isEntityComponentReference', { tags: ['logic'] }, () => {
      it('recognises an entity ref', () => {
        expect(
          isEntityComponentReference('platform.entity.account'),
        ).toBe(true);
      });

      it('rejects an internal-ref or null/undefined', { tags: ['edge-case'] }, () => {
        expect(
          isEntityComponentReference('platform.workflow.create_user.org'),
        ).toBe(false);
        expect(isEntityComponentReference(null)).toBe(false);
        expect(isEntityComponentReference(undefined)).toBe(false);
        expect(isEntityComponentReference('')).toBe(false);
      });
    });

    describe('parseWorkflowInternalRef', { tags: ['logic'] }, () => {
      it('extracts the internal-attribute name when ref matches workflow', () => {
        expect(
          parseWorkflowInternalRef(
            'platform.workflow.create_user.address',
            'create_user',
          ),
        ).toBe('address');
      });

      it(
        'returns null when ref points at a different workflow',
        { tags: ['edge-case'] },
        () => {
          expect(
            parseWorkflowInternalRef(
              'platform.workflow.other_workflow.address',
              'create_user',
            ),
          ).toBeNull();
        },
      );

      it('returns null on entity refs or empty input', { tags: ['edge-case'] }, () => {
        expect(
          parseWorkflowInternalRef('platform.entity.account', 'create_user'),
        ).toBeNull();
        expect(parseWorkflowInternalRef(null, 'create_user')).toBeNull();
        expect(parseWorkflowInternalRef('', 'create_user')).toBeNull();
      });
    });

    describe('attrTsType', { tags: ['important', 'logic'] }, () => {
      const wf: WorkflowDefinition = { name: 'create_user', attributes: [] };
      const ctx = buildResolverContext(wf);

      it('scalar strings map to `string`', () => {
        expect(
          attrTsType(
            { name: 'email', type: 'string' },
            ctx,
            1,
            new Set(),
          ),
        ).toBe('string');
        expect(
          attrTsType({ name: 'note', type: 'text' }, ctx, 1, new Set()),
        ).toBe('string');
      });

      it('scalar numbers map to `number`', () => {
        expect(
          attrTsType({ name: 'age', type: 'integer' }, ctx, 1, new Set()),
        ).toBe('number');
        expect(
          attrTsType({ name: 'amount', type: 'currency' }, ctx, 1, new Set()),
        ).toBe('number');
      });

      it('boolean / checkbox map to `boolean`', () => {
        expect(
          attrTsType({ name: 'active', type: 'boolean' }, ctx, 1, new Set()),
        ).toBe('boolean');
        expect(
          attrTsType({ name: 'opt_in', type: 'checkbox' }, ctx, 1, new Set()),
        ).toBe('boolean');
      });

      it(
        'object with entity reference collapses to `{ id: string }`',
        { tags: ['important'] },
        () => {
          // Mirrors the `create_user` example: `orgId: { id: '...' }`.
          expect(
            attrTsType(
              {
                name: 'orgId',
                type: 'object',
                component_reference: 'platform.entity.org',
              },
              ctx,
              1,
              new Set(),
            ),
          ).toBe('{ id: string }');
        },
      );

      it(
        'array of entity references collapses to `{ id: string }[]`',
        { tags: ['important'] },
        () => {
          // Mirrors `roleIds: [{ id }, { id }, ...]`.
          expect(
            attrTsType(
              {
                name: 'roleIds',
                type: 'array',
                component_reference: 'platform.entity.role',
              },
              ctx,
              1,
              new Set(),
            ),
          ).toBe('{ id: string }[]');
        },
      );

      it(
        'object without resolvable internal falls back to Record<string, unknown>',
        { tags: ['edge-case'] },
        () => {
          expect(
            attrTsType(
              { name: 'opaque', type: 'object' },
              ctx,
              1,
              new Set(),
            ),
          ).toBe('Record<string, unknown>');
        },
      );

      it(
        'array without resolvable element falls back to unknown[]',
        { tags: ['edge-case'] },
        () => {
          expect(
            attrTsType(
              { name: 'opaque', type: 'array' },
              ctx,
              1,
              new Set(),
            ),
          ).toBe('unknown[]');
        },
      );

      it('unknown type maps to `unknown`', () => {
        expect(
          attrTsType(
            { name: 'mystery', type: 'invented_type' },
            ctx,
            1,
            new Set(),
          ),
        ).toBe('unknown');
      });
    });

    describe(
      'attrTsType — resolves internal refs',
      { tags: ['important', 'logic'] },
      () => {
        it('walks a workflow.internal ref to an inline object', () => {
          const wf: WorkflowDefinition = {
            name: 'create_user',
            attributes: [
              {
                name: 'address',
                attributeType: 'internal',
                attributes: [
                  { name: 'street', type: 'string', required: true },
                  { name: 'zip', type: 'string' },
                ],
              },
            ],
          };
          const ctx = buildResolverContext(wf);
          const result = attrTsType(
            {
              name: 'mailingAddress',
              type: 'object',
              component_reference: 'platform.workflow.create_user.address',
            },
            ctx,
            1,
            new Set(),
          );
          expect(result).toContain('street: string;');
          expect(result).toContain('zip?: string;');
        });
      },
    );

    describe(
      'attrTsType — cross-component refs (PHX-3832 user fixtures)',
      { tags: ['important', 'logic'] },
      () => {
        // Fixture for the `describeSObjects` partner-module whose
        // responseStructure is referenced by salesforce_composit_example.
        const describeSObjects: ComponentDefinition = {
          name: 'describeSObjects',
          app_definition_key:
            'partner_module_salesforceapisv3_69fb4d07bfb5aa759bc338f1',
          attributes: [
            {
              name: 'responseStructure',
              attributeType: 'internal',
              attributes: [
                { name: 'objects', type: 'array', attributeType: 'output' },
                {
                  name: 'maxBatchSize',
                  type: 'integer',
                  attributeType: 'output',
                },
              ],
            },
          ],
        };

        const index = buildComponentIndex({
          partnerModules: [describeSObjects],
        });

        it(
          'resolves a partner-module responseStructure ref to its inner attributes',
          { tags: ['important'] },
          () => {
            const wf: WorkflowDefinition = {
              name: 'salesforce_composit_example',
              attributes: [],
            };
            const ctx = buildResolverContext(wf, index);
            const result = attrTsType(
              {
                name: 'resp',
                type: 'object',
                attributeType: 'output',
                component_reference:
                  'partner_module_salesforceapisv3_69fb4d07bfb5aa759bc338f1.partner_module_request.describeSObjects.responseStructure',
              },
              ctx,
              1,
              new Set(),
            );
            // Inner attributes from responseStructure show through.
            expect(result).toContain('objects?: unknown[];');
            expect(result).toContain('maxBatchSize?: number;');
            // Crucially, no fallback to Record<string, unknown>.
            expect(result).not.toBe('Record<string, unknown>');
          },
        );

        it(
          'falls back to Record<string, unknown> when target component is missing from the index',
          { tags: ['edge-case'] },
          () => {
            const wf: WorkflowDefinition = { name: 'wf', attributes: [] };
            const ctx = buildResolverContext(wf, index);
            const result = attrTsType(
              {
                name: 'resp',
                type: 'object',
                attributeType: 'output',
                component_reference:
                  'app.partner_module_request.unknownModule.responseStructure',
              },
              ctx,
              1,
              new Set(),
            );
            expect(result).toBe('Record<string, unknown>');
          },
        );

        it(
          'falls back to unknown[] for array type when ref unresolved',
          { tags: ['edge-case'] },
          () => {
            const wf: WorkflowDefinition = { name: 'wf', attributes: [] };
            const ctx = buildResolverContext(wf);
            const result = attrTsType(
              {
                name: 'rows',
                type: 'array',
                attributeType: 'output',
                component_reference:
                  'app.partner_module_request.nope.responseStructure',
              },
              ctx,
              1,
              new Set(),
            );
            expect(result).toBe('unknown[]');
          },
        );

        it(
          'falls back when no component index supplied (EMPTY_COMPONENT_INDEX default)',
          () => {
            const wf: WorkflowDefinition = { name: 'wf', attributes: [] };
            const ctx = buildResolverContext(wf); // no index
            const result = attrTsType(
              {
                name: 'resp',
                type: 'object',
                attributeType: 'output',
                component_reference:
                  'app.partner_module_request.describeSObjects.responseStructure',
              },
              ctx,
              1,
              new Set(),
            );
            // Without an index, cross-component path is dormant.
            expect(result).toBe('Record<string, unknown>');
          },
        );
      },
    );

    describe(
      'attrTsType + catalog — `count` workflow fixture (PHX-3832 user JSON)',
      { tags: ['important', 'logic'] },
      () => {
        // Mirror the user-pasted JSON exactly:
        //   workflow `count` has one output `result: object` whose
        //   component_reference points at the saved-query
        //   `get_client_kpi.responseStructure`.
        //   `get_client_kpi` itself is a saved-query whose response is
        //   the top-level `output` attribute `client_aggregate: object`
        //   containing `{ ID: integer }`. There is NO literal `internal`
        //   named `responseStructure` on the saved-query side — that's
        //   the reason today's codegen emits `Record<string, unknown>`,
        //   which this test guards against.
        const getClientKpi: ComponentDefinition = {
          name: 'get_client_kpi',
          app_definition_key: 'wealthdomain_*',
          attributes: [
            {
              name: 'client_aggregate',
              type: 'object',
              attributeType: 'output',
              attributes: [{ name: 'ID', type: 'integer' }],
            },
          ],
        };
        const index = buildComponentIndex({
          savedQueries: [getClientKpi],
        });

        const countOutputAttr = {
          name: 'result',
          type: 'object',
          attributeType: 'output',
          component_reference:
            'wealthdomain__V0_0_943.saved-query.get_client_kpi.responseStructure',
        };

        it(
          'CountOutput resolves the saved-query response and unwraps to the inner shape',
          { tags: ['important'] },
          () => {
            const wf: WorkflowDefinition = {
              name: 'count',
              attributes: [],
            };
            const ctx = buildResolverContext(wf, index);
            // Single-output unwrap mirrors what fetch-workflows.ts does
            // before emitting `type CountOutput = <result>` — we call
            // attrTsType on the single output and assert the inner.
            const result = attrTsType(countOutputAttr, ctx, 1, new Set());
            // After unwrap: ID lives at the top level of the type.
            expect(result).toContain('ID?: number;');
            expect(result).not.toBe('Record<string, unknown>');
          },
        );

        it(
          'catalog: `count`s `result` output annotates the resolved-from ref',
          () => {
            const md = renderWorkflowCatalog([
              {
                name: 'count',
                label: 'count',
                description: '',
                appKey: 'testapp2508_*',
                inputs: [],
                outputs: [
                  {
                    name: 'result',
                    resolvedFrom:
                      'wealthdomain__V0_0_943.saved-query.get_client_kpi.responseStructure',
                  },
                ],
              },
            ]);
            expect(md).toContain(
              '`result` → resolved from `wealthdomain__V0_0_943.saved-query.get_client_kpi.responseStructure`',
            );
          },
        );

        it(
          'catalog: omits `resolved from` when the output has no source ref',
          () => {
            const md = renderWorkflowCatalog([
              {
                name: 'plain',
                label: '',
                description: '',
                appKey: '',
                inputs: [],
                outputs: [{ name: 'r' }],
              },
            ]);
            expect(md).toContain('`r`');
            expect(md).not.toContain('resolved from');
          },
        );
      },
    );

    describe(
      'attrTsType — testauth0 fixture (full workflow shape)',
      { tags: ['important', 'logic'] },
      () => {
        // From the user-pasted JSON: testauth0 has email/role inputs +
        // roleId (type 'any') output. Asserts that all three pass the
        // attribute filter and emit sensibly.
        it('emits both inputs (email, role) and the output (roleId: any → unknown)', () => {
          const wf: WorkflowDefinition = {
            name: 'testauth0',
            attributes: [
              { name: 'email', type: 'string', attributeType: 'input' },
              { name: 'role', type: 'string', attributeType: 'input' },
              { name: 'roleId', type: 'any', attributeType: 'output' },
            ],
          };
          const ctx = buildResolverContext(wf);
          // Input rendering — both fields land.
          const inputs = wf.attributes!.filter(
            (a) => a.attributeType === 'input',
          );
          const inputIface = renderInterface('Testauth0Input', inputs, ctx);
          expect(inputIface).toContain('email?: string;');
          expect(inputIface).toContain('role?: string;');
          // Output rendering — `any` collapses to unknown.
          const outputs = wf.attributes!.filter(
            (a) => a.attributeType === 'output',
          );
          const outputIface = renderInterface('Testauth0Output', outputs, ctx);
          expect(outputIface).toContain('roleId?: unknown;');
        });
      },
    );

    describe('renderInterface', { tags: ['smoke'] }, () => {
      it('emits required/optional fields and doc comments', () => {
        const wf: WorkflowDefinition = { name: 'x', attributes: [] };
        const ctx = buildResolverContext(wf);
        const out = renderInterface(
          'CreateUserInput',
          [
            { name: 'email', type: 'string', required: true, label: 'Email' },
            { name: 'age', type: 'integer' },
          ],
          ctx,
        );
        expect(out).toContain('export interface CreateUserInput {');
        expect(out).toContain('/** Email */');
        expect(out).toContain('email: string;');
        expect(out).toContain('age?: number;');
      });

      it(
        'falls back to index signature when no attributes declared',
        { tags: ['edge-case'] },
        () => {
          const wf: WorkflowDefinition = { name: 'x', attributes: [] };
          const ctx = buildResolverContext(wf);
          const out = renderInterface('EmptyShape', [], ctx);
          expect(out).toContain('[key: string]: unknown;');
        },
      );
    });

    describe('renderWorkflowCatalog', { tags: ['important'] }, () => {
      it('renders an empty placeholder when no workflows', () => {
        const md = renderWorkflowCatalog([]);
        expect(md).toContain('# Workflows Catalog');
        expect(md).toContain('No workflows available');
      });

      it('renders entries sorted alphabetically', () => {
        const md = renderWorkflowCatalog([
          {
            name: 'b_workflow',
            label: 'B Workflow',
            description: 'Second',
            appKey: 'platform',
            inputs: [{ name: 'x', required: true }],
            outputs: [{ name: 'result' }],
          },
          {
            name: 'a_workflow',
            label: '',
            description: '',
            appKey: '',
            inputs: [],
            outputs: [],
          },
        ]);
        const aIdx = md.indexOf('a_workflow');
        const bIdx = md.indexOf('b_workflow');
        expect(aIdx).toBeGreaterThan(0);
        expect(bIdx).toBeGreaterThan(aIdx);
      });

      it('emits useWorkflow hook line for sync workflows', () => {
        const md = renderWorkflowCatalog([
          {
            name: 'create_user',
            label: 'Create User',
            description: 'Creates a user.',
            appKey: 'platform',
            inputs: [{ name: 'email', required: true }],
            outputs: [{ name: 'user' }],
          },
        ]);
        expect(md).toContain('useWorkflow("create_user")');
        expect(md).toContain('`email` (required)');
        expect(md).toContain('Creates a user.');
      });

      it(
        'marks async workflows as skipped (V1 sync-only)',
        { tags: ['edge-case'] },
        () => {
          const md = renderWorkflowCatalog([
            {
              name: 'long_running',
              label: '',
              description: 'Runs for a while.',
              appKey: '',
              inputs: [],
              outputs: [],
              isAsyncSkipped: true,
            },
          ]);
          expect(md).toContain('async workflow');
          expect(md).toContain('Skipped');
          expect(md).not.toContain('useWorkflow("long_running")');
        },
      );

      it(
        'shows _(none)_ for empty inputs/outputs',
        { tags: ['edge-case'] },
        () => {
          const md = renderWorkflowCatalog([
            {
              name: 'no_io',
              label: '',
              description: '',
              appKey: '',
              inputs: [],
              outputs: [],
            },
          ]);
          expect(md).toContain('**Inputs:** _(none)_');
          expect(md).toContain('**Outputs:** _(none)_');
        },
      );

      it(
        'surfaces tags when present',
        { tags: ['important'] },
        () => {
          const md = renderWorkflowCatalog([
            {
              name: 'sr_intake',
              label: 'SR Intake',
              description: '',
              appKey: '',
              inputs: [],
              outputs: [],
              tags: ['Service Request'],
            },
          ]);
          expect(md).toContain('**Tags:** `Service Request`');
        },
      );

      it(
        'shows tags even for async-skipped workflows',
        { tags: ['edge-case'] },
        () => {
          const md = renderWorkflowCatalog([
            {
              name: 'sr_async',
              label: '',
              description: '',
              appKey: '',
              inputs: [],
              outputs: [],
              isAsyncSkipped: true,
              tags: ['Service Request'],
            },
          ]);
          expect(md).toContain('Skipped');
          expect(md).toContain('**Tags:** `Service Request`');
        },
      );
    });
  },
);
