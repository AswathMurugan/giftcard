/**
 * Seasonal card templates — seed data for `card_template`.
 *
 * Four holiday designs built from the standard conventions of the category:
 * Thanksgiving's harvest earth tones, Christmas's forest green and gold,
 * Hanukkah's deep blue and gold, and a near-black New Year. The current trend
 * in the category is clean layout, generous space and strong typography rather
 * than busy illustration, so each card is a flat colour field, one geometric
 * motif and one letterspaced line.
 *
 * The artwork is ORIGINAL vector composition — rectangles, circles, polygons
 * and text built here. No retailer's card design is reproduced; published gift
 * card artwork is copyrighted, and the conventions (palette, motif, layout)
 * are what actually transfer.
 *
 * Everything is drawn in millimetres off `geometryFor`, so a template lays out
 * correctly on whatever card format it is later applied to.
 */

import * as fabric from 'fabric';
import { geometryFor, mm, type CardGeometry } from '@/pages/orders/card-geometry';
import { saveCardTemplate } from '@/pages/orders/order-api';

/** Quoted — Fabric builds `${size}px ${family}`, and an unquoted multi-word
 *  family makes that shorthand invalid, which measures text at zero width. */
const FONT = '"Source Sans 3", system-ui, sans-serif';

/**
 * Seasonal palettes. These are CANVAS fills passed to Fabric, not CSS classes,
 * so a Tailwind design token cannot be used — same reason `CardDesigner` keeps
 * its own PAINT block. Kept in one place so the four cards stay coherent.
 * Values follow the category conventions: harvest earth tones, forest green
 * and gold, deep blue and gold, near-black and gold.
 */
/* eslint-disable no-restricted-syntax */
const PALETTE = {
  thanksgiving: {
    body: '#7A3B12', back: '#5A2C0D', sun: '#C8791F', amber: '#E0A944', ink: '#F5E9D7',
  },
  christmas: {
    body: '#0F3D2E', back: '#0A2A20', gold: '#C9A227', trunk: '#8A6F1B',
    ink: '#F2F7F4', muted: '#8FB3A4',
  },
  hanukkah: {
    body: '#0B2A5B', back: '#071D3F', gold: '#D8B65A', flame: '#F4DE9B',
    ink: '#EAF1FB', muted: '#8AA6D0',
  },
  newYear: {
    body: '#12131A', back: '#0B0C12', gold: '#D4AF37', goldDim: '#7A6520',
    ink: '#F3F4F7', muted: '#8E93A3',
  },
} as const;
/* eslint-enable no-restricted-syntax */


interface SeasonalTemplate {
  name: string;
  category: string;
  description: string;
  /** The 12 build parameters. Never identifiers — see templateSpecFrom. */
  spec: Record<string, unknown>;
  build: (geo: CardGeometry) => fabric.FabricObject[];
  buildBack: (geo: CardGeometry) => fabric.FabricObject[];
}

/** Letterspaced display line, positioned in mm from the trim edge. */
function heading(geo: CardGeometry, text: string, topMm: number, fill: string, sizeMm = 5) {
  return new fabric.IText(text, {
    left: geo.trim.left + mm(9),
    top: geo.trim.top + mm(topMm),
    fontFamily: FONT,
    fontSize: mm(sizeMm),
    fontWeight: 700,
    charSpacing: 120,
    fill,
  });
}

/** Small supporting line. */
function caption(geo: CardGeometry, text: string, topMm: number, fill: string) {
  return new fabric.IText(text, {
    left: geo.trim.left + mm(9),
    top: geo.trim.top + mm(topMm),
    fontFamily: FONT,
    fontSize: mm(2.6),
    fontWeight: 600,
    charSpacing: 180,
    fill,
  });
}

/** Hairline rule under a heading. */
function rule(geo: CardGeometry, topMm: number, widthMm: number, fill: string) {
  return new fabric.Rect({
    left: geo.trim.left + mm(9),
    top: geo.trim.top + mm(topMm),
    width: mm(widthMm),
    height: Math.max(1, mm(0.4)),
    fill,
  });
}

/** The shared back face: a rule and the small print. Deliberately plain —
 *  the mag stripe, signature panel and scratch-off are drawn from the spec,
 *  so artwork that repeated them would double up. */
function plainBack(geo: CardGeometry, ink: string) {
  return [
    rule(geo, 42, 40, ink),
    new fabric.IText('Terms apply. Not redeemable for cash.', {
      left: geo.trim.left + mm(9),
      top: geo.trim.top + mm(44),
      fontFamily: FONT,
      fontSize: mm(2.1),
      fill: ink,
      opacity: 0.75,
    }),
  ];
}

