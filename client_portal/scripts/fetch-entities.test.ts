import { describe, it, expect } from 'vitest';
import {
  tsPropertyKey,
  entityClassName,
  computeCollidedEntityNames,
  renderFieldConstraints,
  dedupeFieldsByName,
} from './fetch-entities';
import type { Entity } from '../src/types/entity';

function makeEntity(fields: Entity['fields']): Entity {
  return { entityId: 'e', label: 'E', name: 'alert_inbox', fields };
}

describe('fetch-entities', { tags: ['entity', 'codegen', 'logic'] }, () => {
  describe('entityClassName', { tags: ['important'] }, () => {
    it('PascalCases snake/kebab/space separated names', () => {
      expect(entityClassName('user')).toBe('User');
      expect(entityClassName('user_role')).toBe('UserRole');
      expect(entityClassName('user-role')).toBe('UserRole');
      expect(entityClassName('user role')).toBe('UserRole');
    });

    // A TS identifier cannot start with a digit. Phoenix app keys can — the
    // tenant app `123aa_6a3d52e23440815cac51d012` emitted
    // `export type 123aa..._AddressFieldName`, a syntax error that broke the
    // ENTIRE generated file and every app in that workspace.
    it(
      'prefixes `_` when the name starts with a digit (invalid TS identifier)',
      { tags: ['important', 'edge-case'] },
      () => {
        expect(entityClassName('123aa_6a3d52e23440815cac51d012')).toBe(
          '_123aa6a3d52e23440815cac51d012',
        );
        expect(entityClassName('2024_returns')).toBe('_2024Returns');
        expect(entityClassName('1035_exchange')).toBe('_1035Exchange');
      },
    );

    it('leaves already-valid identifiers untouched', { tags: ['edge-case'] }, () => {
      expect(entityClassName('Account')).toBe('Account');
      // A leading `_` is a SEPARATOR, not part of the name — it is stripped by
      // the split, so no `_` prefix is added back (the result already starts
      // with a letter).
      expect(entityClassName('_internal')).toBe('Internal');
    });

    it('always returns a valid TS identifier', { tags: ['important'] }, () => {
      const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
      for (const raw of [
        'user',
        'user_role',
        '123aa_6a3d52e23440815cac51d012',
        '2024_returns',
        '9',
        '0_0',
      ]) {
        expect(entityClassName(raw)).toMatch(IDENT);
      }
    });
  });

  describe('computeCollidedEntityNames', { tags: ['important'] }, () => {
    it(
      'flags distinct raw names that normalise to the same identifier (the `entity_1`/`entity1` -> `Entity1` bug)',
      { tags: ['important', 'edge-case'] },
      () => {
        const collided = computeCollidedEntityNames([
          { name: 'entity_1' },
          { name: 'entity1' },
        ]);
        expect(collided.has('entity_1')).toBe(true);
        expect(collided.has('entity1')).toBe(true);
      },
    );

    it(
      'flags cross-app same-name entities (one raw name, two entities)',
      { tags: ['smoke'] },
      () => {
        const collided = computeCollidedEntityNames([
          { name: 'account' },
          { name: 'account' },
        ]);
        expect(collided.has('account')).toBe(true);
      },
    );

    it(
      'does NOT flag names with a unique emitted identifier',
      { tags: ['edge-case'] },
      () => {
        const collided = computeCollidedEntityNames([
          { name: 'account' },
          { name: 'client' },
          { name: 'entity_2' },
        ]);
        expect(collided.size).toBe(0);
      },
    );
  });

  describe('renderFieldConstraints', { tags: ['important'] }, () => {
    it(
      'emits required + constraints, skips fields with neither',
      { tags: ['smoke'] },
      () => {
        const out = renderFieldConstraints(
          makeEntity([
            { fieldId: '1', label: 'Id', name: 'id', type: 'UUID', required: true },
            {
              fieldId: '2',
              label: 'Alert Type',
              name: 'alert_type',
              type: 'Text',
              required: true,
              constraints: { maxLength: { value: '255' } },
            },
            // No required flag, no constraints — must be omitted.
            { fieldId: '3', label: 'Note', name: 'note', type: 'Text' },
          ]),
        ).join('\n');

        expect(out).toContain('export const ALERT_INBOX_FIELD_CONSTRAINTS = {');
        expect(out).toContain('id: { required: true },');
        expect(out).toContain(
          'alert_type: { required: true, constraints: { maxLength: { value: "255" } } },',
        );
        expect(out).not.toContain('note:');
        expect(out).toContain('} as const;');
      },
    );

    it(
      'returns [] when no field has metadata (const omitted)',
      { tags: ['edge-case'] },
      () => {
        const out = renderFieldConstraints(
          makeEntity([{ fieldId: '1', label: 'Note', name: 'note', type: 'Text' }]),
        );
        expect(out).toEqual([]);
      },
    );

    it(
      'treats id as required even without the flag',
      { tags: ['edge-case'] },
      () => {
        const out = renderFieldConstraints(
          makeEntity([{ fieldId: '1', label: 'Id', name: 'id', type: 'UUID' }]),
        ).join('\n');
        expect(out).toContain('id: { required: true },');
      },
    );
  });

  describe('dedupeFieldsByName', { tags: ['important'] }, () => {
    it(
      'keeps the first occurrence of each field name (PHX-4986)',
      { tags: ['important', 'edge-case'] },
      () => {
        // Phoenix can return two attributes with the same name (distinct
        // fieldIds) — e.g. two `closing_price` columns.
        const out = dedupeFieldsByName([
          { fieldId: '1', label: 'Closing Price', name: 'closing_price', type: 'Text' },
          { fieldId: '2', label: 'Closing Price', name: 'closing_price', type: 'Text' },
          { fieldId: '3', label: 'CUSIP', name: 'cusip', type: 'Text' },
        ]);
        expect(out).toHaveLength(2);
        expect(out.map((f) => f.name)).toEqual(['closing_price', 'cusip']);
        expect(out[0].fieldId).toBe('1'); // first wins
      },
    );

    it('leaves already-unique fields untouched', { tags: ['smoke'] }, () => {
      const fields: Entity['fields'] = [
        { fieldId: '1', label: 'A', name: 'a', type: 'Text' },
        { fieldId: '2', label: 'B', name: 'b', type: 'Text' },
      ];
      expect(dedupeFieldsByName(fields)).toEqual(fields);
    });
  });

  describe('renderFieldConstraints dedupe', { tags: ['important'] }, () => {
    it(
      'emits a duplicated field only once (PHX-4986)',
      { tags: ['important', 'edge-case'] },
      () => {
        const out = renderFieldConstraints(
          makeEntity([
            {
              fieldId: '1',
              label: 'Closing Price',
              name: 'closing_price',
              type: 'Text',
              constraints: { maxLength: { value: '500' } },
            },
            {
              fieldId: '2',
              label: 'Closing Price',
              name: 'closing_price',
              type: 'Text',
              constraints: { maxLength: { value: '500' } },
            },
          ]),
        ).join('\n');
        const occurrences = out.split('closing_price:').length - 1;
        expect(occurrences).toBe(1);
      },
    );
  });

  describe('tsPropertyKey', { tags: ['important'] }, () => {
    it('leaves a valid identifier unquoted', { tags: ['smoke'] }, () => {
      expect(tsPropertyKey('id')).toBe('id');
      expect(tsPropertyKey('account_anniversary_date')).toBe(
        'account_anniversary_date',
      );
      expect(tsPropertyKey('_private')).toBe('_private');
      expect(tsPropertyKey('$ref')).toBe('$ref');
      expect(tsPropertyKey('camelCase123')).toBe('camelCase123');
    });

    it(
      'quotes a key that starts with a digit (the `1035_exchange_amount` bug)',
      { tags: ['important', 'edge-case'] },
      () => {
        // Bare `1035_exchange_amount?: number;` is a TS syntax error.
        expect(tsPropertyKey('1035_exchange_amount')).toBe(
          '"1035_exchange_amount"',
        );
        expect(tsPropertyKey('401k_balance')).toBe('"401k_balance"');
      },
    );

    it(
      'quotes keys containing non-identifier characters',
      { tags: ['edge-case'] },
      () => {
        expect(tsPropertyKey('field-name')).toBe('"field-name"');
        expect(tsPropertyKey('with space')).toBe('"with space"');
        expect(tsPropertyKey('a.b')).toBe('"a.b"');
        // Embedded quotes are escaped by JSON.stringify.
        expect(tsPropertyKey('odd"key')).toBe('"odd\\"key"');
      },
    );
  });
});
