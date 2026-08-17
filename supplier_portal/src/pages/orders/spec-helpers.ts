/**
 * Specs-stage model.
 *
 * Everything here is derived from REAL `order_card_spec` output — no invented
 * parameters, counts or version codes. The demo screen shows "200 params ·
 * 186 standard"; the actual `card_spec` entity has 16 typed parameter columns
 * plus an open `spec` jsonb bag, so the counts below are computed from what
 * exists rather than mirroring the demo's numbers.
 *
 * `order_card_spec` returns three UNJOINED lists:
 *   lines      — order_line rows for this order (`item` is a jsonb snapshot)
 *   item_revs  — item_revision rows for the WHOLE app, not just this order
 *   specs      — card_spec rows for the WHOLE app, not just this order
 * The join is `lines[].item.item_rev_id → item_revs[].id → specs[].item_rev_id.id`,
 * done client-side (the saved query's own description says so).
 */

import { DEFAULT_CARD_TYPE } from './card-geometry';

export interface OrderCardSpecResult {
  lines?: SpecLineRow[];
  item_revs?: ItemRevisionRow[];
  specs?: CardSpecRow[];
}

export interface SpecLineRow {
  id?: string;
  qty?: number;
  uom?: string | null;
  item?: {
    name?: string;
    description?: string;
    status?: string;
    item_rev_id?: string;
  };
}

export interface ItemRevisionRow {
  id?: string;
  rev?: number;
  status?: string;
  item_id?: { id?: string; name?: string; component_role?: string };
}

export interface CardSpecRow {
  id?: string;
  item_rev_id?: { id?: string };
  shape?: string | null;
  substrate?: string | null;
  thickness_mil?: number | null;
  front_color_code?: string | null;
  back_color_code?: string | null;
  /** The carrier is a printed FACE of this card, like front and back. */
  carrier_color_code?: string | null;
  finish?: string | null;
  mag_stripe?: boolean | null;
  mag_coercivity?: string | null;
  mag_tracks?: string | null;
  sig_panel?: string | null;
  scratch_off?: boolean | null;
  /** HOW variable data is applied — the canvas elements say WHERE. */
  personalization?: string | null;
  bin?: string | null;
  ica?: string | null;
  preprint_bin?: string | null;
  card_brand?: string | null;
  spec?: Record<string, unknown> | null;
  artwork_front?: unknown;
  artwork_back?: unknown;
  artwork_carrier?: unknown;
  artwork_preview?: unknown;
  artwork_pdf_name?: string | null;
  [key: string]: unknown;
}

/** One BOM row: an order line joined to its revision and card spec. */
export interface BomEntry {
  lineId: string;
  /** `item_revision.id` — an RFE bid line is keyed by line AND revision, so
   *  a quote is always against a specific version of the design. */
  itemRevId: string | null;
  name: string;
  description: string;
  /** `card` | `carrier` | null — from item_revision.item_id.component_role. */
  role: string | null;
  qty: number | null;
  rev: number | null;
  revStatus: string | null;
  spec: CardSpecRow | null;
}

/** Join the three lists into one BOM per order line. */
export function buildBom(result: OrderCardSpecResult | null | undefined): BomEntry[] {
  const lines = result?.lines ?? [];
  const revById = new Map<string, ItemRevisionRow>();
  for (const rev of result?.item_revs ?? []) {
    if (rev.id) revById.set(rev.id, rev);
  }
  const specByRevId = new Map<string, CardSpecRow>();
  for (const spec of result?.specs ?? []) {
    const revId = spec.item_rev_id?.id;
    if (revId) specByRevId.set(revId, spec);
  }

  return lines.map((line, index) => {
    const revId = line.item?.item_rev_id;
    const rev = revId ? revById.get(revId) : undefined;
    return {
      lineId: line.id ?? `line-${index}`,
      itemRevId: revId ?? null,
      name: line.item?.name ?? rev?.item_id?.name ?? 'Unnamed item',
      description: line.item?.description ?? '',
      role: rev?.item_id?.component_role ?? null,
      qty: typeof line.qty === 'number' ? line.qty : null,
      rev: typeof rev?.rev === 'number' ? rev.rev : null,
      revStatus: rev?.status ?? line.item?.status ?? null,
      spec: revId ? (specByRevId.get(revId) ?? null) : null,
    };
  });
}

export interface SpecParam {
  key: string;
  label: string;
  /** Rendered value, or null when the column is unset. */
  value: string | null;
  /** Raw column value, for populating an editor. */
  raw: unknown;
  spec: ParamSpec;
}

export interface SpecGroup {
  name: string;
  params: SpecParam[];
}

export type ParamKind = 'text' | 'number' | 'select' | 'boolean' | 'color';

export interface ParamSpec {
  key: keyof CardSpecRow & string;
  label: string;
  /** Optional unit appended when a value exists. */
  unit?: string;
  /** Control to render when editing. Defaults to text. */
  kind?: ParamKind;
  /** Options for `select`. */
  options?: string[];
  /** Body field name expected by `card_spec_save`. */
  saveAs: string;
  /**
   * Value assumed when the column is null. Used where the app already behaves
   * as if the value were set — the board lays out as CR80 regardless — so the
   * control shows the truth rather than "Not set".
   */
  defaultValue?: string | number | boolean;
}

/**
 * The real `card_spec` columns, grouped the way the demo groups them.
 * Deliberately excludes the `spec` jsonb bag — it is currently empty on every
 * row, and inventing a parameter list for it would be fabricating data.
 */
