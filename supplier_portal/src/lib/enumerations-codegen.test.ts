import { describe, it, expect } from 'vitest';
import {
  buildEnumerationLookup,
  enumClassName,
  enumConstName,
  enumFileStem,
  normaliseEnumeration,
  renderEnumerationFile,
  renderEnumerationsBarrelFile,
  renderEnumerationsGeneratedFile,
} from './enumerations-codegen';

describe(
  'enumerations-codegen',
  { tags: ['enumeration', 'logic'] },
  () => {
    describe('enumClassName / enumConstName / enumFileStem', { tags: ['smoke'] }, () => {
      it('PascalCases snake_case', () => {
        expect(enumClassName('account_type')).toBe('AccountType');
        expect(enumClassName('user_role')).toBe('UserRole');
      });

      it('handles kebab and whitespace', () => {
        expect(enumClassName('account-type')).toBe('AccountType');
        expect(enumClassName('account type')).toBe('AccountType');
      });

      it('uppercases snake_case', () => {
        expect(enumConstName('account_type')).toBe('ACCOUNT_TYPE');
        expect(enumConstName('user-role')).toBe('USER_ROLE');
      });

      it('flattens the filename stem to a filesystem-safe slug', () => {
        expect(enumFileStem('account_type')).toBe('account_type');
        // Spaces / other non-[A-Za-z0-9_-] chars collapse to `_` so the
        // import path + filename stay valid (no nested dirs).
        expect(enumFileStem('with spaces')).toBe('with_spaces');
      });

      it(
        'sanitises non-identifier characters in enum names (the `/` bug)',
        { tags: ['important', 'edge-case'] },
        () => {
          // Real Phoenix enum: `AccountTypeOptions_Corporate/Business`. The `/`
          // must never reach an emitted identifier or a file path.
          const raw = 'AccountTypeOptions_Corporate/Business';
          expect(enumClassName(raw)).toBe('AccountTypeOptionsCorporateBusiness');
          expect(enumConstName(raw)).toBe(
            'ACCOUNTTYPEOPTIONS_CORPORATE_BUSINESS',
          );
          expect(enumFileStem(raw)).toBe('AccountTypeOptions_Corporate_Business');
          // No `/` survives anywhere.
          expect(enumClassName(raw)).not.toMatch(/\//);
          expect(enumConstName(raw)).not.toMatch(/\//);
          expect(enumFileStem(raw)).not.toMatch(/\//);
        },
      );

      it(
        'handles dots and prefixes a leading digit to keep identifiers valid',
        { tags: ['edge-case'] },
        () => {
          expect(enumClassName('foo.bar')).toBe('FooBar');
          expect(enumConstName('foo.bar')).toBe('FOO_BAR');
          // Leading digit would be an invalid identifier — prefixed with `_`.
          expect(enumClassName('2fa_method')).toBe('_2faMethod');
          expect(enumConstName('2fa_method')).toBe('_2FA_METHOD');
        },
      );

      it(
        'falls back to `_`-mapped identifiers for names with no alphanumerics (the `_` enum bug)',
        { tags: ['important', 'edge-case'] },
        () => {
          // Real tenant enum literally named `_`: word-splitting yields no
          // parts, which used to emit an EMPTY identifier
          // (`export type  = never;` — a TS syntax error).
          expect(enumClassName('_')).toBe('_');
          expect(enumConstName('_')).toBe('_');
          expect(enumFileStem('_')).toBe('_');
          // Distinct all-symbol names stay distinct.
          expect(enumClassName('--')).toBe('__');
          expect(enumConstName('- ')).toBe('__');
          // Never empty.
          expect(enumClassName('_')).not.toBe('');
          expect(enumConstName('_')).not.toBe('');
        },
      );
    });

    describe('normaliseEnumeration', { tags: ['logic'] }, () => {
      it('returns null for entries without a name', { tags: ['edge-case'] }, () => {
        expect(normaliseEnumeration(null)).toBeNull();
        expect(normaliseEnumeration(undefined)).toBeNull();
        expect(normaliseEnumeration({ name: '' })).toBeNull();
        expect(normaliseEnumeration({ name: undefined as unknown as string })).toBeNull();
      });

      it('extracts values[] when present', { tags: ['smoke'] }, () => {
        expect(
          normaliseEnumeration({
            name: 'account_type',
            values: ['Individual', 'Joint', 'Trust'],
          }),
        ).toEqual({
          name: 'account_type',
          values: ['Individual', 'Joint', 'Trust'],
        });
      });

      it(
        'falls back to allowedValues[] when values[] is empty',
        { tags: ['logic'] },
        () => {
          expect(
            normaliseEnumeration({
              name: 'status',
              values: [],
              allowedValues: ['Open', 'Closed'],
            }),
          ).toEqual({ name: 'status', values: ['Open', 'Closed'] });
        },
      );

      it(
        'falls back to items[].value when neither values[] nor allowedValues[] is set',
        { tags: ['logic'] },
        () => {
          expect(
            normaliseEnumeration({
              name: 'priority',
              items: [
                { value: 'low', label: 'Low' },
                { value: 'high', label: 'High' },
              ],
            }),
          ).toEqual({ name: 'priority', values: ['low', 'high'] });
        },
      );

      it(
        'returns empty values when none of the sources have any',
        { tags: ['edge-case'] },
        () => {
          expect(
            normaliseEnumeration({
              name: 'empty_enum',
              values: [],
              allowedValues: [],
              items: [],
            }),
          ).toEqual({ name: 'empty_enum', values: [] });
        },
      );

      it(
        'de-dupes values while preserving first-seen order',
        { tags: ['edge-case'] },
        () => {
          expect(
            normaliseEnumeration({
              name: 'dups',
              values: ['A', 'B', 'A', 'C', 'B'],
            }),
          ).toEqual({ name: 'dups', values: ['A', 'B', 'C'] });
        },
      );

      it(
        'skips non-string and empty-string members',
        { tags: ['edge-case'] },
        () => {
          expect(
            normaliseEnumeration({
              name: 'mixed',
              values: ['A', '', 'B', null as unknown as string, undefined as unknown as string, 'C'],
            }),
          ).toEqual({ name: 'mixed', values: ['A', 'B', 'C'] });
        },
      );
    });

    describe('renderEnumerationFile', { tags: ['logic'] }, () => {
      it(
        'emits as-const array + typeof union for non-empty values',
        { tags: ['important'] },
        () => {
          const out = renderEnumerationFile('account_type', [
            'Individual',
            'Joint',
            'Trust',
          ]);
          expect(out.name).toBe('account_type');
          expect(out.pascal).toBe('AccountType');
          expect(out.values).toEqual(['Individual', 'Joint', 'Trust']);
          expect(out.source).toContain(
            'export const ACCOUNT_TYPE_VALUES = [',
          );
          expect(out.source).toContain('"Individual"');
          expect(out.source).toContain('"Joint"');
          expect(out.source).toContain('"Trust"');
          expect(out.source).toContain('] as const;');
          expect(out.source).toContain(
            'export type AccountType = typeof ACCOUNT_TYPE_VALUES[number];',
          );
        },
      );

      it(
        'emits empty array + never type when values are absent',
        { tags: ['edge-case'] },
        () => {
          const out = renderEnumerationFile('empty_enum', []);
          expect(out.source).toContain(
            'export const EMPTY_ENUM_VALUES = [] as const;',
          );
          expect(out.source).toContain('export type EmptyEnum = never;');
          expect(out.source).toContain('(no values declared)');
        },
      );

      it(
        'emits valid identifiers for a `/`-containing enum name (the reported bug)',
        { tags: ['important', 'edge-case'] },
        () => {
          const out = renderEnumerationFile(
            'AccountTypeOptions_Corporate/Business',
            [],
          );
          // Before the fix this emitted `…CORPORATE/BUSINESS_VALUES` (ts7005).
          expect(out.source).toContain(
            'export const ACCOUNTTYPEOPTIONS_CORPORATE_BUSINESS_VALUES = [] as const;',
          );
          expect(out.source).toContain(
            'export type AccountTypeOptionsCorporateBusiness = never;',
          );
          // The raw name (with `/`) only ever appears in the comment header.
          expect(out.source).not.toMatch(/^export .*\//m);
        },
      );

      it(
        'emits valid identifiers for an enum literally named `_` (empty-identifier bug)',
        { tags: ['important', 'edge-case'] },
        () => {
          const out = renderEnumerationFile('_', []);
          // Before the fix: `export const _VALUES = [] as const;` +
          // `export type  = never;` — the type name was EMPTY (TS1005).
          expect(out.source).toContain('export const __VALUES = [] as const;');
          expect(out.source).toContain('export type _ = never;');
          // No empty identifier anywhere.
          expect(out.source).not.toMatch(/^export type\s*=/m);
          expect(out.pascal).toBe('_');
        },
      );

      it('escapes special characters via JSON.stringify', { tags: ['edge-case'] }, () => {
        const out = renderEnumerationFile('quoted', ["O'Brien", 'with "quote"']);
        expect(out.source).toContain('"O\'Brien"');
        expect(out.source).toContain('"with \\"quote\\""');
      });
    });

    describe(
      'renderEnumerationsBarrelFile',
      { tags: ['logic'] },
      () => {
        it(
          'emits one export-star per enum, sorted alphabetically',
          { tags: ['smoke'] },
          () => {
            const md = renderEnumerationsBarrelFile([
              renderEnumerationFile('zebra', ['A'], 'wd'),
              renderEnumerationFile('alpha', ['B'], 'wd'),
              renderEnumerationFile('mango', ['C'], 'wd'),
            ]);
            const exports = md.match(/^export \* from '\.\/([^']+)';$/gm);
            expect(exports).toEqual([
              "export * from './wd/alpha';",
              "export * from './wd/mango';",
              "export * from './wd/zebra';",
            ]);
          },
        );

        it('handles empty input', { tags: ['edge-case'] }, () => {
          const md = renderEnumerationsBarrelFile([]);
          expect(md).toContain('AUTO-GENERATED');
          expect(md).not.toContain('export * from');
        });
      },
    );

    describe(
      'renderEnumerationsGeneratedFile',
      { tags: ['logic'] },
      () => {
        it(
          'empty input → stub with never type and {} record',
          { tags: ['important'] },
          () => {
            const out = renderEnumerationsGeneratedFile([]);
            expect(out).toContain('export type EnumerationName = never;');
            expect(out).toContain(
              'export const ENUMERATION_VALUES: Record<string, readonly string[]> = {};',
            );
            expect(out).toContain(
              'export type EnumerationValuesOf<_N extends EnumerationName> = never;',
            );
          },
        );

        it(
          'populated input → typed union + as-const lookup map',
          { tags: ['important'] },
          () => {
            const out = renderEnumerationsGeneratedFile([
              renderEnumerationFile('status', ['Open', 'Closed'], 'wd'),
              renderEnumerationFile('account_type', ['Individual', 'Joint'], 'wd'),
            ]);
            expect(out).toContain(
              "import { ACCOUNT_TYPE_VALUES } from './enumerations/wd/account_type';",
            );
            expect(out).toContain(
              "import { STATUS_VALUES } from './enumerations/wd/status';",
            );
            expect(out).toContain(
              'export type EnumerationName = "account_type" | "status";',
            );
            expect(out).toContain('"account_type": ACCOUNT_TYPE_VALUES');
            expect(out).toContain('"status": STATUS_VALUES');
            expect(out).toContain(
              'export type EnumerationValuesOf<N extends EnumerationName>',
            );
            expect(out).toContain('typeof ENUMERATION_VALUES[N][number];');
          },
        );
      },
    );

    describe('buildEnumerationLookup', { tags: ['smoke'] }, () => {
      it('produces a name→values map', () => {
        const lookup = buildEnumerationLookup([
          renderEnumerationFile('status', ['Open', 'Closed']),
          renderEnumerationFile('account_type', ['Individual', 'Joint']),
        ]);
        expect(lookup.get('status')).toEqual(['Open', 'Closed']);
        expect(lookup.get('account_type')).toEqual(['Individual', 'Joint']);
        expect(lookup.get('unknown')).toBeUndefined();
      });

      it('empty input → empty map', { tags: ['edge-case'] }, () => {
        expect(buildEnumerationLookup([]).size).toBe(0);
      });
    });
  },
);
