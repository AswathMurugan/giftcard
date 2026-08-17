import { describe, it, expect } from 'vitest';
import { resolveComponentConfig, applyColumnOverrides } from './resolve';

describe('resolve', { tags: ['customization', 'logic'] }, () => {
  describe('resolveComponentConfig', { tags: ['important'] }, () => {
    it('returns code defaults when no override', () => {
      const cfg = resolveComponentConfig('button', undefined);
      expect(cfg).toEqual({
        type: 'button',
        visible: true,
        disabled: false,
        variant: 'default',
      });
    });

    it('applies string overrides (label, variant)', () => {
      const cfg = resolveComponentConfig('button', {
        label: 'Save',
        variant: 'outline',
      });
      expect(cfg.label).toBe('Save');
      expect(cfg.variant).toBe('outline');
    });

    it('coerces boolean overrides', () => {
      const cfg = resolveComponentConfig('input', {
        visible: 'false',
        required: 'true',
        disabled: '1',
      });
      expect(cfg.visible).toBe(false);
      expect(cfg.required).toBe(true);
      expect(cfg.disabled).toBe(true);
    });

    it('picks allowed inline styles and drops unknown', { tags: ['edge-case'] }, () => {
      const cfg = resolveComponentConfig('button', {
        color: '#b45309',
        position: 'absolute',
      });
      expect(cfg.style).toEqual({ color: '#b45309' });
    });

    it('override wins over defaults', () => {
      const cfg = resolveComponentConfig('button', { variant: 'ghost', disabled: 'true' });
      expect(cfg.variant).toBe('ghost');
      expect(cfg.disabled).toBe(true);
    });

    it('resolves defaults for expanded types', () => {
      expect(resolveComponentConfig('switch', undefined)).toEqual({
        type: 'switch',
        visible: true,
        disabled: false,
      });
      expect(resolveComponentConfig('badge', undefined)).toEqual({
        type: 'badge',
        visible: true,
        variant: 'default',
      });
      expect(resolveComponentConfig('card', undefined)).toEqual({
        type: 'card',
        visible: true,
      });
    });

    it('hides a card via visible override', { tags: ['edge-case'] }, () => {
      const cfg = resolveComponentConfig('card', { visible: 'false' });
      expect(cfg.visible).toBe(false);
    });
  });

  describe('applyColumnOverrides', { tags: ['important'] }, () => {
    const base = [
      { field: 'client_name', headerName: 'Client Name', flex: 2 },
      { colId: 'email', headerName: 'Email' },
      { field: 'id', headerName: 'Client ID' },
    ];

    it('returns the same columns when no overrides', () => {
      expect(applyColumnOverrides(base, undefined)).toBe(base);
      expect(applyColumnOverrides(base, {})).toBe(base);
    });

    it('renames a column header by field key', () => {
      const out = applyColumnOverrides(base, {
        client_name: { headerName: 'Household' },
      });
      expect(out[0].headerName).toBe('Household');
      // untouched columns keep identity
      expect(out[1]).toBe(base[1]);
    });

    it('matches by colId when no field', () => {
      const out = applyColumnOverrides(base, { email: { hide: 'true' } });
      expect((out[1] as { hide?: boolean }).hide).toBe(true);
    });

    it('coerces numeric column props', () => {
      const out = applyColumnOverrides(base, { client_name: { width: '200' } });
      expect((out[0] as { width?: number }).width).toBe(200);
    });

    it('coerces pinned to left/right/bool', () => {
      const out = applyColumnOverrides(base, {
        email: { pinned: 'left' },
        id: { pinned: 'true' },
      });
      expect((out[1] as { pinned?: unknown }).pinned).toBe('left');
      expect((out[2] as { pinned?: unknown }).pinned).toBe(true);
    });

    it('never overrides blocked keys (field, valueGetter)', { tags: ['important', 'edge-case'] }, () => {
      const out = applyColumnOverrides(base, {
        client_name: { field: 'evil', valueGetter: 'hack', headerName: 'OK' },
      });
      expect(out[0].field).toBe('client_name');
      expect((out[0] as { valueGetter?: unknown }).valueGetter).toBeUndefined();
      expect(out[0].headerName).toBe('OK');
    });

    it('ignores overrides for non-existent columns', { tags: ['edge-case'] }, () => {
      const out = applyColumnOverrides(base, { nonexistent: { hide: 'true' } });
      expect(out).toEqual(base);
    });
  });
});