/**
 * Exported so the standalone template studio renders the SAME parameters with
 * the same labels and the same option lists as the in-order spec panel.
 *
 * A second hand-written list would drift the moment a finish or a coercivity is
 * added here, and the two screens would then disagree about what a card can be
 * built as. Callers that must not carry every parameter — a template may not
 * hold issuer identifiers — filter this rather than redeclare it.
 */
export const PARAM_GROUPS: Array<{ name: string; params: ParamSpec[] }> = [
  {
    name: 'Card body',
    params: [
      // Shape drives the whole board geometry, so it is a closed list of the
      // card formats the designer knows how to lay out.
      { key: 'shape', label: 'Shape', kind: 'select', options: ['CR80', 'CR79', 'CR100'], saveAs: 'shape', defaultValue: DEFAULT_CARD_TYPE },
      { key: 'substrate', label: 'Substrate', kind: 'select', options: ['PVC', 'PET', 'PETG', 'Composite', 'Eco'], saveAs: 'substrate' },
      { key: 'thickness_mil', label: 'Thickness', unit: 'mil', kind: 'number', saveAs: 'thicknessMil' },
      { key: 'finish', label: 'Finish', kind: 'select', options: ['Matte', 'Gloss', 'Soft-touch', 'Frosted'], saveAs: 'finish' },
      { key: 'front_color_code', label: 'Front colour', kind: 'color', saveAs: 'frontColorCode' },
      { key: 'back_color_code', label: 'Back colour', kind: 'color', saveAs: 'backColorCode' },
      // The carrier is a third printed face, so its colour belongs here beside
      // the other two rather than on a separate order line.
      { key: 'carrier_color_code', label: 'Carrier colour', kind: 'color', saveAs: 'carrierColorCode' },
    ],
  },
  {
    // Personalization is a BUILD parameter, not a line item: it says how the
    // variable data is applied, which is what a supplier prices the `features`
    // material from. The canvas elements (Number, Name, Valid thru) only say
    // where that data lands on the card.
    name: 'Personalization',
    params: [
      {
        key: 'personalization',
        label: 'Method',
        kind: 'select',
        options: ['None', 'Emboss', 'Indent', 'Laser', 'Thermal', 'Inkjet'],
        saveAs: 'personalization',
      },
    ],
  },
  {
    name: 'Security',
    params: [
      { key: 'mag_stripe', label: 'Mag stripe', kind: 'boolean', saveAs: 'magStripe' },
      { key: 'mag_coercivity', label: 'Coercivity', kind: 'select', options: ['HiCo', 'LoCo'], saveAs: 'magCoercivity' },
      { key: 'mag_tracks', label: 'Tracks', kind: 'select', options: ['1', '2', '1 & 2', '1, 2 & 3'], saveAs: 'magTracks' },
      { key: 'sig_panel', label: 'Signature panel', kind: 'select', options: ['None', 'White', 'Printed'], saveAs: 'sigPanel' },
      { key: 'scratch_off', label: 'Scratch-off', kind: 'boolean', saveAs: 'scratchOff' },
    ],
  },
  {
    name: 'Identifiers',
    params: [
      { key: 'card_brand', label: 'Card brand', kind: 'select', options: ['Visa', 'Mastercard', 'Amex', 'Discover', 'Private label'], saveAs: 'cardBrand' },
      { key: 'bin', label: 'BIN', saveAs: 'bin' },
      { key: 'ica', label: 'ICA', saveAs: 'ica' },
      { key: 'preprint_bin', label: 'Pre-print BIN', saveAs: 'preprintBin' },
    ],
  },
];

/** Total number of typed parameters the spec model carries. */
export const TOTAL_SPEC_PARAMS = PARAM_GROUPS.reduce(
  (n, g) => n + g.params.length,
  0,
);

function renderValue(raw: unknown, unit?: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  const text = String(raw);
  return unit ? `${text} ${unit}` : text;
}

/** Group a spec row's real columns for display; unset columns render as null. */
export function buildSpecGroups(spec: CardSpecRow | null): SpecGroup[] {
  return PARAM_GROUPS.map((group) => ({
    name: group.name,
    params: group.params.map((p) => ({
      key: p.key,
      label: p.label,
      value: spec
        ? (renderValue(spec[p.key], p.unit) ?? renderValue(p.defaultValue, p.unit))
        : null,
      raw: spec ? (spec[p.key] ?? p.defaultValue ?? null) : null,
      spec: p,
    })),
  }));
}

export interface SpecCounts {
  total: number;
  set: number;
  unset: number;
}

/** Honest counts: how many real columns carry a value. */
export function countSpecParams(groups: SpecGroup[]): SpecCounts {
  const all = groups.flatMap((g) => g.params);
  const set = all.filter((p) => p.value !== null).length;
  return { total: all.length, set, unset: all.length - set };
}

/** True when the spec row exists but carries no parameter values at all. */
export function isSpecEmpty(groups: SpecGroup[]): boolean {
  return countSpecParams(groups).set === 0;
}

/** Artwork presence, so the mockup can be honest about having none. */
export function hasArtwork(spec: CardSpecRow | null): boolean {
  if (!spec) return false;
  return Boolean(
    spec.artwork_front || spec.artwork_back || spec.artwork_carrier || spec.artwork_preview,
  );
}
