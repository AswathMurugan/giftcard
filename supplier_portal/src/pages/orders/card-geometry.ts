/**
 * Card geometry — driven by the card TYPE, in millimetres.
 *
 * Everything is defined in real print units and converted to pixels once, so
 * changing the spec's `shape` re-derives the whole board: trim, bleed, safe
 * area, feature zones and the rulers all follow the card type rather than a
 * hardcoded CR80 board.
 *
 * Sources for the numbers:
 *   · ISO/IEC 7810 ID-1 (CR80) — 85.60 × 53.98 mm, the standard gift/credit
 *     card; corner radius ~3.18 mm (0.125 in).
 *   · CR79 — 83.90 × 51.00 mm, the common adhesive-card size.
 *   · CR100 — 98.50 × 67.00 mm, the oversize badge format.
 *   · Bleed 3.175 mm (0.125 in) past every edge; safe area the same distance
 *     inside the trim.
 *   · Magnetic stripe 12.7 mm (0.5 in) tall, full width, 5.54 mm from the top
 *     of the back face.
 *   · Print output at 300 DPI.
 */

export interface CardType {
  /** Display name as it appears on the spec. */
  label: string;
  /** Trim width in millimetres. */
  widthMm: number;
  /** Trim height in millimetres. */
  heightMm: number;
  /** Corner radius in millimetres. */
  radiusMm: number;
}

/** Card formats this designer knows how to lay out. */
export const CARD_TYPES: Record<string, CardType> = {
  CR80: { label: 'CR80', widthMm: 85.6, heightMm: 53.98, radiusMm: 3.18 },
  CR79: { label: 'CR79', widthMm: 83.9, heightMm: 51.0, radiusMm: 3.18 },
  CR100: { label: 'CR100', widthMm: 98.5, heightMm: 67.0, radiusMm: 3.18 },
  // The carrier the card is affixed to — a trimmed paper panel, not a card, so
  // it is square-cornered and roughly 5.5 x 3.5 in. Selected by FACE rather
  // than by the spec's `shape`, which describes the card itself.
  CARRIER: { label: 'Carrier', widthMm: 140, heightMm: 90, radiusMm: 0 },
};

/** The format used when a spec has no `shape`, or names one we don't know. */
export const DEFAULT_CARD_TYPE = 'CR80';

/**
 * Resolve a spec's `shape` value to a known card type.
 * Tolerant of case and punctuation ("cr-80", "CR 80") so a hand-entered spec
 * still lays out correctly; unknown values fall back to CR80 rather than
 * rendering nothing.
 */
