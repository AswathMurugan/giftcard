/**
 * The rules that decide whether a fulfilment stage is finished.
 *
 * These matter more than most: the workflow accepts a signal whenever one is
 * sent, so if a gate is wrong an order walks to Order Close claiming work that
 * never happened. Each case below is one way that used to be possible.
 */
import { describe, it, expect } from 'vitest';
import {
  plannedForSupplyOrder,
  shipProgress,
  stageGate,
  supplierWorkloads,
  unplannedUnits,
  type ShipmentRecordRow,
  type SupplierWorkload,
  type SupplyOrderRow,
} from '@/pages/orders/fulfilment-helpers';
import {
  allProofsApproved,
  buildProofs,
  rejectionReason,
  statusAfterApproval,
  toProofStatus,
  type ProofState,
} from '@/pages/orders/proof-helpers';

function workload(over: Partial<SupplierWorkload> = {}): SupplierWorkload {
  return {
    supplierId: 's1',
    supplierName: 'IDEMIA',
    units: 500,
    carveOuts: [],
    lines: 1,
    costMicros: 2_000_000_000,
    ordered: true,
    allocations: [],
    ...over,
  };
}

function proof(over: Partial<ProofState> = {}): ProofState {
  return {
    type: 'Art proof',
    clientFacing: true,
    hint: '',
    status: 'approved',
    owner: '—',
    round: 1,
    versions: [],
    reviewId: null,
    fileId: 'f1',
    fileName: 'art.pdf',
    ...over,
  };
}

describe('fulfilment gates', { tags: ['orders', 'fulfilment', 'logic'] }, () => {
  describe('Award', { tags: ['important'] }, () => {
    it('refuses an award with nothing allocated', { tags: ['edge-case'] }, () => {
      const gate = stageGate('Award', { workloads: [], proofs: [], progress: [] });
      expect(gate.blocked).toBe(true);
    });

    it('refuses while a supplier still has no supply order', () => {
      const gate = stageGate('Award', {
        workloads: [workload(), workload({ supplierId: 's2', supplierName: 'Thales', ordered: false })],
        proofs: [],
        progress: [],
      });
      expect(gate.blocked).toBe(true);
      expect(gate.reason).toContain('Thales');
    });

    it('passes once every allocated supplier is ordered', () => {
      expect(
        stageGate('Award', { workloads: [workload()], proofs: [], progress: [] }).blocked,
      ).toBe(false);
    });
  });

  describe('Proof', { tags: ['important'] }, () => {
    it('refuses when nothing was ever requested', { tags: ['edge-case'] }, () => {
      expect(
        stageGate('Proof', {
          workloads: [],
          proofs: [proof({ status: 'not_requested' })],
          progress: [],
        }).blocked,
      ).toBe(true);
    });

    it('refuses when the client-facing proof was skipped', () => {
      const gate = stageGate('Proof', {
        workloads: [],
        proofs: [
          proof({ status: 'not_requested' }),
          proof({ type: 'Data proof', clientFacing: false, status: 'approved' }),
        ],
        progress: [],
      });
      expect(gate.blocked).toBe(true);
      expect(gate.reason).toContain('Art proof');
    });

    it('refuses while a requested proof is still open', () => {
      expect(
        stageGate('Proof', {
          workloads: [],
          proofs: [proof({ status: 'awaiting_sign' })],
          progress: [],
        }).blocked,
      ).toBe(true);
    });

    it('passes with the art proof approved and internals untouched', () => {
      expect(
        stageGate('Proof', {
          workloads: [],
          proofs: [proof(), proof({ type: 'Label proof', clientFacing: false, status: 'not_requested' })],
          progress: [],
        }).blocked,
      ).toBe(false);
    });
  });

  describe('Ship', { tags: ['important'] }, () => {
    const record = (id: string, qty: number): ShipmentRecordRow => ({
      id,
      destination: `D-${id}`,
      qty,
      supply_order: { id: 'so1', order_code: 'GC-1-PO1' },
    });

    it('refuses when nothing is planned', { tags: ['edge-case'] }, () => {
      expect(
        stageGate('Ship', { workloads: [], proofs: [], progress: [] }).blocked,
      ).toBe(true);
    });

    it('refuses while a destination is short', () => {
      const progress = shipProgress([record('r1', 500)], [
        { id: 'sh1', shipped_qty: 200, shipment_record: { id: 'r1' } },
      ]);
      const gate = stageGate('Ship', { workloads: [], proofs: [], progress });
      expect(gate.blocked).toBe(true);
      expect(gate.reason).toContain('200/500');
    });

    it(
      'refuses when a whole supply order was never planned, even if what IS planned shipped',
      { tags: ['important'] },
      () => {
        const progress = shipProgress([record('r1', 500)], [
          { id: 'sh1', shipped_qty: 500, shipment_record: { id: 'r1' } },
        ]);
        const gate = stageGate('Ship', {
          workloads: [],
          proofs: [],
          progress,
          unplannedUnits: 500,
        });
        expect(gate.blocked).toBe(true);
        expect(gate.reason).toContain('500');
      },
    );

    it('passes when everything planned shipped and nothing is unplanned', () => {
      const progress = shipProgress([record('r1', 500)], [
        { id: 'sh1', shipped_qty: 500, shipment_record: { id: 'r1' } },
      ]);
      expect(
        stageGate('Ship', { workloads: [], proofs: [], progress, unplannedUnits: 0 }).blocked,
      ).toBe(false);
    });
  });

  describe('Produce and Bill are open', { tags: ['smoke'] }, () => {
    it('has no data-backed exit condition', () => {
      expect(stageGate('Produce', { workloads: [], proofs: [], progress: [] }).blocked).toBe(false);
      expect(stageGate('Bill', { workloads: [], proofs: [], progress: [] }).blocked).toBe(false);
    });
  });
});

