/**
 * The shipments export and its gaps line.
 *
 * The file exists to answer one question — what is still owed — so the cases
 * that matter are the ones where planned and shipped disagree, and the one
 * where a destination has shipped TWICE. A naive flatten emits a row per
 * despatch, which double-counts the planned quantity for anyone who sums the
 * column; that is the first thing a reader does with this file, so it is
 * tested hardest.
 */
import { describe, it, expect } from 'vitest';
import {
  shipmentExportRows,
  shipmentGaps,
  SHIPMENT_CSV_COLUMNS,
} from '@/pages/orders/shipment-export';
import type { ShipmentRecordRow, ShipmentRow } from '@/pages/orders/fulfilment-helpers';
import { toCsv } from '@/pages/_shared/csv';

const RECORDS: ShipmentRecordRow[] = [
  { id: 'r1', destination: 'Reno, NV', shipment_type: 'Product', qty: 6000, planned_date: '2026-10-15', status: 'planned', supply_order: { id: 'po1', order_code: 'GC-1019-PO1' } },
  { id: 'r2', destination: 'Ontario, CA', shipment_type: 'Product', qty: 2000, status: 'planned', supply_order: { id: 'po1', order_code: 'GC-1019-PO1' } },
  { id: 'r3', destination: 'Dallas, TX', shipment_type: 'Product', qty: 1000, status: 'planned', supply_order: { id: 'po2', order_code: 'GC-1019-PO2' } },
];

const SHIPMENTS: ShipmentRow[] = [
  // r1 fully shipped in two despatches — the double-count trap.
  { id: 's1', shipment_record: { id: 'r1' }, shipped_qty: 4000, carrier: 'FedEx', tracking_no: 'FX1', ship_date: '2026-09-01', shipping_cost_micros: 150_000_000 },
  { id: 's2', shipment_record: { id: 'r1' }, shipped_qty: 2000, carrier: 'UPS', tracking_no: 'UP2', ship_date: '2026-09-05', shipping_cost_micros: 90_000_000 },
  // r2 partially shipped, no cost recorded.
  { id: 's3', shipment_record: { id: 'r2' }, shipped_qty: 500, carrier: 'FedEx', tracking_no: '', ship_date: '2026-09-03' },
  // r3 has nothing.
];

describe('shipmentExportRows', { tags: ['shipping', 'important'] }, () => {
  const rows = shipmentExportRows(RECORDS, SHIPMENTS);

  it('emits exactly one row per destination', { tags: ['smoke'] }, () => {
    expect(rows).toHaveLength(3);
  });

  /** Two despatches against one destination must not become two rows. */
  it('sums despatches instead of repeating the destination', { tags: ['important'] }, () => {
    const reno = rows.find((r) => r.destination === 'Reno, NV');
    expect(reno?.shippedQty).toBe(6000);
    expect(reno?.plannedQty).toBe(6000);
    expect(rows.filter((r) => r.destination === 'Reno, NV')).toHaveLength(1);
  });

  it('computes outstanding rather than leaving it to a formula', () => {
    expect(rows.find((r) => r.destination === 'Reno, NV')?.outstanding).toBe(0);
    expect(rows.find((r) => r.destination === 'Ontario, CA')?.outstanding).toBe(1500);
    expect(rows.find((r) => r.destination === 'Dallas, TX')?.outstanding).toBe(1000);
  });

  it('never reports negative outstanding on an over-shipment', { tags: ['edge-case'] }, () => {
    const over = shipmentExportRows(
      [{ id: 'x', qty: 100, destination: 'D' }],
      [{ id: 's', shipment_record: { id: 'x' }, shipped_qty: 150 }],
    );
    expect(over[0].outstanding).toBe(0);
  });

  it('takes carrier and tracking from the LATEST despatch', { tags: ['logic'] }, () => {
    const reno = rows.find((r) => r.destination === 'Reno, NV');
    expect(reno?.carrier).toBe('UPS');
    expect(reno?.tracking).toBe('UP2');
    expect(reno?.shipDate).toBe('2026-09-05');
  });

  it('converts micros to a plain decimal and sums them', { tags: ['important'] }, () => {
    expect(rows.find((r) => r.destination === 'Reno, NV')?.freightCost).toBe(240);
  });

  /** Blank, not zero — an unrecorded cost is not a free shipment. */
  it('leaves an unrecorded cost null', { tags: ['edge-case'] }, () => {
    expect(rows.find((r) => r.destination === 'Ontario, CA')?.freightCost).toBeNull();
    expect(rows.find((r) => r.destination === 'Dallas, TX')?.freightCost).toBeNull();
  });

  it('reports nothing shipped as zero, not blank', { tags: ['edge-case'] }, () => {
    expect(rows.find((r) => r.destination === 'Dallas, TX')?.shippedQty).toBe(0);
  });

  it('narrows dates to a day', { tags: ['edge-case'] }, () => {
    const r = shipmentExportRows(
      [{ id: 'a', qty: 1, planned_date: '2026-10-15T00:00:00.000Z' }],
      [],
    );
    expect(r[0].plannedDate).toBe('2026-10-15');
  });

  it('survives a record with nothing on it', { tags: ['edge-case'] }, () => {
    const r = shipmentExportRows([{}], []);
    expect(r[0].plannedQty).toBe(0);
    expect(r[0].destination).toBe('');
    expect(r[0].outstanding).toBe(0);
  });
});