export function resolveCardType(shape: string | null | undefined): CardType {
  const key = (shape ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CARD_TYPES[key] ?? CARD_TYPES[DEFAULT_CARD_TYPE];
}

/** Bleed past every trimmed edge (0.125 in). */
export const BLEED_MM = 3.175;
/** Safe area inset from the trim (0.125 in). */
export const SAFE_MM = 3.175;

/** Magnetic stripe, on the back face. */
export const MAG_STRIPE_H_MM = 12.7;
export const MAG_STRIPE_TOP_MM = 5.54;

/** Signature panel, on the back face below the stripe. */
export const SIG_PANEL_W_MM = 65;
export const SIG_PANEL_H_MM = 10;
export const SIG_PANEL_LEFT_MM = 5;
export const SIG_PANEL_TOP_MM = 24;

/**
 * Scratch-off panel, on the back face below the signature panel.
 *
 * The opaque patch covering the activation PIN on a gift card. It sits in the
 * band the signature panel leaves free, so a card carrying both still lays out
 * without the two overlapping.
 */
export const SCRATCH_W_MM = 45;
export const SCRATCH_H_MM = 9;
export const SCRATCH_LEFT_MM = 5;
export const SCRATCH_TOP_MM = 38;

/** On-screen scale. 7 px/mm keeps a CR80 board ~600px wide. */
export const PX_PER_MM = 7;

/** Print resolution the exported artwork must reach. */
export const PRINT_DPI = 300;
/** 1 inch = 25.4 mm, so screen DPI is derived from the mm scale. */
export const SCREEN_DPI = PX_PER_MM * 25.4;
/** `toDataURL({ multiplier })` factor to lift the board to print DPI. */
export const EXPORT_MULTIPLIER = PRINT_DPI / SCREEN_DPI;

/** Gutter reserved for the mm rulers, in pixels. */
export const RULER = 26;

export const mm = (value: number) => Math.round(value * PX_PER_MM);

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardGeometry {
  type: CardType;
  /** Full canvas including bleed on all four sides. */
  canvas: { width: number; height: number };
  /** Bleed edge — the outer boundary artwork must reach. */
  bleed: Rect;
  /** Trim — where the blade cuts. */
  trim: Rect;
  /** Safe area — keep text and logos inside. */
  safe: Rect;
  /** Corner radius in px. */
  radius: number;
  /** Magnetic stripe band (back face). */
  magStripe: Rect;
  /** Signature panel (back face). */
  sigPanel: Rect;
  /** Scratch-off PIN panel (back face). */
  scratchOff: Rect;
}

/** Derive every board rectangle for a card type. */
export function geometryFor(shape: string | null | undefined): CardGeometry {
  const type = resolveCardType(shape);
  const bleedPx = mm(BLEED_MM);
  const safePx = mm(SAFE_MM);
  const trimW = mm(type.widthMm);
  const trimH = mm(type.heightMm);

  return {
    type,
    canvas: { width: trimW + bleedPx * 2, height: trimH + bleedPx * 2 },
    bleed: { left: 0, top: 0, width: trimW + bleedPx * 2, height: trimH + bleedPx * 2 },
    trim: { left: bleedPx, top: bleedPx, width: trimW, height: trimH },
    safe: {
      left: bleedPx + safePx,
      top: bleedPx + safePx,
      width: trimW - safePx * 2,
      height: trimH - safePx * 2,
    },
    radius: mm(type.radiusMm),
    magStripe: {
      left: 0,
      top: bleedPx + mm(MAG_STRIPE_TOP_MM),
      width: trimW + bleedPx * 2,
      height: mm(MAG_STRIPE_H_MM),
    },
    sigPanel: {
      left: bleedPx + mm(SIG_PANEL_LEFT_MM),
      top: bleedPx + mm(SIG_PANEL_TOP_MM),
      width: mm(SIG_PANEL_W_MM),
      height: mm(SIG_PANEL_H_MM),
    },
    scratchOff: {
      left: bleedPx + mm(SCRATCH_LEFT_MM),
      top: bleedPx + mm(SCRATCH_TOP_MM),
      width: mm(SCRATCH_W_MM),
      height: mm(SCRATCH_H_MM),
    },
  };
}

/**
 * Standard element placement, in mm from the TRIM edge (ISO/IEC 7811 zones).
 * Positions are relative to the trim, so they stay right on any card format.
 */
export const ELEMENT_MM = {
  chip: { left: 13.5, top: 19.2, width: 12.7, height: 10 },
  cardNumber: { left: 13.5, top: 30.5, fontSize: 5.2 },
  smallNumber: { left: 13.5, top: 38.5, fontSize: 2.6 },
  validThru: { left: 34, top: 41.5, fontSize: 2.6 },
  holderName: { left: 13.5, top: 46.5, fontSize: 3.2 },
  brandName: { right: 6, top: 6, fontSize: 3.6 },
  /** Back: CVV sits at the right end of the signature panel. */
  cvv: { right: 12, fontSize: 3.2 },
} as const;

/** Ruler tick positions in mm, every 5mm plus the exact card edge. */
export function rulerTicks(lengthMm: number): number[] {
  const ticks: number[] = [];
  for (let v = 0; v < lengthMm; v += 5) ticks.push(v);
  ticks.push(Number(lengthMm.toFixed(2)));
  return ticks;
}