describe('shippable quantity', { tags: ['orders', 'fulfilment', 'logic'] }, () => {
  const orders: SupplyOrderRow[] = [
    // The SELLER is the supplier — on a supply order we are the buyer.
    { id: 'r1', kind: 'supply', child_order: { id: 'so1', seller_party_id: { id: 's1' } } },
    { id: 'r2', kind: 'supply', child_order: { id: 'so2', seller_party_id: { id: 's2' } } },
  ];

  it(
    'counts quantity shares only — a carve-out is a component, not extra units',
    { tags: ['important'] },
    () => {
      const grid = {
        allocations: [
          { kind: 'line', qty: 500, unit_cost_micros: 4_000_000, supplier: { id: 's1', name: 'IDEMIA' } },
          { kind: 'carve_out', qty: 1000, unit_cost_micros: 1_000_000, component_role: 'carrier', supplier: { id: 's1', name: 'IDEMIA' } },
        ],
      };
      const [only] = supplierWorkloads(grid, orders);
      expect(only.units).toBe(500);
      expect(only.carveOuts).toHaveLength(1);
      // 500 awarded, nothing planned — NOT 1,500.
      expect(unplannedUnits(orders.slice(0, 1), [only], [])).toBe(500);
    },
  );

  it('subtracts what is already planned, per supply order', () => {
    const records: ShipmentRecordRow[] = [
      { id: 'r', qty: 300, supply_order: { id: 'so1' } },
      { id: 'r2', qty: 100, supply_order: { id: 'so2' } },
    ];
    expect(plannedForSupplyOrder(records, 'so1')).toBe(300);
    expect(
      unplannedUnits(orders, [workload(), workload({ supplierId: 's2', units: 500 })], records),
    ).toBe(200 + 400);
  });

  it('never goes negative when more was planned than awarded', { tags: ['edge-case'] }, () => {
    const records: ShipmentRecordRow[] = [{ id: 'r', qty: 900, supply_order: { id: 'so1' } }];
    expect(unplannedUnits(orders.slice(0, 1), [workload()], records)).toBe(0);
  });
});