describe('shipmentGaps', { tags: ['shipping', 'important'] }, () => {
  const gaps = shipmentGaps(shipmentExportRows(RECORDS, SHIPMENTS));

  it('counts unshipped and partial separately', () => {
    // They mean different things: nothing left the dock, vs. some did and the
    // rest is late. Lumping them hides which one you are looking at.
    expect(gaps.unshipped).toBe(1); // Dallas
    expect(gaps.partial).toBe(1); // Ontario
    expect(gaps.destinations).toBe(3);
  });

  it('totals the units still owed', { tags: ['smoke'] }, () => {
    expect(gaps.unitsOutstanding).toBe(2500);
  });

  it('flags a shipped destination with no tracking', () => {
    expect(gaps.missingTracking).toBe(1); // Ontario shipped with an empty tracking no
  });

  it('flags a shipped destination with no cost', () => {
    expect(gaps.missingCost).toBe(1); // Ontario
  });

  /**
   * An unshipped destination is not "missing" tracking — it has none yet.
   * Counting it would make the gaps line permanently alarming.
   */
  it('does not blame an unshipped destination for missing tracking', { tags: ['important'] }, () => {
    const only = shipmentGaps(shipmentExportRows([{ id: 'z', qty: 500 }], []));
    expect(only.unshipped).toBe(1);
    expect(only.missingTracking).toBe(0);
    expect(only.missingCost).toBe(0);
  });

  it('reports an empty list cleanly', { tags: ['edge-case'] }, () => {
    expect(shipmentGaps([])).toEqual({
      destinations: 0,
      unshipped: 0,
      partial: 0,
      missingTracking: 0,
      missingCost: 0,
      unitsOutstanding: 0,
    });
  });
});

describe('the CSV itself', { tags: ['shipping', 'smoke'] }, () => {
  it('writes a header plus one line per destination', () => {
    const body = toCsv(shipmentExportRows(RECORDS, SHIPMENTS), SHIPMENT_CSV_COLUMNS);
    const lines = body.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('"Outstanding"');
    expect(lines[1]).toContain('"Reno, NV"');
  });

  it('renders a null freight cost as blank', { tags: ['edge-case'] }, () => {
    const body = toCsv(shipmentExportRows([{ id: 'a', qty: 5, destination: 'D' }], []), SHIPMENT_CSV_COLUMNS);
    expect(body.trimEnd().endsWith('""')).toBe(true);
  });
});
