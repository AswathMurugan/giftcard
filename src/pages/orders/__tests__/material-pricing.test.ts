/**
 * Material-level quoting — a card's cost is the SUM of its materials.
 *
 * These cover the bug that motivated them: four material tiers share one
 * line and one quantity, and reading a single tier reported the carrier's
 * price as the whole card, under-quoting a real order five-fold.
 */
import { describe, it, expect } from 'vitest';
import {
  allocationSummary,
  buildDeal,
  dealMaterialRoles,
  marginForRole,
} from '@/pages/orders/deal-helpers';

const ROLES = [
  { component_role: 'card', margin_bps: 2000, template: { id: 't1' } },
  { component_role: 'features', margin_bps: 4000, template: { id: 't1' } },
  { component_role: 'carrier', margin_bps: 1000, template: { id: 't1' } },
];
const TEMPLATES = [
  { id: 't1', name: 'Sephora rate card', floor_bps: 800, active: true, client: { id: 'c1' } },
];

/** IDEMIA's real GC-1048 answer: card 5c, personalisation 3c, carrier 2c, setup declined. */
function lineWithMaterials() {
  return [
    {
      orderLineId: 'ol1',
      tierId: 'tier1',
      name: 'Thank-You card',
      qty: 5000,
      quotes: [
        {
          supplierId: 's1',
          supplierName: 'IDEMIA',
          unitCostMicros: 100_000,
          byRole: { card: 50_000, features: 30_000, carrier: 20_000, setup: 0 },
          declinedRoles: ['setup'],
        },
      ],
    },
  ];
}

