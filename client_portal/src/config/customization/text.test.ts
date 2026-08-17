import { describe, it, expect } from 'vitest';
import { resolveText } from './ConfigProvider';
import { buildSchema } from './schema';
import { buildPreferenceIndex } from './preference-index';
import type { Preference } from '@/queries/use-preferences';

function makeTextRecord(name: string, value: string): Preference {
  return {
    id: name,
    app_definition_key: 'app',
    app_definition: 'app__V1',
    name,
    value,
    category: 'Text',
    org: null,
    user: null,
    disabled: false,
    draft: false,
    is_secret: false,
    type: 'string',
  };
}

describe('usePageText / resolveText', { tags: ['customization', 'logic'] }, () => {
  it('returns the default when no preference exists', { tags: ['important'] }, () => {
    const index = buildPreferenceIndex([], 'dev');
    expect(resolveText(index, 'ClientListPage', 'pageTitle', 'Clients')).toBe('Clients');
  });

  it('returns the admin text override for <page>.<key>', { tags: ['important'] }, () => {
    const index = buildPreferenceIndex(
      [makeTextRecord('App.Text.ClientListPage.pageTitle.text', 'Active Clients')],
      'dev',
    );
    expect(resolveText(index, 'ClientListPage', 'pageTitle', 'Clients')).toBe('Active Clients');
  });

  it('resolves env-encoded text for the current env', () => {
    const index = buildPreferenceIndex(
      [makeTextRecord('App.Text.ClientListPage.pageTitle.text', 'dev:Dev Clients|prod:Clients')],
      'prod',
    );
    expect(resolveText(index, 'ClientListPage', 'pageTitle', 'X')).toBe('Clients');
  });

  it('does not leak text across pages or keys', { tags: ['edge-case'] }, () => {
    const index = buildPreferenceIndex(
      [makeTextRecord('App.Text.ClientListPage.pageTitle.text', 'Override')],
      'dev',
    );
    expect(resolveText(index, 'OtherPage', 'pageTitle', 'Def')).toBe('Def');
    expect(resolveText(index, 'ClientListPage', 'subtitle', 'Def')).toBe('Def');
  });

  it('declares text keys as address-only slots in the schema', { tags: ['important'] }, () => {
    const s = buildSchema('ClientListPage', {
      pageTitle: 'text',
      subtitle: 'text',
      newBtn: 'button',
    });
    expect(s.pageTitle).toEqual({ id: 'ClientListPage.pageTitle', type: 'text' });
    expect(s.subtitle.type).toBe('text');
    // the schema is the discoverable catalog of overridable text keys
    const textKeys = Object.keys(s).filter((k) => s[k as keyof typeof s].type === 'text');
    expect(textKeys.sort()).toEqual(['pageTitle', 'subtitle']);
  });
});
