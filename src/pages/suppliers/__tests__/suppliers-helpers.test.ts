import { describe, it, expect } from 'vitest';
import {
  buildSupplierCards,
  matchesSupplier,
  remainingUnits,
  utilisationPct,
  type CapacityRow,
  type SupplierBoardResult,
} from '@/pages/suppliers/suppliers-helpers';

const BOARD: SupplierBoardResult = {
  suppliers: [
    { id: 's1', name: 'Travel Tags', status: 'active' },
    { id: 's2', name: 'CPI Card Group', status: 'active' },
    // Deliberately last alphabetically-first, to prove sorting.
    { id: 's3', name: 'Aardvark Cards', status: 'inactive' },
  ],
  supplier_rfes: [
    { id: 'r1', status: 'sent', supplier: { id: 's1' }, demand_order: { order_code: 'GC-1' } },
    { id: 'r2', status: 'responded', supplier: { id: 's1' }, demand_order: { order_code: 'GC-2' } },
  ],
};

describe('suppliers-helpers', { tags: ['suppliers', 'logic'] }, () => {
  describe('remainingUnits', { tags: ['important'] }, () => {
    it('subtracts committed from declared', () => {
      expect(remainingUnits({ declared: 1000, committed: 400 })).toBe(600);
    });

    it('treats missing committed as zero', () => {
      expect(remainingUnits({ declared: 1000 })).toBe(1000);
    });

    it('returns null when nothing is declared — 0 would read as "full"', {
      tags: ['edge-case'],
    }, () => {
      expect(remainingUnits({})).toBeNull();
      expect(remainingUnits({ committed: 500 })).toBeNull();
    });

    it('can go negative when overcommitted, rather than clamping', {
      tags: ['edge-case'],
    }, () => {
      expect(remainingUnits({ declared: 100, committed: 150 })).toBe(-50);
    });
  });

  describe('utilisationPct', { tags: ['important'] }, () => {
    it('is a whole percentage of declared', () => {
      expect(utilisationPct({ declared: 1000, committed: 250 })).toBe(25);
    });

    it('returns null for undeclared or zero capacity — no divide by zero', {
      tags: ['edge-case'],
    }, () => {
      expect(utilisationPct({ declared: 0, committed: 10 })).toBeNull();
      expect(utilisationPct({})).toBeNull();
    });

    it('reports over 100 when overcommitted', { tags: ['edge-case'] }, () => {
      expect(utilisationPct({ declared: 100, committed: 150 })).toBe(150);
    });
  });

  describe('buildSupplierCards', { tags: ['important'] }, () => {
    const capacity: CapacityRow[] = [
      { id: 'c1', period: '2026-08', declared: 500, committed: 100, supplier: { id: 's1' } },
    ];

    it('includes suppliers with no RFEs at all', () => {
      const cards = buildSupplierCards(BOARD, [], [], []);
      expect(cards.map((c) => c.name)).toEqual([
        'Aardvark Cards',
        'CPI Card Group',
        'Travel Tags',
      ]);
      expect(cards.find((c) => c.name === 'CPI Card Group')?.rfes).toEqual([]);
    });

    it('counts only `sent` RFEs as awaiting', () => {
      const tt = buildSupplierCards(BOARD, [], [], []).find((c) => c.name === 'Travel Tags');
      expect(tt?.rfes).toHaveLength(2);
      expect(tt?.awaiting).toBe(1);
    });

    it('joins capacity on supplier id', () => {
      const cards = buildSupplierCards(BOARD, capacity, [], []);
      expect(cards.find((c) => c.id === 's1')?.capacity).toHaveLength(1);
      expect(cards.find((c) => c.id === 's2')?.capacity).toHaveLength(0);
    });

    it('joins prices on `party`, not `supplier`', { tags: ['edge-case'] }, () => {
      const cards = buildSupplierCards(BOARD, [], [], [
        { id: 'p1', tier_qty: 10000, unit_cost: 0.05, party: { id: 's2' } },
      ]);
      expect(cards.find((c) => c.id === 's2')?.prices).toHaveLength(1);
    });

    it('drops suppliers with no id rather than keying on undefined', {
      tags: ['edge-case'],
    }, () => {
      const cards = buildSupplierCards({ suppliers: [{ name: 'Ghost' }] }, [], [], []);
      expect(cards).toHaveLength(0);
    });

    it('survives null/empty input', { tags: ['edge-case'] }, () => {
      expect(buildSupplierCards(null, [], [], [])).toEqual([]);
      expect(buildSupplierCards({}, [], [], [])).toEqual([]);
    });

    it('names an unnamed supplier rather than rendering blank', {
      tags: ['edge-case'],
    }, () => {
      const cards = buildSupplierCards({ suppliers: [{ id: 'x' }] }, [], [], []);
      expect(cards[0].name).toBe('Unnamed supplier');
      expect(cards[0].status).toBe('unknown');
    });
  });

  describe('matchesSupplier', { tags: ['smoke'] }, () => {
    const cards = buildSupplierCards(BOARD, [], [], []);
    const tt = cards.find((c) => c.name === 'Travel Tags')!;

    it('matches on supplier name, case-insensitively', () => {
      expect(matchesSupplier(tt, 'travel')).toBe(true);
    });

    it('also matches on an order code the supplier was asked about', () => {
      expect(matchesSupplier(tt, 'GC-2')).toBe(true);
    });

    it('an empty query matches everything', { tags: ['edge-case'] }, () => {
      expect(matchesSupplier(tt, '  ')).toBe(true);
    });

    it('does not match an unrelated term', () => {
      expect(matchesSupplier(tt, 'idemia')).toBe(false);
    });
  });
});