describe('material pricing', { tags: ['orders', 'logic'] }, () => {
  describe('buildDeal', { tags: ['important'] }, () => {
    it('sums the materials into the line cost', () => {
      const deal = buildDeal(lineWithMaterials(), ROLES, TEMPLATES, [], 'c1');
      // 50k + 30k + 20k — NOT any single material's price.
      expect(deal.lines[0].unitCostMicros).toBe(100_000);
      expect(deal.lines[0].extendedCostMicros).toBe(500_000_000);
    });

    it('prices each material at its own rate, not one blended rate', () => {
      const deal = buildDeal(lineWithMaterials(), ROLES, TEMPLATES, [], 'c1');
      const byRole = Object.fromEntries(
        deal.lines[0].materials.map((m) => [m.componentRole, m.unitSellMicros]),
      );
      // margin on SELL: cost / (1 - bps/10000)
      expect(byRole.card).toBe(Math.round(50_000 / 0.8)); // 20% → 62500
      expect(byRole.features).toBe(Math.round(30_000 / 0.6)); // 40% → 50000
      expect(byRole.carrier).toBe(Math.round(20_000 / 0.9)); // 10% → 22222
      // Applying one rate to the 100k total would give 125000 — a different,
      // wrong number. The sum of the three is what the client is quoted.
      expect(deal.lines[0].unitSellMicros).toBe(62_500 + 50_000 + 22_222);
      expect(deal.lines[0].unitSellMicros).not.toBe(125_000);
    });

    it('treats a declined material as absent, not as free', () => {
      const deal = buildDeal(lineWithMaterials(), ROLES, TEMPLATES, [], 'c1');
      const setup = deal.lines[0].materials.find((m) => m.componentRole === 'setup');
      expect(setup?.declined).toBe(true);
      expect(setup?.unitCostMicros).toBeNull();
      expect(setup?.unitSellMicros).toBeNull();
    });

    it('withholds a sell price when a priced material has no rate', { tags: ['edge-case'] }, () => {
      // 'carrier' priced but the template rates only card + features.
      const deal = buildDeal(lineWithMaterials(), ROLES.slice(0, 2), TEMPLATES, [], 'c1');
      expect(deal.lines[0].missingMargin).toBe(true);
      // Quoting only the rated materials would under-charge for the carrier.
      expect(deal.lines[0].unitSellMicros).toBeNull();
      expect(deal.totalSellMicros).toBe(0);
    });

    it('lets an override beat the template rate', () => {
      const deal = buildDeal(lineWithMaterials(), ROLES, TEMPLATES, [
        { component_role: 'card', margin_bps: 3000, active: true, created_at: '2026-08-13' },
      ], 'c1');
      const card = deal.lines[0].materials.find((m) => m.componentRole === 'card');
      expect(card?.marginBps).toBe(3000);
      expect(card?.marginSource).toBe('override');
      expect(marginForRole(deal, 'card').bps).toBe(3000);
    });

    it('handles a legacy line with no priced materials', { tags: ['edge-case'] }, () => {
      const deal = buildDeal(
        [{ orderLineId: 'ol1', tierId: 't1', name: 'X', qty: 100, quotes: [] }],
        ROLES,
        TEMPLATES,
        [],
        'c1',
      );
      expect(deal.lines[0].unitCostMicros).toBeNull();
      expect(deal.lines[0].materials).toEqual([]);
      expect(deal.lines[0].missingMargin).toBe(false);
    });
  });

  describe('supplier pick', { tags: ['important'] }, () => {
    /** A complete $0.10 quote against a half-answered $0.02 one. */
    function twoSuppliers(): Array<{
      orderLineId: string;
      tierId: string;
      name: string;
      qty: number;
      quotes: Array<{
        supplierId: string;
        supplierName: string;
        unitCostMicros: number | null;
        byRole: Record<string, number | null>;
        declinedRoles: string[];
        hasUncosted: boolean;
      }>;
    }> {
      return [
        {
          orderLineId: 'ol1',
          tierId: 'tier1',
          name: 'Thank-You card',
          qty: 1000,
          quotes: [
            {
              supplierId: 'full',
              supplierName: 'Complete Co',
              unitCostMicros: 100_000,
              byRole: { card: 50_000, features: 30_000, carrier: 20_000 },
              declinedRoles: [],
              hasUncosted: false,
            },
            {
              supplierId: 'part',
              supplierName: 'Partial Co',
              unitCostMicros: 20_000,
              // Priced the carrier only; card and personalization unanswered.
              byRole: { card: null, features: null, carrier: 20_000 },
              declinedRoles: [],
              hasUncosted: true,
            },
          ],
        },
      ];
    }

    it('does not auto-pick a cheaper PARTIAL quote over a complete one', () => {
      const deal = buildDeal(twoSuppliers(), ROLES, TEMPLATES, [], 'c1');
      // $0.02 is the lowest number on the line but is not an offer for the
      // card — picking it would quote the client for a fifth of the job.
      expect(deal.lines[0].supplierName).toBe('Complete Co');
      expect(deal.lines[0].unitCostMicros).toBe(100_000);
      expect(deal.lines[0].pickedIsPartial).toBe(false);
    });

    it('still honours an explicit pick of a partial quote, and flags it', () => {
      const deal = buildDeal(twoSuppliers(), ROLES, TEMPLATES, [], 'c1', { ol1: 'part' });
      expect(deal.lines[0].supplierName).toBe('Partial Co');
      expect(deal.lines[0].pickedIsPartial).toBe(true);
    });

    it('picks nobody when every quote is partial', { tags: ['edge-case'] }, () => {
      const lines = twoSuppliers();
      lines[0].quotes = [lines[0].quotes[1]];
      const deal = buildDeal(lines, ROLES, TEMPLATES, [], 'c1');
      // Better to show "no complete quote" than to present a floor as a price.
      expect(deal.lines[0].supplierName).toBeNull();
      expect(deal.lines[0].unitCostMicros).toBeNull();
    });

    it('picks the cheaper of two complete quotes', { tags: ['smoke'] }, () => {
      const lines = twoSuppliers();
      lines[0].quotes[1] = {
        ...lines[0].quotes[1],
        hasUncosted: false,
        byRole: { card: 10_000, features: null, carrier: 10_000 },
      };
      const deal = buildDeal(lines, ROLES, TEMPLATES, [], 'c1');
      expect(deal.lines[0].supplierName).toBe('Partial Co');
    });
  });

  /**
   * Domain model B4: "Sum of allocations = demand line qty". The demo gates on
   * the same rule — "Allocate exactly 10,000 to create the orders".
   */
  describe('allocationSummary', { tags: ['allocation', 'important'] }, () => {
    const LINES = [
      { orderLineId: 'ol1', tierId: 't1', name: 'Christmas Evergreen', qty: 250 },
      { orderLineId: 'ol2', tierId: 't2', name: 'Walmart-1', qty: 250 },
    ];
    // $1.00 from A, $2.00 from B — a card body plus a carrier in each.
    const cost = {
      unit: (_line: string, supplier: string) => (supplier === 'A' ? 1_000_000 : 2_000_000),
      material: (_line: string, supplier: string, role: string) =>
        role === 'carrier' ? (supplier === 'A' ? 200_000 : 100_000) : 800_000,
    };

    it('balances a line that sums exactly to its quantity', () => {
      const s = allocationSummary(LINES, {
        ol1: [{ supplierId: 'A', qty: 250 }],
        ol2: [{ supplierId: 'A', qty: 250 }],
      }, {}, cost);
      expect(s.allBalanced).toBe(true);
      expect(s.lines[0].remaining).toBe(0);
      expect(s.totalCostMicros).toBe(500_000_000);
    });

    it('splits one line across two suppliers and still balances', () => {
      const s = allocationSummary(LINES, {
        ol1: [{ supplierId: 'A', qty: 150 }, { supplierId: 'B', qty: 100 }],
        ol2: [{ supplierId: 'A', qty: 250 }],
      }, {}, cost);
      expect(s.allBalanced).toBe(true);
      expect(s.splitLines).toBe(1);
      // 150×$1 + 100×$2 + 250×$1 = $600
      expect(s.totalCostMicros).toBe(600_000_000);
    });

    it('blocks when a line is short', { tags: ['edge-case'] }, () => {
      const s = allocationSummary(LINES, {
        ol1: [{ supplierId: 'A', qty: 200 }],
        ol2: [{ supplierId: 'A', qty: 250 }],
      }, {}, cost);
      expect(s.allBalanced).toBe(false);
      expect(s.lines[0].remaining).toBe(50);
    });

    it('reports over-allocation rather than clamping it', { tags: ['edge-case'] }, () => {
      const s = allocationSummary(LINES, {
        ol1: [{ supplierId: 'A', qty: 300 }],
        ol2: [{ supplierId: 'A', qty: 250 }],
      }, {}, cost);
      expect(s.allBalanced).toBe(false);
      // Negative, not zero: a typo must be visible, not silently capped.
      expect(s.lines[0].remaining).toBe(-50);
    });

    it('is not balanced when a line has no allocation at all', { tags: ['edge-case'] }, () => {
      const s = allocationSummary(LINES, { ol1: [{ supplierId: 'A', qty: 250 }] }, {}, cost);
      expect(s.allBalanced).toBe(false);
      expect(s.lines[1].rows).toEqual([]);
      expect(s.lines[1].remaining).toBe(250);
    });

    it('is not balanced when there are no lines', { tags: ['edge-case'] }, () => {
      // Nothing to award is not the same as everything awarded.
      expect(allocationSummary([], {}, {}, cost).allBalanced).toBe(false);
    });

    it('treats an unpriced supplier as zero cost, not as a crash', () => {
      const s = allocationSummary(LINES, {
        ol1: [{ supplierId: 'unknown', qty: 250 }],
        ol2: [{ supplierId: 'A', qty: 250 }],
      }, {}, {
        unit: (_l: string, sup: string) => (sup === 'A' ? 1_000_000 : null),
        material: () => null,
      });
      expect(s.allBalanced).toBe(true);
      expect(s.lines[0].costMicros).toBe(0);
    });
  });

  describe('dealMaterialRoles', { tags: ['smoke'] }, () => {
    it('lists every quoted material once', () => {
      const deal = buildDeal(lineWithMaterials(), ROLES, TEMPLATES, [], 'c1');
      expect(dealMaterialRoles(deal).sort()).toEqual(['card', 'carrier', 'features', 'setup']);
    });
  });
});
