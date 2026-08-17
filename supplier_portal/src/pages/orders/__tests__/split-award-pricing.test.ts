/**
 * A split line is priced from the AWARD, not from the quote that won the pick.
 *
 * The bug these pin was found on GC-1001. The line was awarded 5,000 units to
 * Travel Tags at $0.840 and 3,000 to IDEMIA at $0.950 — $7,050 committed — and
 * the proposal quoted the client off $0.840 for all 8,000: a supplier cost of
 * $6,720, a $330 hole, and a margin reported as 13.9% when the real one was
 * 9.7%. Nothing on screen contradicted it, which is why it needs a test rather
 * than an eye.
 */
import { describe, it, expect } from 'vitest';
import { blendShares, buildDeal } from '@/pages/orders/deal-helpers';

const ROLES = [
  { component_role: 'card', margin_bps: 2000, template: { id: 't1' } },
  { component_role: 'carrier', margin_bps: 1000, template: { id: 't1' } },
];
const TEMPLATES = [
  { id: 't1', name: 'Sephora rate card', floor_bps: 800, active: true, client: { id: 'c1' } },
];

/** Two suppliers on one 8,000-unit line, at genuinely different rates. */
function splitLine() {
  return [
    {
      orderLineId: 'ol1',
      tierId: 'tier1',
      name: 'Holiday Sparkle',
      qty: 8000,
      quotes: [
        {
          supplierId: 'tt',
          supplierName: 'Travel Tags',
          unitCostMicros: 700_000,
          byRole: { card: 550_000, carrier: 150_000 },
          declinedRoles: [],
        },
        {
          supplierId: 'idm',
          supplierName: 'IDEMIA',
          unitCostMicros: 800_000,
          byRole: { card: 620_000, carrier: 180_000 },
          declinedRoles: [],
        },
      ],
    },
  ];
}

const SPLIT = { ol1: [{ supplierId: 'tt', qty: 5000 }, { supplierId: 'idm', qty: 3000 }] };

describe('split-award pricing', { tags: ['orders', 'logic'] }, () => {
  describe('blendShares', { tags: ['important'] }, () => {
    it('weights each material by the quantity actually awarded', () => {
      const b = blendShares(SPLIT.ol1, splitLine()[0].quotes);
      // card:    (550k x 5000 + 620k x 3000) / 8000 = 576,250
      // carrier: (150k x 5000 + 180k x 3000) / 8000 = 161,250
      expect(b?.byRole.card).toBe(576_250);
      expect(b?.byRole.carrier).toBe(161_250);
    });

    it('blends per material, not off the line totals', () => {
      // Averaging the line totals first gives 737,500 for everything, which
      // would then be sold at whichever single margin was applied. Summing the
      // per-material blend keeps each material on its own rate.
      const b = blendShares(SPLIT.ol1, splitLine()[0].quotes);
      const summed = (b?.byRole.card as number) + (b?.byRole.carrier as number);
      expect(summed).toBe(737_500);
    });

    it('reports a role unknown when any awarded supplier has no price for it', () => {
      // Blending only the supplier who answered would under-state the line by
      // exactly the share that did not.
      const quotes = splitLine()[0].quotes.map((q) =>
        q.supplierId === 'idm' ? { ...q, byRole: { ...q.byRole, carrier: null } } : q,
      );
      const b = blendShares(SPLIT.ol1, quotes);
      expect(b?.byRole.carrier).toBeNull();
      expect(b?.byRole.card).toBe(576_250);
    });

    it('ignores a share whose supplier never quoted, and zero-quantity rows', {
      tags: ['edge-case'],
    }, () => {
      const b = blendShares(
        [{ supplierId: 'tt', qty: 5000 }, { supplierId: 'ghost', qty: 3000 }, { supplierId: 'idm', qty: 0 }],
        splitLine()[0].quotes,
      );
      // Only Travel Tags carries weight, so the blend is its own rate.
      expect(b?.byRole.card).toBe(550_000);
    });

    it('returns null when nothing usable was awarded', { tags: ['edge-case'] }, () => {
      expect(blendShares([], splitLine()[0].quotes)).toBeNull();
      expect(blendShares([{ supplierId: 'ghost', qty: 10 }], splitLine()[0].quotes)).toBeNull();
    });
  });

  describe('buildDeal with a committed award', { tags: ['important'] }, () => {
    it('prices the line off the award, not off the cheapest quote', () => {
      const deal = buildDeal(splitLine(), ROLES, TEMPLATES, [], 'c1', {}, SPLIT);
      // 576,250 + 161,250 = 737,500 per unit — NOT Travel Tags' 700,000.
      expect(deal.lines[0].unitCostMicros).toBe(737_500);
      expect(deal.totalCostMicros).toBe(737_500 * 8000);
    });

    it('still uses the picked quote before anything is awarded', () => {
      // Deal Review has to show a number before an allocation exists; the
      // cheapest complete quote is that number.
      const deal = buildDeal(splitLine(), ROLES, TEMPLATES, [], 'c1');
      expect(deal.lines[0].unitCostMicros).toBe(700_000);
      expect(deal.lines[0].supplierName).toBe('Travel Tags');
    });

    it('names every awarded supplier and claims none of them as the line owner', () => {
      const deal = buildDeal(splitLine(), ROLES, TEMPLATES, [], 'c1', {}, SPLIT);
      expect(deal.lines[0].supplierName).toBe('Travel Tags · IDEMIA');
      // A single id here would let a later read treat all 8,000 as that
      // supplier's — the same conflation that caused the pricing bug.
      expect(deal.lines[0].supplierId).toBeNull();
    });

    it('keeps the single id when the whole line went to one supplier', () => {
      const deal = buildDeal(splitLine(), ROLES, TEMPLATES, [], 'c1', {}, {
        ol1: [{ supplierId: 'idm', qty: 8000 }],
      });
      expect(deal.lines[0].supplierId).toBe('idm');
      expect(deal.lines[0].supplierName).toBe('IDEMIA');
      expect(deal.lines[0].unitCostMicros).toBe(800_000);
    });

    it('reports a margin against what was bought', () => {
      const deal = buildDeal(splitLine(), ROLES, TEMPLATES, [], 'c1', {}, SPLIT);
      const picked = buildDeal(splitLine(), ROLES, TEMPLATES, [], 'c1');
      // The awarded line costs more than the winning quote, so its realised
      // margin must be LOWER. Reporting the quote's margin was the overstatement.
      expect(deal.lines[0].realisedBps).toBeLessThan(picked.lines[0].realisedBps as number);
    });
  });
});