describe('proof loop', { tags: ['orders', 'proof', 'logic'] }, () => {
  it('sends a client-facing proof for signature, not straight to approved', { tags: ['important'] }, () => {
    expect(statusAfterApproval(proof({ status: 'in_review' }))).toBe('awaiting_sign');
    expect(statusAfterApproval(proof({ status: 'awaiting_sign' }))).toBe('approved');
  });

  it('completes an internal proof outright', { tags: ['important'] }, () => {
    expect(
      statusAfterApproval(proof({ clientFacing: false, status: 'in_review' })),
    ).toBe('approved');
  });

  it('keeps every round with its own document', () => {
    const [art] = buildProofs([
      { id: 'a', review_kind: 'proof', proof_type: 'Art proof', round: 1, status: 'changes_requested', proof_file_id: 'f1', proof_file_name: 'v1.pdf' },
      { id: 'b', review_kind: 'proof', proof_type: 'Art proof', round: 2, status: 'in_review', proof_file_id: 'f2', proof_file_name: 'v2.pdf' },
    ]);
    expect(art.round).toBe(2);
    expect(art.fileName).toBe('v2.pdf');
    expect(art.versions.map((v) => v.fileName)).toEqual(['v1.pdf', 'v2.pdf']);
    // The open round is actionable; a superseded one is not.
    expect(art.reviewId).toBe('b');
  });

  it('offers no action on a settled round', { tags: ['edge-case'] }, () => {
    const [art] = buildProofs([
      { id: 'a', review_kind: 'proof', proof_type: 'Art proof', round: 1, status: 'approved' },
    ]);
    expect(art.reviewId).toBeNull();
  });

  it('ignores reviews that are not proofs', { tags: ['edge-case'] }, () => {
    const proofs = buildProofs([{ id: 'x', review_kind: 'deal_review', round: 1, status: 'approved' }]);
    expect(proofs.every((p) => p.status === 'not_requested')).toBe(true);
  });

  it('treats a freshly opened round as awaiting the supplier', () => {
    expect(toProofStatus('open')).toBe('awaiting_upload');
    expect(toProofStatus(undefined)).toBe('awaiting_upload');
    expect(toProofStatus('Changes-Requested')).toBe('changes_requested');
  });

  it('needs at least one requested proof before it can be all-approved', { tags: ['edge-case'] }, () => {
    expect(allProofsApproved([proof({ status: 'not_requested' })])).toBe(false);
    expect(allProofsApproved([proof(), proof({ type: 'Data proof', status: 'not_requested' })])).toBe(true);
  });

  it('builds a reason the supplier can act on', () => {
    expect(rejectionReason(['color'], '')).toBe('Color out of brand');
    expect(rejectionReason(['logo', 'legal'], 'front face only')).toBe(
      'Logo placement, Legal text missing — front face only',
    );
    expect(rejectionReason([], '  ')).toBe('');
  });
});

describe('the two sides of the trade', { tags: ['orders', 'award', 'important'] }, () => {
  it('reads the SUPPLIER off the seller, not the buyer', () => {
    // On a supply order WE are the buyer and the manufacturer is the seller.
    // Reading the buyer would have matched the Fiserv entity against every
    // supplier and reported nobody as ordered.
    const grid = {
      allocations: [
        { id: 'a1', kind: 'line', qty: 500, unit_cost_micros: 810_000, supplier: { id: 's1', name: 'IDEMIA' } },
      ],
    };
    const withOrder: SupplyOrderRow[] = [
      {
        id: 'r1',
        kind: 'supply',
        child_order: {
          id: 'so1',
          buyer_party_id: { id: 'fiserv', name: 'Fiserv Card Services' },
          seller_party_id: { id: 's1', name: 'IDEMIA' },
        },
      },
    ];
    expect(supplierWorkloads(grid, withOrder)[0].ordered).toBe(true);
    expect(supplierWorkloads(grid, [])[0].ordered).toBe(false);
  });

  it('carries each allocation so the award can raise a supply line for it', () => {
    const grid = {
      allocations: [
        {
          id: 'a1',
          kind: 'line',
          qty: 5000,
          unit_cost_micros: 810_000,
          supplier: { id: 's1', name: 'IDEMIA' },
          order_line_ref: { id: 'dl1', item: { name: 'Thanksgiving Harvest' }, uom: 'each' },
        },
      ],
    };
    const [w] = supplierWorkloads(grid, []);
    expect(w.allocations).toEqual([
      {
        allocationId: 'a1',
        qty: 5000,
        unitCostMicros: 810_000,
        item: { name: 'Thanksgiving Harvest' },
        uom: 'each',
      },
    ]);
  });

  it('defaults the uom rather than writing an empty one', { tags: ['edge-case'] }, () => {
    const grid = {
      allocations: [{ id: 'a1', kind: 'line', qty: 10, unit_cost_micros: 1, supplier: { id: 's1' } }],
    };
    expect(supplierWorkloads(grid, [])[0].allocations[0].uom).toBe('each');
  });
});
