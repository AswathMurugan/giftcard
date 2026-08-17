import { describe, it, expect } from 'vitest';
import {
  attrTsType,
  buildPartnerCategoryMethodUrl,
  buildPartnerModuleBody,
  buildPartnerModuleUrl,
  buildResolverContext,
  DEFAULT_PARTNER_MODULE_VARIANT,
  isPartnerModuleEntityRef,
  parsePartnerModuleInternalRef,
  partnerModuleConstCase,
  partnerModuleFileStem,
  partnerModuleNeedsQuotedKey,
  partnerModulePascalCase,
  partnerModuleQuoteKey,
  partnerModuleSafeIdent,
  renderInterface,
  renderPartnerModuleCatalog,
  renderPartnerModuleExecuteHeadersLine,
  type PartnerModuleDefinition,
} from './partner-modules-codegen';
import {
  buildComponentIndex,
  type ComponentDefinition,
} from './cross-component-refs';

describe(
  'partner-modules-codegen',
  { tags: ['partner-module', 'codegen', 'logic'] },
  () => {
    describe('naming helpers', { tags: ['smoke'] }, () => {
      it('partnerModulePascalCase converts to PascalCase', () => {
        expect(partnerModulePascalCase('addausertoagroup')).toBe('Addausertoagroup');
        expect(partnerModulePascalCase('send-notification')).toBe(
          'SendNotification',
        );
        expect(partnerModulePascalCase('get_performance_summary')).toBe(
          'GetPerformanceSummary',
        );
        expect(partnerModulePascalCase('')).toBe('');
      });

      it('partnerModuleConstCase converts to UPPER_SNAKE', () => {
        expect(partnerModuleConstCase('addausertoagroup')).toBe(
          'ADDAUSERTOAGROUP',
        );
        expect(partnerModuleConstCase('send-notification')).toBe(
          'SEND_NOTIFICATION',
        );
      });

      it('partnerModuleFileStem preserves canonical name', () => {
        expect(partnerModuleFileStem('addausertoagroup')).toBe(
          'addausertoagroup',
        );
        expect(partnerModuleFileStem('send-notification')).toBe(
          'send-notification',
        );
      });

      it(
        'partnerModuleNeedsQuotedKey detects when a key must be quoted',
        { tags: ['edge-case'] },
        () => {
          expect(partnerModuleNeedsQuotedKey('clean')).toBe(false);
          expect(partnerModuleNeedsQuotedKey('with-dash')).toBe(true);
          expect(partnerModuleNeedsQuotedKey('1leading')).toBe(true);
        },
      );

      it('partnerModuleQuoteKey quotes only when required', () => {
        expect(partnerModuleQuoteKey('clean')).toBe('clean');
        expect(partnerModuleQuoteKey('with-dash')).toBe('"with-dash"');
      });

      it(
        'partnerModuleSafeIdent replaces non-ident chars with underscore',
        { tags: ['edge-case'] },
        () => {
          expect(partnerModuleSafeIdent('add-a-user!')).toBe('add_a_user_');
          expect(partnerModuleSafeIdent('foo.bar')).toBe('foo_bar');
        },
      );
    });

    describe(
      'buildPartnerModuleUrl',
      { tags: ['important', 'logic'] },
      () => {
        it('defaults variant to "default" when omitted', () => {
          // Matches the user's example: api/proxy/addausertoagroup/default
          expect(buildPartnerModuleUrl('addausertoagroup')).toBe(
            '/api/proxy/addausertoagroup/default',
          );
        });

        it('honours an explicit variant', () => {
          expect(
            buildPartnerModuleUrl('addausertoagroup', 'sandbox'),
          ).toBe('/api/proxy/addausertoagroup/sandbox');
        });

        it('treats empty/null variant as the default', { tags: ['edge-case'] }, () => {
          expect(buildPartnerModuleUrl('addausertoagroup', '')).toBe(
            '/api/proxy/addausertoagroup/default',
          );
          expect(buildPartnerModuleUrl('addausertoagroup', null)).toBe(
            '/api/proxy/addausertoagroup/default',
          );
        });

        it('URL-encodes module name and variant defensively', { tags: ['edge-case'] }, () => {
          expect(buildPartnerModuleUrl('a b', 'c d')).toBe(
            '/api/proxy/a%20b/c%20d',
          );
        });

        it('throws on empty/non-string name', { tags: ['edge-case'] }, () => {
          expect(() => buildPartnerModuleUrl('')).toThrow(/non-empty/);
        });

        it('exports the default variant constant', () => {
          expect(DEFAULT_PARTNER_MODULE_VARIANT).toBe('default');
        });
      },
    );

    describe(
      'buildPartnerCategoryMethodUrl',
      { tags: ['important', 'logic'] },
      () => {
        it('builds the canonical category-method URL', () => {
          // Matches the user's example:
          // api/proxy/execute-partner-category/portfolio-management/getPerformanceSummary
          expect(
            buildPartnerCategoryMethodUrl(
              'portfolio-management',
              'getPerformanceSummary',
            ),
          ).toBe(
            '/api/proxy/execute-partner-category/portfolio-management/getPerformanceSummary',
          );
        });

        it('URL-encodes both segments defensively', { tags: ['edge-case'] }, () => {
          expect(buildPartnerCategoryMethodUrl('cat one', 'method two')).toBe(
            '/api/proxy/execute-partner-category/cat%20one/method%20two',
          );
        });

        it('throws on empty category or method', { tags: ['edge-case'] }, () => {
          expect(() => buildPartnerCategoryMethodUrl('', 'm')).toThrow(/non-empty/);
          expect(() => buildPartnerCategoryMethodUrl('c', '')).toThrow(/non-empty/);
        });
      },
    );

    describe(
      'renderPartnerModuleExecuteHeadersLine',
      { tags: ['important', 'logic'] },
      () => {
        // PHX-3832 regression: emitted line must wrap `||` half in
        // parens to avoid TS5076.
        it(
          'emits parens around `PREFIX_APP_KEY || undefined` (TS5076 guard)',
          { tags: ['important'] },
          () => {
            const line = renderPartnerModuleExecuteHeadersLine(
              'ADDAUSERTOAGROUP',
            );
            expect(line).toContain(
              '?? (ADDAUSERTOAGROUP_APP_KEY || undefined)',
            );
            expect(line).not.toMatch(
              /\?\?\s*ADDAUSERTOAGROUP_APP_KEY\s+\|\|\s+undefined/,
            );
          },
        );

        it(
          'uses getDataHeadersWithUser so X-Jiffy-User-Id is stamped',
          { tags: ['important'] },
          () => {
            // Partner-module / partner-category proxy calls require
            // the requesting user's id on every request — the
            // `WithUser` variant of the headers helper adds
            // `X-Jiffy-User-Id` from the current JWT.
            const line = renderPartnerModuleExecuteHeadersLine(
              'ADDAUSERTOAGROUP',
            );
            expect(line).toContain('getDataHeadersWithUser(');
            expect(line).not.toMatch(/getDataHeaders\(/);
          },
        );

        it('emits the full canonical line shape', () => {
          expect(
            renderPartnerModuleExecuteHeadersLine('ADDAUSERTOAGROUP'),
          ).toBe(
            '  const headers = getDataHeadersWithUser(options?.appDefinitionKey ?? (ADDAUSERTOAGROUP_APP_KEY || undefined));',
          );
        });

        it('throws on empty / non-string prefix', { tags: ['edge-case'] }, () => {
          expect(() => renderPartnerModuleExecuteHeadersLine('')).toThrow(
            /non-empty/,
          );
        });
      },
    );

    describe(
      'buildPartnerModuleBody',
      { tags: ['important', 'logic'] },
      () => {
        it(
          'wraps a flat input in the `inputs` envelope (NOT `body`)',
          { tags: ['important'] },
          () => {
            // The Phoenix proxy contract requires `{ inputs: ... }`.
            // Earlier draft used `{ body: ... }` — explicitly guard
            // against that regression.
            const input = { account_id: 'A', partnerModuleName: 'B' };
            const result = buildPartnerModuleBody(input);
            expect(result).toEqual({
              inputs: { account_id: 'A', partnerModuleName: 'B' },
            });
            expect((result as Record<string, unknown>).body).toBeUndefined();
          },
        );

        it('preserves input reference identity inside the envelope', () => {
          const input = { a: 1 };
          const result = buildPartnerModuleBody(input);
          expect(result.inputs).toBe(input);
        });

        it('returns { inputs: {} } for null / undefined / non-object', { tags: ['edge-case'] }, () => {
          expect(buildPartnerModuleBody(null)).toEqual({ inputs: {} });
          expect(buildPartnerModuleBody(undefined)).toEqual({ inputs: {} });
          expect(buildPartnerModuleBody('string')).toEqual({ inputs: {} });
          expect(buildPartnerModuleBody(42)).toEqual({ inputs: {} });
          expect(buildPartnerModuleBody([1, 2])).toEqual({ inputs: {} });
        });

        it('passes empty object through as inputs: {}', { tags: ['edge-case'] }, () => {
          const input = {};
          const result = buildPartnerModuleBody(input);
          expect(result.inputs).toBe(input);
        });
      },
    );

    describe('isPartnerModuleEntityRef', { tags: ['logic'] }, () => {
      it('recognises entity refs and rejects others', () => {
        expect(isPartnerModuleEntityRef('platform.entity.account')).toBe(true);
        expect(
          isPartnerModuleEntityRef('platform.partner_module_request.foo.bar'),
        ).toBe(false);
        expect(isPartnerModuleEntityRef(null)).toBe(false);
        expect(isPartnerModuleEntityRef(undefined)).toBe(false);
        expect(isPartnerModuleEntityRef('')).toBe(false);
      });
    });

    describe('parsePartnerModuleInternalRef', { tags: ['logic'] }, () => {
      it('accepts both ".partner_module_request." and ".partner-module." forms', () => {
        expect(
          parsePartnerModuleInternalRef(
            'platform.partner_module_request.addausertoagroup.address',
            'addausertoagroup',
          ),
        ).toBe('address');
        expect(
          parsePartnerModuleInternalRef(
            'platform.partner-module.addausertoagroup.address',
            'addausertoagroup',
          ),
        ).toBe('address');
      });

      it('returns null when ref points at a different module', { tags: ['edge-case'] }, () => {
        expect(
          parsePartnerModuleInternalRef(
            'platform.partner_module_request.other.address',
            'addausertoagroup',
          ),
        ).toBeNull();
      });
    });

    describe('attrTsType', { tags: ['important', 'logic'] }, () => {
      const pm: PartnerModuleDefinition = { name: 'mod', attributes: [] };
      const ctx = buildResolverContext(pm);

      it('scalars map correctly', () => {
        expect(attrTsType({ name: 'n', type: 'string' }, ctx, 1, new Set())).toBe('string');
        expect(attrTsType({ name: 'n', type: 'integer' }, ctx, 1, new Set())).toBe('number');
        expect(attrTsType({ name: 'n', type: 'currency' }, ctx, 1, new Set())).toBe('number');
        expect(attrTsType({ name: 'n', type: 'boolean' }, ctx, 1, new Set())).toBe('boolean');
      });

      it(
        'entity refs collapse to { id: string } / { id: string }[]',
        { tags: ['important'] },
        () => {
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

      it('unknown type maps to `unknown`', { tags: ['edge-case'] }, () => {
        expect(
          attrTsType(
            { name: 'mystery', type: 'invented' },
            ctx,
            1,
            new Set(),
          ),
        ).toBe('unknown');
      });
    });

    describe(
      'attrTsType — cross-component refs (PHX-3832)',
      { tags: ['important', 'logic'] },
      () => {
        // A partner module that exposes a `responseStructure` referenced
        // by other components. Mirrors the structure of describeSObjects
        // from the user-pasted salesforce JSON.
        const otherModule: ComponentDefinition = {
          name: 'sibling_module',
          app_definition_key: 'partner_module_app',
          attributes: [
            {
              name: 'responseStructure',
              attributeType: 'internal',
              attributes: [
                { name: 'ok', type: 'boolean', attributeType: 'output' },
                { name: 'id', type: 'string', attributeType: 'output' },
              ],
            },
          ],
        };

        // A saved query target — partner-module attributes may also
        // reference saved-query responseStructures.
        const sq: ComponentDefinition = {
          name: 'get_thing',
          app_definition_key: 'wealthdomain_app',
          attributes: [
            {
              name: 'responseStructure',
              attributeType: 'internal',
              attributes: [
                { name: 'name', type: 'string', attributeType: 'output' },
              ],
            },
          ],
        };

        const index = buildComponentIndex({
          partnerModules: [otherModule],
          savedQueries: [sq],
        });

        it(
          'resolves a cross-module ref to inner fields',
          { tags: ['important'] },
          () => {
            const pm: PartnerModuleDefinition = { name: 'caller', attributes: [] };
            const ctx = buildResolverContext(pm, index);
            const result = attrTsType(
              {
                name: 'resp',
                type: 'object',
                attributeType: 'output',
                component_reference:
                  'partner_module_app.partner_module_request.sibling_module.responseStructure',
              },
              ctx,
              1,
              new Set(),
            );
            expect(result).toContain('ok?: boolean;');
            expect(result).toContain('id?: string;');
          },
        );

        it('resolves a cross-module-to-saved-query ref', () => {
          const pm: PartnerModuleDefinition = { name: 'caller', attributes: [] };
          const ctx = buildResolverContext(pm, index);
          const result = attrTsType(
            {
              name: 'enrich',
              type: 'object',
              attributeType: 'output',
              component_reference:
                'wealthdomain_app.saved-query.get_thing.responseStructure',
            },
            ctx,
            1,
            new Set(),
          );
          expect(result).toContain('name?: string;');
        });

        it(
          'falls back to Record<string, unknown> when target missing',
          { tags: ['edge-case'] },
          () => {
            const pm: PartnerModuleDefinition = { name: 'caller', attributes: [] };
            const ctx = buildResolverContext(pm, index);
            const result = attrTsType(
              {
                name: 'opaque',
                type: 'object',
                attributeType: 'output',
                component_reference:
                  'app.partner_module_request.nope.responseStructure',
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
            const pm: PartnerModuleDefinition = { name: 'caller', attributes: [] };
            const ctx = buildResolverContext(pm);
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
      },
    );

    describe('renderInterface', { tags: ['smoke'] }, () => {
      it('emits required/optional fields and doc comments', () => {
        const pm: PartnerModuleDefinition = { name: 'mod', attributes: [] };
        const ctx = buildResolverContext(pm);
        const out = renderInterface(
          'AddUserToGroupInput',
          [
            { name: 'age', type: 'string', required: true, label: 'Age' },
            { name: 'amount', type: 'number' },
            { name: 'state', type: 'string' },
          ],
          ctx,
        );
        expect(out).toContain('export interface AddUserToGroupInput {');
        expect(out).toContain('/** Age */');
        expect(out).toContain('age: string;');
        expect(out).toContain('amount?: number;');
        expect(out).toContain('state?: string;');
      });
    });

    describe('renderPartnerModuleCatalog', { tags: ['important'] }, () => {
      it('renders an empty placeholder when no modules', () => {
        const md = renderPartnerModuleCatalog([]);
        expect(md).toContain('# Partner Modules Catalog');
        expect(md).toContain('No partner modules available');
      });

      it(
        'groups entries by category and resolves category labels',
        { tags: ['important'] },
        () => {
          const md = renderPartnerModuleCatalog(
            [
              {
                name: 'send_email',
                label: 'Send Email',
                description: 'Sends an email.',
                category: 'notifications',
                appKey: 'platform',
                variants: [],
                inputs: [{ name: 'to', required: true }],
                outputs: [{ name: 'messageId' }],
              },
              {
                name: 'verify_identity',
                label: 'Verify Identity',
                description: 'KYC verification.',
                category: 'identity',
                appKey: 'platform',
                variants: ['default', 'sandbox'],
                inputs: [{ name: 'ssn', required: true }],
                outputs: [{ name: 'ok' }],
              },
            ],
            [
              { name: 'notifications', label: 'Notifications' },
              { name: 'identity', label: 'Identity' },
            ],
          );
          // Two category sections, both present
          expect(md).toContain('## Identity');
          expect(md).toContain('## Notifications');
          // Identity section comes first (alpha-sorted by label).
          expect(md.indexOf('## Identity')).toBeLessThan(
            md.indexOf('## Notifications'),
          );
          // Entries listed under their categories.
          expect(md).toContain('verify_identity');
          expect(md).toContain('send_email');
          // Variants surfaced (each variant code-fenced and pipe-joined).
          expect(md).toContain("`'default'`");
          expect(md).toContain("`'sandbox'`");
          // Hook lines.
          expect(md).toContain('usePartnerModule("send_email")');
        },
      );

      it(
        'pins Uncategorised group last',
        { tags: ['edge-case'] },
        () => {
          const md = renderPartnerModuleCatalog(
            [
              {
                name: 'a_module',
                label: '',
                description: '',
                category: '',
                appKey: '',
                variants: [],
                inputs: [],
                outputs: [],
              },
              {
                name: 'b_module',
                label: '',
                description: '',
                category: 'identity',
                appKey: '',
                variants: [],
                inputs: [],
                outputs: [],
              },
            ],
            [{ name: 'identity', label: 'Identity' }],
          );
          expect(md.indexOf('## Identity')).toBeLessThan(
            md.indexOf('## Uncategorised'),
          );
        },
      );

      it(
        'surfaces default variant when none enumerated',
        { tags: ['edge-case'] },
        () => {
          const md = renderPartnerModuleCatalog(
            [
              {
                name: 'mod',
                label: '',
                description: '',
                category: '',
                appKey: '',
                variants: [],
                inputs: [],
                outputs: [],
              },
            ],
            [],
          );
          expect(md).toContain("'default'");
          expect(md).toContain('no variants enumerated');
        },
      );

      it(
        'annotates outputs with `resolved from` when resolvedFrom is set',
        { tags: ['important'] },
        () => {
          const md = renderPartnerModuleCatalog(
            [
              {
                name: 'enrich_account',
                label: '',
                description: '',
                category: '',
                appKey: '',
                variants: [],
                inputs: [],
                outputs: [
                  {
                    name: 'data',
                    resolvedFrom:
                      'wealthdomain__V0_0_943.saved-query.get_client_kpi.responseStructure',
                  },
                ],
              },
            ],
            [],
          );
          expect(md).toContain(
            '`data` → resolved from `wealthdomain__V0_0_943.saved-query.get_client_kpi.responseStructure`',
          );
        },
      );
    });
  },
);
