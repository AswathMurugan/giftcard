/**
 * Suppliers page — joins done client-side, as the saved queries intend.
 *
 * `supplier_board` returns two UNJOINED lists in one call (`suppliers` and
 * `supplier_rfes`) so that a supplier with no RFE still appears. The other
 * three lists — capacity, certifications, price history — each carry their own
 * supplier reference and are joined here on id.
 *
 * Values are read defensively: the generated types come from DECLARED
 * attribute types, and the backend can return a different runtime shape.
 */

import { asNumber, asText } from '@/lib/runtime';

export interface SupplierParty {
  id?: string;
  name?: string;
  kind?: string;
  status?: string;
}

export interface SupplierRfe {
  id?: string;
  status?: string;
  respond_by?: string;
  supplier?: { id?: string; name?: string } | null;
  demand_order?: {
    id?: string;
    order_code?: string;
    order_brief?: string;
    requested_delivery?: string;
    buyer_party_id?: { id?: string; name?: string } | null;
    tq_instance?: {
      current_status?: { tq_state_definition?: { state?: string } } | null;
    } | null;
  } | null;
}

export interface SupplierBoardResult {
  suppliers?: SupplierParty[];
  supplier_rfes?: SupplierRfe[];
}

export interface CapacityRow {
  id?: string;
  /** Period key, e.g. `2026-08`. */
  period?: string;
  /** Declared units for the period. */
  declared?: number;
  /** Already committed units. */
  committed?: number;
  supplier?: { id?: string; name?: string } | null;
}

export interface CertRow {
  id?: string;
  certification?: string;
  valid_until?: string;
  supplier?: { id?: string; name?: string } | null;
}

export interface PriceRow {
  id?: string;
  signature_hash?: string;
  tier_qty?: number;
  unit_cost?: number;
  observed_at?: string;
  party?: { id?: string; name?: string } | null;
}

/** One supplier with everything known about them. */
export interface SupplierCard {
  id: string;
  name: string;
  status: string;
  rfes: SupplierRfe[];
  /** RFEs still awaiting a response. */
  awaiting: number;
  capacity: CapacityRow[];
  certs: CertRow[];
  prices: PriceRow[];
}

/**
 * Remaining capacity for a period.
 *
 * Null when nothing is declared — reporting 0 would read as "full", which is
 * the opposite of "we don't know". An undeclared supplier is shown as unknown
 * rather than excluded, matching the demo's own rule that suppliers with
 * missing data are never silently dropped.
 */
export function remainingUnits(row: CapacityRow): number | null {
  const declared = asNumber(row.declared);
  if (declared === null) return null;
  return declared - (asNumber(row.committed) ?? 0);
}

/** Percentage of declared capacity committed, or null if undeclared. */
export function utilisationPct(row: CapacityRow): number | null {
  const declared = asNumber(row.declared);
  if (declared === null || declared <= 0) return null;
  return Math.round(((asNumber(row.committed) ?? 0) / declared) * 100);
}

/**
 * Build one card per supplier.
 *
 * Driven by the `suppliers` list, not by the RFEs: a supplier with no RFE has
 * to appear, which is the whole reason `supplier_board` returns both lists.
 */
export function buildSupplierCards(
  board: SupplierBoardResult | null | undefined,
  capacity: CapacityRow[],
  certs: CertRow[],
  prices: PriceRow[],
): SupplierCard[] {
  const rfes = board?.supplier_rfes ?? [];
  return (board?.suppliers ?? [])
    .filter((s) => s.id)
    .map((s) => {
      const id = s.id as string;
      const mine = rfes.filter((r) => r.supplier?.id === id);
      return {
        id,
        name: asText(s.name) || 'Unnamed supplier',
        status: asText(s.status) || 'unknown',
        rfes: mine,
        awaiting: mine.filter((r) => asText(r.status) === 'sent').length,
        capacity: capacity.filter((c) => c.supplier?.id === id),
        certs: certs.filter((c) => c.supplier?.id === id),
        prices: prices.filter((p) => p.party?.id === id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive name match for the search box. */
export function matchesSupplier(card: SupplierCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    card.name.toLowerCase().includes(q) ||
    card.rfes.some((r) =>
      asText(r.demand_order?.order_code).toLowerCase().includes(q),
    )
  );
}