const TEMPLATES: SeasonalTemplate[] = [
  {
    name: 'Thanksgiving Harvest',
    category: 'seasonal',
    description:
      'Harvest earth tones — rust body, amber and cream. Matte, no stripe, scratch-off PIN.',
    spec: {
      shape: 'CR80',
      substrate: 'PVC',
      thickness_mil: 30,
      finish: 'Matte',
      front_color_code: PALETTE.thanksgiving.body,
      back_color_code: PALETTE.thanksgiving.back,
      mag_stripe: false,
      sig_panel: 'None',
      scratch_off: true,
      card_brand: 'Private label',
    },
    build: (geo) => [
      // Two overlapping amber discs, cropped by the trim — the harvest-sun
      // motif, kept abstract rather than illustrative.
      new fabric.Circle({
        left: geo.trim.left + geo.trim.width - mm(14),
        top: geo.trim.top - mm(8),
        radius: mm(17),
        fill: PALETTE.thanksgiving.sun,
        opacity: 0.85,
      }),
      new fabric.Circle({
        left: geo.trim.left + geo.trim.width - mm(24),
        top: geo.trim.top + mm(16),
        radius: mm(11),
        fill: PALETTE.thanksgiving.amber,
        opacity: 0.5,
      }),
      heading(geo, 'GIVE THANKS', 20, PALETTE.thanksgiving.ink),
      rule(geo, 29, 26, PALETTE.thanksgiving.sun),
      caption(geo, 'THANKSGIVING', 33, PALETTE.thanksgiving.amber),
    ],
    buildBack: (geo) => plainBack(geo, PALETTE.thanksgiving.ink),
  },
  {
    name: 'Christmas Evergreen',
    category: 'seasonal',
    description:
      'Deep forest green with a gold geometric tree. Gloss, HiCo stripe, white signature panel.',
    spec: {
      shape: 'CR80',
      substrate: 'PVC',
      thickness_mil: 30,
      finish: 'Gloss',
      front_color_code: PALETTE.christmas.body,
      back_color_code: PALETTE.christmas.back,
      mag_stripe: true,
      mag_coercivity: 'HiCo',
      mag_tracks: '1 & 2',
      sig_panel: 'White',
      scratch_off: false,
      card_brand: 'Private label',
    },
    build: (geo) => {
      const cx = geo.trim.left + geo.trim.width - mm(20);
      // Three stacked triangles — the minimalist pine the category has moved
      // toward, in place of a rendered tree.
      const tiers = [
        { top: 9, half: 7 },
        { top: 17, half: 9.5 },
        { top: 26, half: 12 },
      ];
      return [
        ...tiers.map(
          (t) =>
            new fabric.Polygon(
              [
                { x: cx, y: geo.trim.top + mm(t.top) },
                { x: cx + mm(t.half), y: geo.trim.top + mm(t.top + 9) },
                { x: cx - mm(t.half), y: geo.trim.top + mm(t.top + 9) },
              ],
              { fill: PALETTE.christmas.gold },
            ),
        ),
        new fabric.Rect({
          left: cx - mm(1.4),
          top: geo.trim.top + mm(35),
          width: mm(2.8),
          height: mm(4),
          fill: PALETTE.christmas.trunk,
        }),
        heading(geo, "SEASON'S", 18, PALETTE.christmas.ink, 5.6),
        heading(geo, 'GREETINGS', 25, PALETTE.christmas.gold, 5.6),
        caption(geo, 'CHRISTMAS', 36, PALETTE.christmas.muted),
      ];
    },
    buildBack: (geo) => plainBack(geo, PALETTE.christmas.ink),
  },
  {
    name: 'Hanukkah Lights',
    category: 'seasonal',
    description:
      'Rich blue with a nine-branch gold light motif. Matte, no stripe, scratch-off PIN.',
    spec: {
      shape: 'CR80',
      substrate: 'PVC',
      thickness_mil: 30,
      finish: 'Matte',
      front_color_code: PALETTE.hanukkah.body,
      back_color_code: PALETTE.hanukkah.back,
      mag_stripe: false,
      sig_panel: 'None',
      scratch_off: true,
      card_brand: 'Private label',
    },
    build: (geo) => {
      const objects: fabric.FabricObject[] = [];
      const baseY = geo.trim.top + mm(26);
      const startX = geo.trim.left + geo.trim.width - mm(34);
      // Nine candles, the centre one raised — the shamash. Bars and dots
      // rather than a drawn menorah.
      for (let i = 0; i < 9; i += 1) {
        const isShamash = i === 4;
        const h = isShamash ? mm(15) : mm(11);
        const x = startX + i * mm(3.4);
        objects.push(
          new fabric.Rect({
            left: x,
            top: baseY - h,
            width: mm(1.1),
            height: h,
            fill: PALETTE.hanukkah.gold,
          }),
          new fabric.Circle({
            left: x - mm(0.5),
            top: baseY - h - mm(3),
            radius: mm(1.05),
            fill: PALETTE.hanukkah.flame,
          }),
        );
      }
      objects.push(
        new fabric.Rect({
          left: startX - mm(1.5),
          top: baseY,
          width: mm(30),
          height: mm(1.2),
          fill: PALETTE.hanukkah.gold,
        }),
        heading(geo, 'HAPPY', 20, PALETTE.hanukkah.ink, 5.6),
        heading(geo, 'HANUKKAH', 27, PALETTE.hanukkah.gold, 5.6),
        caption(geo, 'FESTIVAL OF LIGHTS', 38, PALETTE.hanukkah.muted),
      );
      return objects;
    },
    buildBack: (geo) => plainBack(geo, PALETTE.hanukkah.ink),
  },
  {
    name: 'New Year Midnight',
    category: 'seasonal',
    description:
      'Near-black soft-touch with a gold radial burst. HiCo stripe, printed signature panel.',
    spec: {
      shape: 'CR80',
      substrate: 'PETG',
      thickness_mil: 30,
      finish: 'Soft-touch',
      front_color_code: PALETTE.newYear.body,
      back_color_code: PALETTE.newYear.back,
      mag_stripe: true,
      mag_coercivity: 'HiCo',
      mag_tracks: '1 & 2',
      sig_panel: 'Printed',
      scratch_off: false,
      card_brand: 'Private label',
    },
    build: (geo) => {
      const cx = geo.trim.left + geo.trim.width - mm(19);
      const cy = geo.trim.top + mm(24);
      const rays: fabric.FabricObject[] = [];
      // Twelve rays — one per month, and a burst that reads as celebration
      // without any illustration.
      for (let i = 0; i < 12; i += 1) {
        rays.push(
          new fabric.Rect({
            left: cx,
            top: cy,
            width: mm(0.9),
            height: mm(i % 2 === 0 ? 13 : 8.5),
            fill: i % 2 === 0 ? PALETTE.newYear.gold : PALETTE.newYear.goldDim,
            originX: 'center',
            originY: 'top',
            angle: i * 30,
          }),
        );
      }
      return [
        ...rays,
        new fabric.Circle({
          left: cx - mm(2.2),
          top: cy - mm(2.2),
          radius: mm(2.2),
          fill: PALETTE.newYear.body,
          stroke: PALETTE.newYear.gold,
          strokeWidth: 1.5,
        }),
        heading(geo, 'HAPPY', 20, PALETTE.newYear.ink, 5.6),
        heading(geo, 'NEW YEAR', 27, PALETTE.newYear.gold, 5.6),
        caption(geo, 'CHEERS TO THE YEAR AHEAD', 38, PALETTE.newYear.muted),
      ];
    },
    buildBack: (geo) => plainBack(geo, PALETTE.newYear.ink),
  },
];

