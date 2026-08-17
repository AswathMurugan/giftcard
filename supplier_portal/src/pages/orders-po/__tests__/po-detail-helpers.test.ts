/**
 * What a supplier is shown about their own purchase order — and what they
 * are not. The split-note tests are the important ones: they encode the rule
 * that a supplier learns a split EXISTS without learning who holds the rest.
 */
import { describe, it, expect } from 'vitest';
import {
  buildMilestones,
  chipCaption,
  chipValue,
  decoratePoDetail,
  splitNote,
} from '@/pages/orders-po/po-detail-helpers';
import type { SupplierPoDetailRow } from '@/types/saved-queries.generated';

describe('po-detail-helpers', { tags: ['supplier-po', 'logic'] }, () => {
  describe('chipValue', { tags: ['edge-case'] }, () => {
    it('drops values that carry no information', () => {
      expect(chipValue(null)).toBeNull();
      expect(chipValue(undefined)).toBeNull();
      expect(chipValue('')).toBeNull();
      expect(chipValue('   ')).toBeNull();
    });

    it('renders booleans however the backend spelled them', { tags: ['important'] }, () => {
      // The declared type says string; the column returns all three shapes.
      expect(chipValue(true)).toBe('Yes');
      expect(chipValue(false)).toBe('No');
      expect(chipValue('true')).toBe('Yes');
      expect(chipValue('False')).toBe('No');
    });

    it('passes numbers and plain text through', () => {
      expect(chipValue(30)).toBe('30');
      expect(chipValue('PETG')).toBe('PETG');
      expect(chipValue(0)).toBe('0');
    });
  });

  describe('chipCaption', { tags: ['important'] }, () => {
    it('makes an ambiguous value read on its own', () => {
      // Bare, these render as "Yes · White · 1 & 2" and mean nothing.
      expect(chipCaption('mag_stripe', 'Yes')).toBe('Mag stripe');
      expect(chipCaption('sig_panel', 'White')).toBe('White sig panel');
      expect(chipCaption('mag_tracks', '1 & 2')).toBe('Tracks 1 & 2');
      expect(chipCaption('mag_coercivity', 'HiCo')).toBe('HiCo mag');
      expect(chipCaption('thickness_mil', '30')).toBe('30 mil');
    });

    it('states a negative rather than dropping it', () => {
      // "No mag stripe" is a build instruction; silence is not.
      expect(chipCaption('mag_stripe', 'No')).toBe('No mag stripe');
      expect(chipCaption('scratch_off', 'No')).toBe('No scratch-off');
    });

    it('leaves already-self-describing values alone', () => {
      expect(chipCaption('substrate', 'PETG')).toBe('PETG');
      expect(chipCaption('shape', 'CR80')).toBe('CR80');
      expect(chipCaption('card_brand', 'Private label')).toBe('Private label');
    });
  });

  describe('splitNote', { tags: ['important'] }, () => {
    it('says nothing when the supplier holds the whole order', () => {
      expect(splitNote(5000, 5000)).toBeNull();
      expect(splitNote(6000, 5000)).toBeNull();
    });

    it('says nothing when the parent volume is unknown', { tags: ['edge-case'] }, () => {
      expect(splitNote(5000, null)).toBeNull();
      expect(splitNote(5000, 0)).toBeNull();
    });

    it('names the split without naming the other supplier', () => {
      const note = splitNote(6000, 10000);
      expect(note).toContain('6,000');
      expect(note).toContain('10,000');
      expect(note).toContain('4,000');
      // The whole point: no rival, no price.
      expect(note?.toLowerCase()).not.toContain('cpi');
      expect(note).not.toContain('$');
    });
  });

  describe('buildMilestones', { tags: ['smoke'] }, () => {
    it('marks the awarded step done once acknowledged', () => {
      const m = buildMilestones(1, 'PO In Production', '2026-01-01', '2026-03-01', null);
      expect(m[0].status).toBe('done');
      expect(m[1].status).toBe('current');
      expect(m[2].status).toBe('ahead');
      expect(m[1].note).toBe('on the press');
    });

    it('leaves everything ahead of an unacknowledged order', () => {
      const m = buildMilestones(0, 'PO Raised', '2026-01-01', '2026-03-01', null);
      expect(m[0].status).toBe('current');
      expect(m[0].note).toBe('awaiting your acknowledgment');
      expect(m[2].status).toBe('ahead');
    });

    it('closes every step once shipped, and shows the real ship date', () => {
      const m = buildMilestones(2, 'PO Shipped', '2026-01-01', '2026-03-01', '2026-02-20');
      expect(m.every((x) => x.status === 'done')).toBe(true);
      expect(m[2].date).toBe('2026-02-20');
      expect(m[2].note).toBe('despatched');
    });

    it('holds everything ahead when the stage is unknown', { tags: ['edge-case'] }, () => {
      const m = buildMilestones(-1, '', null, null, null);
      expect(m.map((x) => x.status)).toEqual(['ahead', 'ahead', 'ahead']);
    });
  });

  describe('decoratePoDetail', { tags: ['important'] }, () => {
    const packet = {
      po: {
        id: 'po-1',
        order_code: 'GC-1011-PO1',
        order_brief: 'E2E run',
        requested_delivery: '2026-12-18',
        created_at: '2026-08-17T00:00:00Z',
        tq_instance: {
          id: 'tq-1',
          current_task: { tq_sub_task_definition: { name: 'PO Production' } },
          current_status: { tq_state_definition: { state: 'PO In Production', is_final: false } },
        },
      },
      lines: [
        {
          id: 'l1',
          item: { name: 'Beauty Insider Gloss', item_rev_id: 'rev-1' },
          qty: 5000,
          uom: 'each',
          unit_price: 0.55,
        },
      ],
      parent: [
        {
          id: 'r1',
          parent_order: {
            id: 'ord-1',
            order_code: 'GC-1011',
            buyer_party_id: { id: 'c1', name: 'Sephora' },
          },
        },
      ],
      records: [
        { id: 'rec-1', destination: 'Ontario, CA', qty: 5000, planned_date: null, status: 'planned' },
      ],
      actuals: [
        {
          id: 's1',
          carrier: 'UPS',
          tracking_no: '1Z9',
          ship_date: '2026-08-17',
          shipped_qty: 5000,
          shipment_record: { id: 'rec-1' },
        },
      ],
      specs: [
        { id: 'sp-1', substrate: 'PETG', finish: 'Gloss', mag_stripe: false, item_rev_id: { id: 'rev-1' } },
      ],
    } as unknown as SupplierPoDetailRow;

    it('returns null without a PO', { tags: ['edge-case'] }, () => {
      expect(decoratePoDetail(null)).toBeNull();
      expect(decoratePoDetail({} as SupplierPoDetailRow)).toBeNull();
    });

    it('joins the spec to its line through item_rev_id', () => {
      const d = decoratePoDetail(packet)!;
      const keys = d.lines[0].chips.map((c) => c.key);
      expect(keys).toContain('substrate');
      expect(keys).toContain('finish');
      // A false boolean is still information — "No mag stripe" is a real spec.
      expect(d.lines[0].chips.find((c) => c.key === 'mag_stripe')?.value).toBe('No mag stripe');
    });

    it('carries the supplier total and the parent link', () => {
      const d = decoratePoDetail(packet)!;
      expect(d.totalQty).toBe(5000);
      expect(d.parentCode).toBe('GC-1011');
      expect(d.clientName).toBe('Sephora');
      expect(d.state).toBe('PO In Production');
    });

    it('pairs a despatch with its destination', () => {
      const d = decoratePoDetail(packet)!;
      expect(d.destinations).toHaveLength(1);
      expect(d.destinations[0].shippedQty).toBe(5000);
      expect(d.destinations[0].tracking).toBe('1Z9');
    });

    it('leaves a line without a spec sheet chip-less rather than throwing', { tags: ['edge-case'] }, () => {
      const orphan = {
        ...packet,
        lines: [{ id: 'l2', item: { name: 'Carrier' }, qty: 10, uom: 'each', unit_price: null }],
      } as unknown as SupplierPoDetailRow;
      const d = decoratePoDetail(orphan)!;
      expect(d.lines[0].chips).toEqual([]);
      expect(d.lines[0].unitPrice).toBeNull();
    });
  });
});
