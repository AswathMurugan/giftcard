import { describe, it, expect } from 'vitest';
import {
  parsePreferenceName,
  decodeEnvValues,
  mapEnvString,
  resolveValue,
  pickStyle,
  buildPreferenceIndex,
} from './preference-index';
import type { Preference } from '@/queries/use-preferences';

function makeRecord(overrides: Partial<Preference> = {}): Preference {
  return {
    id: 'id-1',
    app_definition_key: 'app',
    app_definition: 'app__V1',
    name: 'App.Branding.ClientListPage.newClientBtn.label',
    value: 'New Client',
    category: 'customization',
    org: null,
    user: null,
    disabled: false,
    draft: false,
    is_secret: false,
    type: 'string',
    ...overrides,
  };
}

describe('preference-index', { tags: ['customization', 'logic'] }, () => {
  describe('parsePreferenceName', { tags: ['important'] }, () => {
    it('parses 5-segment component names', () => {
      expect(parsePreferenceName('App.Branding.ClientListPage.title.color')).toEqual({
        address: 'ClientListPage.title',
        property: 'color',
      });
    });

    it('parses 6-segment table column names', () => {
      expect(
        parsePreferenceName('App.Branding.ClientListPage.clientsTable.client_name.headerName'),
      ).toEqual({
        address: 'ClientListPage.clientsTable',
        colId: 'client_name',
        property: 'headerName',
      });
    });

    it('parses 4-segment legacy names (no App prefix)', () => {
      expect(parsePreferenceName('Branding.ClientListPage.title.color')).toEqual({
        address: 'ClientListPage.title',
        property: 'color',
      });
    });

    it('returns null for unparseable names', { tags: ['edge-case'] }, () => {
      expect(parsePreferenceName('')).toBeNull();
      expect(parsePreferenceName('too.few')).toBeNull();
      expect(parsePreferenceName('a.b.c.d.e.f.g')).toBeNull();
    });
  });

  describe('mapEnvString', { tags: ['logic'] }, () => {
    it('maps runtime env strings to canonical keys', () => {
      expect(mapEnvString('develop')).toBe('dev');
      expect(mapEnvString('development')).toBe('dev');
      expect(mapEnvString('production')).toBe('prod');
      expect(mapEnvString('QA')).toBe('qa');
      expect(mapEnvString('uat')).toBe('uat');
    });

    it('defaults unknown env to dev', { tags: ['edge-case'] }, () => {
      expect(mapEnvString('weird')).toBe('dev');
    });
  });

  describe('decodeEnvValues', { tags: ['logic'] }, () => {
    it('decodes a fully-specified env-encoded value', () => {
      expect(decodeEnvValues('dev:#aaa|qa:#bbb|prod:#ccc')).toEqual({
        dev: '#aaa',
        qa: '#bbb',
        uat: '',
        prod: '#ccc',
      });
    });

    it('keeps colons inside the value', { tags: ['edge-case'] }, () => {
      expect(decodeEnvValues('dev:a:b').dev).toBe('a:b');
    });
  });

  describe('resolveValue', { tags: ['logic'] }, () => {
    it('resolves env-encoded values for the env', () => {
      expect(resolveValue('dev:1|prod:2', 'prod')).toBe('2');
    });

    it('returns plain values unchanged', () => {
      expect(resolveValue('#fff', 'dev')).toBe('#fff');
    });

    it('skips JSON-shaped values', { tags: ['edge-case'] }, () => {
      expect(resolveValue('{"a":1}', 'dev')).toBeNull();
      expect(resolveValue('[1,2]', 'dev')).toBeNull();
    });

    it('keeps falsy-but-meaningful values', { tags: ['edge-case'] }, () => {
      expect(resolveValue('0', 'dev')).toBe('0');
      expect(resolveValue('false', 'dev')).toBe('false');
    });

    it('drops empty/undefined', { tags: ['edge-case'] }, () => {
      expect(resolveValue('', 'dev')).toBeNull();
      expect(resolveValue(undefined, 'dev')).toBeNull();
    });
  });

  describe('pickStyle', { tags: ['logic'] }, () => {
    it('keeps only allowed style properties', () => {
      expect(
        pickStyle({ color: 'red', backgroundColor: '#fff', label: 'x', evil: 'y' }),
      ).toEqual({ color: 'red', backgroundColor: '#fff' });
    });

    it('returns undefined when no style props present', { tags: ['edge-case'] }, () => {
      expect(pickStyle({ label: 'x' })).toBeUndefined();
    });
  });

  describe('buildPreferenceIndex', { tags: ['important'] }, () => {
    it('indexes component props by address', () => {
      const idx = buildPreferenceIndex(
        [
          makeRecord({ name: 'App.B.ClientListPage.newClientBtn.label', value: 'Add' }),
          makeRecord({ name: 'App.B.ClientListPage.newClientBtn.variant', value: 'outline' }),
        ],
        'dev',
      );
      expect(idx.byAddress['ClientListPage.newClientBtn']).toEqual({
        label: 'Add',
        variant: 'outline',
      });
    });

    it('indexes table column overrides by table address + colId', () => {
      const idx = buildPreferenceIndex(
        [
          makeRecord({
            name: 'App.B.ClientListPage.clientsTable.client_name.headerName',
            value: 'Household',
            type: 'string',
          }),
        ],
        'dev',
      );
      expect(idx.byTable['ClientListPage.clientsTable'].client_name).toEqual({
        headerName: 'Household',
      });
    });

    it('skips disabled records', { tags: ['edge-case'] }, () => {
      const idx = buildPreferenceIndex(
        [makeRecord({ disabled: true })],
        'dev',
      );
      expect(Object.keys(idx.byAddress)).toHaveLength(0);
    });

    it('skips non-visual preference types', { tags: ['edge-case'] }, () => {
      const idx = buildPreferenceIndex(
        [makeRecord({ type: 'table_preference', value: '[]' })],
        'dev',
      );
      expect(Object.keys(idx.byAddress)).toHaveLength(0);
    });

    it('guards against prototype-pollution keys', { tags: ['important', 'edge-case'] }, () => {
      const idx = buildPreferenceIndex(
        [makeRecord({ name: 'App.B.__proto__.x.label', value: 'bad' })],
        'dev',
      );
      expect(Object.keys(idx.byAddress)).toHaveLength(0);
      // prototype not polluted
      expect(({} as Record<string, unknown>).label).toBeUndefined();
    });
  });
});
