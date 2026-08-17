/**
 * What a carve-out does to the money.
 *
 * Carving a material out moves the work AND the cost: the assembler stops
 * making that material, so their own price for it comes off their unit cost,
 * and the carve-out maker charges for it separately. GC-1073 is the case these
 * cover — 10,000 cards to IDEMIA at $0.760 with the carrier carved out to
 * Travel Tags at $0.150 against IDEMIA's own $0.200.
 *
 * The panel already showed $7,100 for that split. The bug was that nothing
 * else did: the committed award, IDEMIA's supply order and the award record
 * were all raised at $9,100, paying IDEMIA in full for a carrier they were not
 * making and putting the awarded cost above the $8,797.38 the client had
 * already been quoted. The deduction now has one home, and the write uses it.
 */
import { describe, it, expect } from 'vitest';
import {
  allocationSummary,
  assemblerUnitCostMicros,
  type AllocationCosts,
  type AllocationRow,
  type CarveOut,
} from '@/pages/orders/deal-helpers';

const LINE = 'ol1';
const IDEMIA = 'idemia';
const TRAVEL_TAGS = 'travel-tags';

/** GC-1073's quotes, in micros. Travel Tags declined card body and perso. */
const QUOTES: Record<string, { unit: number | null; byRole: Record<string, number> }> = {
  [IDEMIA]: {
    unit: 760_000,
    byRole: { card: 440_000, features: 80_000, carrier: 200_000, setup: 40_000 },
  },
  [TRAVEL_TAGS]: {
    unit: 180_000,
    byRole: { carrier: 150_000, setup: 30_000 },
  },
};

const costs: AllocationCosts = {
  unit: (_line, supplierId) => QUOTES[supplierId]?.unit ?? null,
  material: (_line, supplierId, role) => QUOTES[supplierId]?.byRole[role] ?? null,
};

const CARRIER_TO_TRAVEL_TAGS: CarveOut[] = [
  { componentRole: 'carrier', supplierId: TRAVEL_TAGS },
];

function summarise(rows: AllocationRow[], carveOuts: CarveOut[] = []) {
  return allocationSummary(
    [{ orderLineId: LINE, tierId: 't1', name: 'Christmas Evergreen', qty: 10_000 }],
    { [LINE]: rows },
    { [LINE]: carveOuts },
    costs,
  );
}

describe('assemblerUnitCostMicros', () => {
  it('is the full quote when nothing is carved out', () => {
    expect(assemblerUnitCostMicros(LINE, IDEMIA, [], costs)).toBe(760_000);
  });

  it('deducts the carved material at the ASSEMBLER’s price, not the maker’s', () => {
    // 0.760 − IDEMIA's own 0.200 carrier = 0.560. Deducting Travel Tags'
    // 0.150 instead would leave IDEMIA holding 0.610 and quietly overpay them
    // the 0.050 difference on every card.
    expect(assemblerUnitCostMicros(LINE, IDEMIA, CARRIER_TO_TRAVEL_TAGS, costs)).toBe(560_000);
  });

  it('deducts every carved material, not just the first', () => {
    const both: CarveOut[] = [
      { componentRole: 'carrier', supplierId: TRAVEL_TAGS },
      { componentRole: 'features', supplierId: TRAVEL_TAGS },
    ];
    expect(assemblerUnitCostMicros(LINE, IDEMIA, both, costs)).toBe(480_000);
  });

  it('clamps at zero rather than crediting us for making the card', () => {
    const everything: CarveOut[] = ['card', 'features', 'carrier', 'setup'].map((role) => ({
      componentRole: role,
      supplierId: TRAVEL_TAGS,
    }));
    expect(assemblerUnitCostMicros(LINE, IDEMIA, everything, costs)).toBe(0);
  });

  it('ignores a role the supplier never priced', () => {
    // Travel Tags declined the card body, so there is nothing of theirs to
    // remove — a missing price is not a zero-cost material.
    expect(
      assemblerUnitCostMicros(LINE, TRAVEL_TAGS, [{ componentRole: 'card', supplierId: IDEMIA }], costs),
    ).toBe(180_000);
  });
});

describe('allocationSummary with a carve-out', () => {
  it('totals the assembler net of the carve-out plus the carve-out itself', () => {
    const summary = summarise([{ supplierId: IDEMIA, qty: 10_000 }], CARRIER_TO_TRAVEL_TAGS);
    // 10,000 × 0.560 = 5,600 to IDEMIA, 10,000 × 0.150 = 1,500 to Travel Tags.
    expect(summary.totalCostMicros).toBe(7_100_000_000);
    expect(summary.lines[0].costMicros).toBe(7_100_000_000);
  });

  it('is dearer without the carve-out — the saving is what the split is for', () => {
    const whole = summarise([{ supplierId: IDEMIA, qty: 10_000 }]);
    expect(whole.totalCostMicros).toBe(7_600_000_000);
  });

  it('never reaches the sum of the line quote and the carve-out', () => {
    // 9,100 was the old answer: the assembler's gross quote plus a carrier
    // somebody else supplied. It is the number to stay away from.
    const summary = summarise([{ supplierId: IDEMIA, qty: 10_000 }], CARRIER_TO_TRAVEL_TAGS);
    expect(summary.totalCostMicros).not.toBe(9_100_000_000);
  });

  it('deducts from each maker on a split line at that maker’s own price', () => {
    const summary = summarise(
      [
        { supplierId: IDEMIA, qty: 6_000 },
        { supplierId: TRAVEL_TAGS, qty: 4_000 },
      ],
      CARRIER_TO_TRAVEL_TAGS,
    );
    // IDEMIA 6,000 × (0.760 − 0.200) = 3,360; Travel Tags 4,000 × (0.180 −
    // 0.150) = 120; carve-out 10,000 × 0.150 = 1,500.
    expect(summary.lines[0].costMicros).toBe(3_360_000_000 + 120_000_000 + 1_500_000_000);
  });

  it('still balances the line — a carve-out is not extra units', () => {
    const summary = summarise([{ supplierId: IDEMIA, qty: 10_000 }], CARRIER_TO_TRAVEL_TAGS);
    expect(summary.lines[0].allocated).toBe(10_000);
    expect(summary.lines[0].balanced).toBe(true);
    expect(summary.carveOutCount).toBe(1);
  });

  it('names the largest quantity holder as the assembler', () => {
    const summary = summarise(
      [
        { supplierId: IDEMIA, qty: 6_000 },
        { supplierId: TRAVEL_TAGS, qty: 4_000 },
      ],
      CARRIER_TO_TRAVEL_TAGS,
    );
    expect(summary.lines[0].assemblerId).toBe(IDEMIA);
  });
});
