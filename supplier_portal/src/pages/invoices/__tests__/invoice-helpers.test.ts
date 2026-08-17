/**
 * What a supplier is owed. The totals split billable from everything else on
 * purpose — summing every row regardless of status would tell a supplier they
 * are owed money for extras that were raised and then written off.
 */
import { describe, it, expect } from 'vitest';
import {
  decorateInvoices,
  formatUsd,
  fromMicros,
  invoiceTotals,
} from '@/pages/invoices/invoice-helpers';
import type { SupplierInvoiceListRow } from '@/types/saved-queries.generated';

describe('invoice-helpers', { tags: ['invoices', 'logic'] }, () => {
  describe('fromMicros', { tags: ['edge-case'] }, () => {
    it('converts micros to dollars', () => {
      expect(fromMicros(312_500_000)).toBeCloseTo(312.5, 2);
      expect(fromMicros(1_000_000)).toBe(1);
    });

    it('treats nothing as zero rather than NaN', () => {
      expect(fromMicros(null)).toBe(0);
      expect(fromMicros(undefined)).toBe(0);
    });
  });

  describe('formatUsd', { tags: ['smoke'] }, () => {
    it('always shows two decimals', () => {
      expect(formatUsd(312.5)).toBe('$312.50');
      expect(formatUsd(0)).toBe('$0.00');
      expect(formatUsd(1234.567)).toBe('$1,234.57');
    });
  });

  describe('decorateInvoices', { tags: ['important'] }, () => {
    it('returns [] for undefined and empty', { tags: ['edge-case'] }, () => {
      expect(decorateInvoices(undefined)).toEqual([]);
      expect(decorateInvoices([])).toEqual([]);
    });

    it('extends qty by unit cost', () => {
      const rows = decorateInvoices([
        {
          id: 'e1',
          category: 'Additional spec',
          description: 'Freight',
          qty: 2,
          unit_cost_micros: 312_500_000,
          status: 'billable',
          supply_order: { order_code: 'GC-1011-PO1' },
        },
      ] as unknown as SupplierInvoiceListRow[]);
      expect(rows[0].unitCost).toBeCloseTo(312.5, 2);
      expect(rows[0].amount).toBeCloseTo(625, 2);
      expect(rows[0].orderCode).toBe('GC-1011-PO1');
    });

    it('substitutes placeholders for missing text', { tags: ['edge-case'] }, () => {
      const [row] = decorateInvoices([
        { id: 'e1', category: null, description: null, qty: null, unit_cost_micros: null },
      ] as unknown as SupplierInvoiceListRow[]);
      expect(row.category).toBe('Extra');
      expect(row.description).toBe('No description');
      expect(row.orderCode).toBe('—');
      expect(row.amount).toBe(0);
      expect(row.status).toBe('draft');
    });
  });

  describe('invoiceTotals', { tags: ['important'] }, () => {
    it('counts only billable rows toward what is claimable', () => {
      const rows = decorateInvoices([
        { id: 'a', qty: 1, unit_cost_micros: 100_000_000, status: 'billable' },
        { id: 'b', qty: 1, unit_cost_micros: 50_000_000, status: 'draft' },
        { id: 'c', qty: 1, unit_cost_micros: 25_000_000, status: 'written_off' },
      ] as unknown as SupplierInvoiceListRow[]);
      const totals = invoiceTotals(rows);
      expect(totals.billable).toBeCloseTo(100, 2);
      expect(totals.other).toBeCloseTo(75, 2);
      expect(totals.count).toBe(3);
    });

    it('is zero for an empty book', { tags: ['edge-case'] }, () => {
      expect(invoiceTotals([])).toEqual({ billable: 0, other: 0, count: 0 });
    });
  });
});
