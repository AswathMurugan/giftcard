import { describe, it, expect, vi } from 'vitest';
import {
  resolveRowActions,
  type RowAction,
} from './normalize-row-actions';

interface Row {
  id: string;
  status: string;
}

const ROW: Row = { id: 'a1', status: 'Closed' };

describe('resolveRowActions', { tags: ['data-table', 'logic'] }, () => {
  describe('source handling', { tags: ['important'] }, () => {
    it('returns [] for nullish source', { tags: ['edge-case'] }, () => {
      expect(resolveRowActions(undefined, ROW)).toEqual([]);
      expect(resolveRowActions(null, ROW)).toEqual([]);
    });

    it('returns [] for nullish row', { tags: ['edge-case'] }, () => {
      const actions: RowAction<Row>[] = [
        { label: 'View', onSelect: () => {} },
      ];
      expect(resolveRowActions(actions, null)).toEqual([]);
      expect(resolveRowActions(actions, undefined)).toEqual([]);
    });

    it('passes through a static array', () => {
      const actions: RowAction<Row>[] = [
        { label: 'View', onSelect: () => {} },
        { label: 'Edit', onSelect: () => {} },
      ];
      const resolved = resolveRowActions(actions, ROW);
      expect(resolved.map((a) => a.label)).toEqual(['View', 'Edit']);
    });

    it('invokes a per-row function source with the row', () => {
      const fn = vi.fn((row: Row): RowAction<Row>[] => [
        { label: row.status, onSelect: () => {} },
      ]);
      const resolved = resolveRowActions(fn, ROW);
      expect(fn).toHaveBeenCalledWith(ROW);
      expect(resolved[0].label).toBe('Closed');
    });

    it('returns [] when a function source yields a non-array', { tags: ['edge-case'] }, () => {
      const fn = (() => undefined) as unknown as (row: Row) => RowAction<Row>[];
      expect(resolveRowActions(fn, ROW)).toEqual([]);
    });
  });

  describe('hidden filtering', { tags: ['smoke'] }, () => {
    it('drops items whose hidden predicate is true', () => {
      const actions: RowAction<Row>[] = [
        { label: 'View', onSelect: () => {} },
        { label: 'Edit', onSelect: () => {}, hidden: (r) => r.status === 'Closed' },
      ];
      const resolved = resolveRowActions(actions, ROW);
      expect(resolved.map((a) => a.label)).toEqual(['View']);
    });

    it('keeps items whose hidden predicate is false', () => {
      const actions: RowAction<Row>[] = [
        { label: 'Edit', onSelect: () => {}, hidden: (r) => r.status === 'Open' },
      ];
      const resolved = resolveRowActions(actions, ROW);
      expect(resolved.map((a) => a.label)).toEqual(['Edit']);
    });
  });

  describe('disabled resolution', { tags: ['logic'] }, () => {
    it('resolves a boolean disabled', () => {
      const actions: RowAction<Row>[] = [
        { label: 'Edit', onSelect: () => {}, disabled: true },
      ];
      expect(resolveRowActions(actions, ROW)[0].disabled).toBe(true);
    });

    it('resolves a predicate disabled per row', () => {
      const actions: RowAction<Row>[] = [
        { label: 'Delete', onSelect: () => {}, disabled: (r) => r.status === 'Closed' },
      ];
      expect(resolveRowActions(actions, ROW)[0].disabled).toBe(true);
    });

    it('defaults disabled to false when absent', { tags: ['edge-case'] }, () => {
      const actions: RowAction<Row>[] = [
        { label: 'View', onSelect: () => {} },
      ];
      expect(resolveRowActions(actions, ROW)[0].disabled).toBe(false);
    });
  });

  describe('variant default', { tags: ['logic'] }, () => {
    it("defaults variant to 'default'", () => {
      const actions: RowAction<Row>[] = [
        { label: 'View', onSelect: () => {} },
      ];
      expect(resolveRowActions(actions, ROW)[0].variant).toBe('default');
    });

    it("preserves 'destructive'", () => {
      const actions: RowAction<Row>[] = [
        { label: 'Delete', onSelect: () => {}, variant: 'destructive' },
      ];
      expect(resolveRowActions(actions, ROW)[0].variant).toBe('destructive');
    });
  });
});
