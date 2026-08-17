import { describe, it, expect } from 'vitest';
import { buildSchema } from './schema';

describe('buildSchema', { tags: ['customization', 'logic'] }, () => {
  it('stamps each slot with its full-path id and type', { tags: ['important'] }, () => {
    const s = buildSchema('ClientListPage', {
      newClientBtn: 'button',
      searchInput: 'input',
      clientsTable: 'table',
    });
    expect(s.newClientBtn).toEqual({ id: 'ClientListPage.newClientBtn', type: 'button' });
    expect(s.searchInput).toEqual({ id: 'ClientListPage.searchInput', type: 'input' });
    expect(s.clientsTable).toEqual({ id: 'ClientListPage.clientsTable', type: 'table' });
  });

  it('supports the expanded interactive types', () => {
    const s = buildSchema('SettingsPage', {
      notify: 'switch',
      plan: 'radio',
      bold: 'toggle',
      volume: 'slider',
      country: 'native-select',
      status: 'badge',
    });
    expect(s.notify.type).toBe('switch');
    expect(s.plan.type).toBe('radio');
    expect(s.bold.type).toBe('toggle');
    expect(s.volume.type).toBe('slider');
    expect(s.country.type).toBe('native-select');
    expect(s.status.type).toBe('badge');
  });

  it('produces an empty schema for no slots', { tags: ['edge-case'] }, () => {
    expect(buildSchema('EmptyPage', {})).toEqual({});
  });

  it('supports object slot decls with a permission flag', { tags: ['important'] }, () => {
    const s = buildSchema('BookOfBusinessPage', {
      kpiInflows: 'card',
      kpiOutflows: { type: 'card', permission: true },
    });
    expect(s.kpiInflows).toEqual({ id: 'BookOfBusinessPage.kpiInflows', type: 'card' });
    expect(s.kpiOutflows).toEqual({
      id: 'BookOfBusinessPage.kpiOutflows',
      type: 'card',
      permission: true,
    });
  });
});
