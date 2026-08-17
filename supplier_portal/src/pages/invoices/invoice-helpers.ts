/**
 * What this supplier is owed.
 *
 * Two separate sources of money, and they must not be conflated: the CARDS
 * (order_line qty × unit_price on the PO itself) and the EXTRAS (expense rows
 * raised against the PO — freight, additional spec). Only the extras carry an
 * `expense.status`; the card value is payable on the terms of the PO.
 *
 * Every figure here is `unit_cost_micros` — what Fiserv pays this supplier.
 * The re-bill price to the client is never read.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText, asNumber } from '@/lib/runtime';
import type { SupplierInvoiceListRow } from '@/types/saved-queries.generated';

/** Micros are the storage unit; a dollar is 1,000,000 of them. */
export const MICROS = 1_000_000;

export function fromMicros(v: number | null | undefined): number {
  const n = asNumber(v);
  return n === null ? 0 : n / MICROS;
}

export function formatUsd(dollars: number): string {
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface InvoiceRow {
  id: string;
  orderCode: string;
  category: string;
  description: string;
  qty: number;
  unitCost: number;
  /** qty × unit cost, in dollars. */
  amount: number;
  status: string;
  createdAt: string | null;
}

export function decorateInvoices(rows: SupplierInvoiceListRow[] | undefined): InvoiceRow[] {
  return (rows ?? [])
    .filter((r) => r.id)
    .map((r) => {
      const qty = asNumber(r.qty) ?? 0;
      const unitCost = fromMicros(r.unit_cost_micros);
      return {
        id: r.id as string,
        orderCode: asText(r.supply_order?.order_code) || '—',
        category: asText(r.category) || 'Extra',
        description: asText(r.description) || 'No description',
        qty,
        unitCost,
        amount: qty * unitCost,
        status: asText(r.status).toLowerCase() || 'draft',
        createdAt: r.created_at ?? null,
      } satisfies InvoiceRow;
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export interface InvoiceTotals {
  billable: number;
  other: number;
  count: number;
}

/**
 * What is actually claimable, kept apart from what is not.
 *
 * A row only counts toward `billable` when it is marked billable — summing
 * every row regardless of status would tell a supplier they are owed money for
 * extras that were raised and then written off.
 */
export function invoiceTotals(rows: InvoiceRow[]): InvoiceTotals {
  let billable = 0;
  let other = 0;
  for (const r of rows) {
    if (r.status === 'billable') billable += r.amount;
    else other += r.amount;
  }
  return { billable, other, count: rows.length };
}