/**
 * Render one face to a PNG data URL for the picker tile.
 *
 * A StaticCanvas, not the live board: the thumbnail has to be the artwork
 * alone, with the card's own background and none of the registration marks.
 * The multiplier keeps the tile small — a full-resolution export would push
 * the jsonb row into the megabytes.
 */
function renderThumbnail(
  geo: CardGeometry,
  objects: fabric.FabricObject[],
  background: string,
): string {
  const canvas = new fabric.StaticCanvas(undefined, {
    width: geo.canvas.width,
    height: geo.canvas.height,
    backgroundColor: background,
  });
  objects.forEach((o) => canvas.add(o));
  canvas.renderAll();
  const url = canvas.toDataURL({ format: 'png', multiplier: 0.5 });
  canvas.dispose();
  return url;
}

/** Build one template's payload without writing it — exported for testing. */
export function buildSeasonalTemplate(t: SeasonalTemplate) {
  const geo = geometryFor(t.spec.shape as string);
  const front = t.build(geo);
  const back = t.buildBack(geo);

  const frontCanvas = new fabric.StaticCanvas(undefined, {
    width: geo.canvas.width,
    height: geo.canvas.height,
  });
  front.forEach((o) => frontCanvas.add(o));
  const backCanvas = new fabric.StaticCanvas(undefined, {
    width: geo.canvas.width,
    height: geo.canvas.height,
  });
  back.forEach((o) => backCanvas.add(o));

  const payload = {
    name: t.name,
    description: t.description,
    category: t.category,
    thumbnail: renderThumbnail(geo, t.build(geo), t.spec.front_color_code as string),
    artworkFront: frontCanvas.toJSON() as unknown,
    artworkBack: backCanvas.toJSON() as unknown,
    spec: t.spec,
  };
  frontCanvas.dispose();
  backCanvas.dispose();
  return payload;
}

/** Names this module seeds — used to skip ones already present. */
export const SEASONAL_TEMPLATE_NAMES = TEMPLATES.map((t) => t.name);

/**
 * Write the seasonal templates.
 *
 * `existing` is the set of template names already saved; anything listed is
 * skipped, so running this twice does not produce duplicates (card_template
 * has no unique constraint on name).
 */
export async function seedSeasonalTemplates(
  existing: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const written: string[] = [];
  for (const t of TEMPLATES) {
    if (existing.has(t.name)) continue;
    await saveCardTemplate(buildSeasonalTemplate(t));
    written.push(t.name);
  }
  return written;
}
