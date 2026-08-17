/**
 * Card designer — Fabric.js board for one card face.
 *
 * `card_spec.artwork_front` / `artwork_back` are jsonb columns holding Fabric
 * canvas JSON, so Fabric both renders and authors them and the round-trip is
 * lossless.
 *
 * The board is driven by the card TYPE (`card_spec.shape`): changing the spec
 * from CR80 to CR79/CR100 re-derives the canvas size, trim, bleed, safe area,
 * feature zones and both rulers — see `card-geometry.ts`.
 *
 * Guides are marked `excludeFromExport` + `selectable: false`, so they steer
 * the designer without ever being serialised into the artwork or dragged by
 * accident. Saved JSON contains only real artwork.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as fabric from 'fabric';
import {
  ELEMENT_MM,
  mm,
  EXPORT_MULTIPLIER,
  PX_PER_MM,
  RULER,
  geometryFor,
  rulerTicks,
} from './card-geometry';

/**
 * A printed surface of the card spec.
 *
 * The carrier is a face, not a separate order line: it is printed from the
 * same spec, quoted as one of that card's materials, and travels with it.
 */
export type CardFace = 'front' | 'back' | 'carrier';

export interface CardDesignerHandle {
  toJSON: () => Record<string, unknown>;
  toPreviewDataUrl: () => string;
  undo: () => void;
  redo: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  setPreview: (on: boolean) => void;
  addText: () => void;
  addRect: () => void;
  addCircle: () => void;
  addImage: (file: File) => void;
  deleteSelected: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  setFill: (color: string) => void;
  /** Drop a standard card element at its ISO placement. */
  addElement: (kind: CardElement) => void;
}

/** Standard credit/gift-card furniture the studio can place. */
export type CardElement =
  | 'chip'
  | 'cardNumber'
  | 'validThru'
  | 'holderName'
  | 'brandName'
  | 'magStripe'
  | 'sigPanel'
  | 'cvv';

export interface CardDesignerProps {
  artwork?: unknown;
  face: CardFace;
  /** `card_spec.shape` — drives the whole board. */
  shape?: string | null;
  background?: string | null;
  /** `card_spec.finish` — drives the surface sheen on the preview. */
  finish?: string | null;
  magStripe?: boolean;
  sigPanel?: boolean;
  /** `card_spec.scratch_off` — draws the PIN patch on the back. */
  scratchOff?: boolean;
  /** `card_spec.card_brand` — seeds the Brand element's text. */
  cardBrand?: string | null;
  editable?: boolean;
  onDirty?: () => void;
  onSelectionChange?: (hasSelection: boolean) => void;
  /** Toolbar state: what can be undone/redone and the current zoom. */
  onStateChange?: (state: { canUndo: boolean; canRedo: boolean; zoom: number }) => void;
  handleRef?: (handle: CardDesignerHandle | null) => void;
}

function isFabricJson(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { objects?: unknown }).objects)
  );
}

/**
 * Guide + artwork paint. These are CANVAS colours, not CSS, so a Tailwind
 * token class cannot be used — kept in one place so nothing is scattered.
 */
/* eslint-disable-next-line no-restricted-syntax */
const PAINT = {
  trim: '#C0392B',
  safe: '#2F55D4',
  feature: '#7357AE',
  bleed: 'rgba(28,28,28,0.35)',
  magStripe: 'rgba(28,28,28,0.85)',
  sigPanel: '#FFFFFF',
  scratchOff: '#B9BDC4',
  ink: '#1C1C1C',
  smartGuide: '#E5399B',
  cardInk: '#FFFFFF',
  chipGold: '#D4AF37',
  chipEdge: 'rgba(0,0,0,0.35)',
  stripeInk: '#111111',
  gold: '#9E7B19',
  teal: '#2C8F86',
} as const;

/**
 * Font stacks for canvas text.
 *
 * The family MUST be quoted. Fabric builds the CSS font shorthand as
 * `${fontSize}px ${fontFamily}`, so an unquoted `Source Sans 3` produces
 * `20px Source Sans 3, …` — invalid CSS, which makes text measurement return
 * zero width. The object then exists and is selectable but paints nothing.
 */
const FONT_SANS = '"Source Sans 3", system-ui, sans-serif';
const FONT_MONO = '"SF Mono", "Menlo", "Consolas", monospace';

/** Distance (px) within which a dragged object snaps to an alignment. */
const SNAP_TOLERANCE = 5;

/** Marks the transient pink alignment lines so they're never treated as art. */
const SMART_GUIDE = 'smartGuide';

const GUIDE_PROPS = {
  selectable: false,
  evented: false,
  excludeFromExport: true,
  hoverCursor: 'default',
} as const;

/**
 * Board furniture splits in two, and the split matters at capture time.
 *
 * REGISTRATION marks (bleed, trim, safe area) are instructions to the
 * operator — they must never appear in a captured image, or the spec sheet
 * sent to a supplier shows red and blue rules across the artwork.
 *
 * PHYSICAL features (magnetic stripe, signature panel, scratch-off patch,
 * finish sheen) are part of the manufactured card and must stay.
 *
 * Both were `excludeFromExport`, which only governs serialisation and not
 * rendering, so a capture included every one of them.
 */
const REGISTRATION_KEY = 'registration';

function asRegistration<T extends object>(o: T): T {
  (o as { [REGISTRATION_KEY]?: boolean }).registration = true;
  return o;
}

function isRegistration(o: unknown): boolean {
  return Boolean((o as { registration?: boolean })?.registration);
}

export function CardDesigner({
  artwork,
  face,
  shape,
  background,
  finish,
  magStripe = false,
  sigPanel = false,
  scratchOff = false,
  cardBrand,
  editable = true,
  onDirty,
  onSelectionChange,
  onStateChange,
  handleRef,
}: CardDesignerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const onDirtyRef = useRef(onDirty);
  const onSelectionRef = useRef(onSelectionChange);

  const onStateRef = useRef(onStateChange);
  useEffect(() => {
    onDirtyRef.current = onDirty;
    onSelectionRef.current = onSelectionChange;
    onStateRef.current = onStateChange;
  }, [onDirty, onSelectionChange, onStateChange]);

  // Memoised on `shape`: rebuilding this object every render changed the
  // identity of drawGuides, which re-ran the artwork effect on every render —
  // reloading the canvas and wiping the undo history each time.
  const geo = useMemo(() => geometryFor(shape), [shape]);
  const CW = geo.canvas.width;
  const CH = geo.canvas.height;

  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  /**
   * Undo/redo history of ARTWORK snapshots.
   *
   * `toJSON()` already omits the guides (they carry `excludeFromExport`), so a
   * snapshot is exactly the artwork — undo can never resurrect a stale guide.
   * `suspend` stops the loads performed BY undo/redo from being recorded as new
   * history entries, which would otherwise make undo un-undoable.
   */
  const historyRef = useRef<{ stack: string[]; index: number }>({
    stack: [],
    index: -1,
  });
  const suspendRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncHistoryFlags = useCallback(() => {
    const h = historyRef.current;
    setCanUndo(h.index > 0);
    setCanRedo(h.index >= 0 && h.index < h.stack.length - 1);
  }, []);

  /** Record the current artwork as a history entry. */
  const pushHistory = useCallback(
    (canvas: fabric.Canvas) => {
      if (suspendRef.current) return;
      const snapshot = JSON.stringify(canvas.toJSON());
      const h = historyRef.current;
      if (h.stack[h.index] === snapshot) return;
      // Drop any redo branch — a fresh edit invalidates it.
      h.stack = h.stack.slice(0, h.index + 1);
      h.stack.push(snapshot);
      h.index = h.stack.length - 1;
      syncHistoryFlags();
    },
    [syncHistoryFlags],
  );

  /** Redraw the non-exported print guides above whatever artwork is loaded. */
  const drawGuides = useCallback(
    (canvas: fabric.Canvas) => {
      canvas
        .getObjects()
        .filter((o) => (o as { excludeFromExport?: boolean }).excludeFromExport)
        .forEach((o) => canvas.remove(o));

      // Bleed — the outer boundary background art must reach.
      canvas.add(
        asRegistration(
          new fabric.Rect({
            left: 0.5,
            top: 0.5,
            width: geo.bleed.width - 1,
            height: geo.bleed.height - 1,
            rx: geo.radius,
            ry: geo.radius,
            fill: 'transparent',
            stroke: PAINT.bleed,
            strokeWidth: 1,
            strokeDashArray: [5, 4],
            ...GUIDE_PROPS,
          }),
        ),
      );

      // Trim — where the blade cuts.
      canvas.add(
        asRegistration(
          new fabric.Rect({
            ...geo.trim,
            rx: geo.radius,
            ry: geo.radius,
            fill: 'transparent',
            stroke: PAINT.trim,
            strokeWidth: 1.5,
            ...GUIDE_PROPS,
          }),
        ),
      );

      // Safe area — text and logos stay inside.
      canvas.add(
        asRegistration(
          new fabric.Rect({
            ...geo.safe,
            fill: 'transparent',
            stroke: PAINT.safe,
            strokeWidth: 1,
            strokeDashArray: [4, 3],
            ...GUIDE_PROPS,
          }),
        ),
      );

      // Surface finish. Gloss lifts a highlight across the card, soft-touch
      // flattens it — enough to tell the finishes apart on screen without
      // pretending to be a render.
      const sheen =
        finish === 'Gloss' ? 0.16 : finish === 'Frosted' ? 0.08 : 0;
      if (sheen > 0) {
        canvas.add(
          new fabric.Rect({
            left: geo.trim.left,
            top: geo.trim.top,
            width: geo.trim.width,
            height: geo.trim.height / 2,
            rx: geo.radius,
            ry: geo.radius,
            fill: `rgba(255,255,255,${sheen})`,
            ...GUIDE_PROPS,
          }),
        );
      }

      // Feature zones live on the back, and only when the spec calls for them.
      if (face === 'back' && magStripe) {
        canvas.add(
          new fabric.Rect({ ...geo.magStripe, fill: PAINT.magStripe, ...GUIDE_PROPS }),
        );
      }
      if (face === 'back' && sigPanel) {
        canvas.add(
          new fabric.Rect({
            ...geo.sigPanel,
            fill: PAINT.sigPanel,
            stroke: PAINT.feature,
            strokeWidth: 1,
            ...GUIDE_PROPS,
          }),
        );
      }
      if (face === 'back' && scratchOff) {
        canvas.add(
          new fabric.Rect({
            ...geo.scratchOff,
            fill: PAINT.scratchOff,
            stroke: PAINT.feature,
            strokeWidth: 1,
            rx: 2,
            ry: 2,
            ...GUIDE_PROPS,
          }),
        );
      }

      canvas.requestRenderAll();
    },
    [geo, face, magStripe, sigPanel, scratchOff, finish],
  );

  /**
   * Scale the board. Fabric's zoom scales the SCENE, so the element must grow
   * with it or the card gets clipped; the rulers use the same factor so their
   * millimetres keep matching the artwork.
   */
  const applyZoom = useCallback(
    (next: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const z = Math.min(3, Math.max(0.25, Number(next.toFixed(2))));
      canvas.setZoom(z);
      canvas.setDimensions({ width: CW * z, height: CH * z });
      canvas.requestRenderAll();
      setZoom(z);
    },
    [CW, CH],
  );

  /** Load a history snapshot without recording it as a fresh edit. */
  const restoreSnapshot = useCallback(
    (canvas: fabric.Canvas, snapshot: string) => {
      suspendRef.current = true;
      void canvas
        .loadFromJSON(JSON.parse(snapshot))
        .then(() => {
          drawGuides(canvas);
          canvas.requestRenderAll();
        })
        .finally(() => {
          suspendRef.current = false;
          syncHistoryFlags();
          onDirtyRef.current?.();
        });
    },
    [drawGuides, syncHistoryFlags],
  );

  /**
   * PowerPoint-style smart guides.
   *
   * While an object is dragged, its left/centre/right and top/middle/bottom
   * edges are compared against the same edges of every other object AND the
   * card's own trim box. The nearest match inside SNAP_TOLERANCE wins: the
   * object is nudged onto it and a pink line is drawn so the alignment is
   * visible.
   *
   * The lines are transient (removed on drop) and flagged `excludeFromExport`,
   * so they never reach the saved artwork and never act as snap targets
   * themselves.
   */
  const attachSmartGuides = useCallback(
    (canvas: fabric.Canvas) => {
      const clearGuides = () => {
        canvas
          .getObjects()
          .filter((o) => (o as { guideKind?: string }).guideKind === SMART_GUIDE)
          .forEach((o) => canvas.remove(o));
      };

      const drawLine = (coords: [number, number, number, number]) => {
        const line = new fabric.Line(coords, {
          stroke: PAINT.smartGuide,
          strokeWidth: 1,
          strokeDashArray: [4, 3],
          ...GUIDE_PROPS,
        });
        (line as unknown as { guideKind?: string }).guideKind = SMART_GUIDE;
        canvas.add(line);
        canvas.bringObjectToFront(line);
      };

      const onMoving = (e: { target?: fabric.FabricObject }) => {
        const moving = e.target;
        if (!moving) return;
        clearGuides();

        const b = moving.getBoundingRect();
        // Candidate anchors on the card itself, so shapes align to the card
        // centre and edges as well as to each other.
        const vTargets: number[] = [
          geo.trim.left,
          geo.trim.left + geo.trim.width / 2,
          geo.trim.left + geo.trim.width,
        ];
        const hTargets: number[] = [
          geo.trim.top,
          geo.trim.top + geo.trim.height / 2,
          geo.trim.top + geo.trim.height,
        ];

        for (const other of canvas.getObjects()) {
          if (other === moving) continue;
          if ((other as { excludeFromExport?: boolean }).excludeFromExport) continue;
          const o = other.getBoundingRect();
          vTargets.push(o.left, o.left + o.width / 2, o.left + o.width);
          hTargets.push(o.top, o.top + o.height / 2, o.top + o.height);
        }

        // Which edge of the moving object each anchor could line up with.
        const vEdges = [b.left, b.left + b.width / 2, b.left + b.width];
        const hEdges = [b.top, b.top + b.height / 2, b.top + b.height];

        let bestV: { delta: number; at: number } | null = null;
        for (const target of vTargets) {
          for (const edge of vEdges) {
            const delta = target - edge;
            if (Math.abs(delta) <= SNAP_TOLERANCE) {
              if (!bestV || Math.abs(delta) < Math.abs(bestV.delta)) {
                bestV = { delta, at: target };
              }
            }
          }
        }

        let bestH: { delta: number; at: number } | null = null;
        for (const target of hTargets) {
          for (const edge of hEdges) {
            const delta = target - edge;
            if (Math.abs(delta) <= SNAP_TOLERANCE) {
              if (!bestH || Math.abs(delta) < Math.abs(bestH.delta)) {
                bestH = { delta, at: target };
              }
            }
          }
        }

        if (bestV) {
          moving.set({ left: (moving.left ?? 0) + bestV.delta });
          drawLine([bestV.at, 0, bestV.at, geo.canvas.height]);
        }
        if (bestH) {
          moving.set({ top: (moving.top ?? 0) + bestH.delta });
          drawLine([0, bestH.at, geo.canvas.width, bestH.at]);
        }
        if (bestV || bestH) moving.setCoords();
      };

      const onDrop = () => {
        clearGuides();
        canvas.requestRenderAll();
      };

      canvas.on('object:moving', onMoving);
      canvas.on('object:modified', onDrop);
      canvas.on('mouse:up', onDrop);

      return () => {
        canvas.off('object:moving', onMoving);
        canvas.off('object:modified', onDrop);
        canvas.off('mouse:up', onDrop);
      };
    },
    [geo],
  );

  // Create the canvas once. Dimensions are applied via setDimensions below so
  // Fabric owns the retina backing store — setting width/height attributes on
  // the element too makes the logical space double and everything renders at
  // half scale.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    // A FRESH <canvas> per mount, created and removed by this effect.
    //
    // React 19 StrictMode double-invokes effects (mount → cleanup → mount) and
    // Fabric 7's dispose() is ASYNC, so the first instance's teardown lands
    // AFTER the second has initialised. Sharing one JSX <canvas> between them
    // let that late teardown corrupt the live canvas's sizing: the element and
    // the object model both measured correct while the paint came out at half
    // scale. Owning the element here means a stale dispose touches a detached
    // node and cannot reach the live board.
    // Clear first: StrictMode mounts twice and Fabric's dispose() is async, so
    // the previous instance's wrapper can still be attached when this one runs.
    // Clearing here (rather than only in cleanup) guarantees exactly one board.
    host.replaceChildren();
    const element = document.createElement('canvas');
    host.appendChild(element);

    const canvas = new fabric.Canvas(element, {
      width: CW,
      height: CH,
      preserveObjectStacking: true,
    });
    canvasRef.current = canvas;

    /**
     * A REAL edit — not the board seeding itself.
     *
     * Loading stored artwork and drawing the guides both add objects, so
     * without the suspend check every mount reported the card as unsaved. That
     * left "Approve design" disabled forever: saving cleared the flag, and the
     * re-render that followed set it again.
     */
    const markDirty = () => {
      if (suspendRef.current) return;
      onDirtyRef.current?.();
      pushHistory(canvas);
    };
    const syncSelection = () =>
      onSelectionRef.current?.(Boolean(canvas.getActiveObject()));

    canvas.on('object:added', markDirty);
    canvas.on('object:modified', markDirty);
    canvas.on('object:removed', markDirty);
    canvas.on('selection:created', syncSelection);
    canvas.on('selection:updated', syncSelection);
    canvas.on('selection:cleared', syncSelection);
    canvas.on('mouse:move', (e) => {
      const p = canvas.getScenePoint(e.e);
      // getScenePoint already undoes the zoom, so this stays in mm.
      setCursor({ x: p.x / PX_PER_MM, y: p.y / PX_PER_MM });
    });
    canvas.on('mouse:out', () => setCursor(null));

    const detachSmartGuides = attachSmartGuides(canvas);

    setReady(true);
    return () => {
      detachSmartGuides();
      canvasRef.current = null;
      setReady(false);
      // Remove ONLY the wrapper this instance created. Clearing the whole host
      // would delete the canvas the StrictMode remount has already put there.
      const wrapper = canvas.wrapperEl;
      void canvas.dispose().finally(() => {
        wrapper?.remove();
      });
    };
  }, [CW, CH, pushHistory, attachSmartGuides]);

  // Load artwork for this face, then draw the guides on top.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    setError(null);

    // Everything from here until the history baseline is the board loading
    // itself; none of it is an edit.
    suspendRef.current = true;

    const finish = () => {
      if (cancelled) {
        suspendRef.current = false;
        return;
      }
      canvas.backgroundColor = background || '#FFFFFF';
      canvas.forEachObject((obj) => {
        if ((obj as { excludeFromExport?: boolean }).excludeFromExport) return;
        obj.selectable = editable;
        obj.evented = editable;
      });
      drawGuides(canvas);
      // Seed history with the loaded state as entry 0. Without a baseline the
      // first edit is the only entry, so undo has nowhere to step back to and
      // redo can never become available.
      historyRef.current = { stack: [JSON.stringify(canvas.toJSON())], index: 0 };
      syncHistoryFlags();
      suspendRef.current = false;
    };

    if (!isFabricJson(artwork)) {
      canvas.clear();
      finish();
      return () => {
        cancelled = true;
      };
    }

    canvas
      .loadFromJSON(artwork)
      .then(finish)
      .catch((e: unknown) => {
        suspendRef.current = false;
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not render this artwork.');
        }
      });

    return () => {
      cancelled = true;
      suspendRef.current = false;
    };
  }, [artwork, background, editable, drawGuides, syncHistoryFlags]);

  // Tool actions, exposed so the Specification panel can host the controls.
  useEffect(() => {
    if (!handleRef) return undefined;

    const withCanvas = (fn: (c: fabric.Canvas) => void) => {
      const canvas = canvasRef.current;
      if (canvas) fn(canvas);
    };

    /**
     * Drop a new object in the middle of the CARD and select it.
     *
     * Centred on the trim rather than the bleed canvas, so it lands where the
     * eye expects on the finished card. New items used to appear small in the
     * top-left corner, which meant dragging every one into view before it
     * could be judged.
     */
    const placeCentred = (canvas: fabric.Canvas, obj: fabric.FabricObject) => {
      const bounds = obj.getBoundingRect();
      obj.set({
        left: geo.trim.left + (geo.trim.width - bounds.width) / 2,
        top: geo.trim.top + (geo.trim.height - bounds.height) / 2,
      });
      obj.setCoords();
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
    };

    handleRef({
      toJSON: () =>
        (canvasRef.current?.toJSON() ?? { objects: [] }) as unknown as Record<
          string,
          unknown
        >,
      // A capture is always guide-free: the stored preview feeds the supplier
      // spec sheet, so registration marks are hidden for the render and put
      // back afterwards regardless of whether preview mode happens to be on.
      toPreviewDataUrl: () => {
        const canvas = canvasRef.current;
        if (!canvas) return '';
        const marks = canvas.getObjects().filter(isRegistration);
        const before = marks.map((o) => o.visible);
        marks.forEach((o) => {
          o.visible = false;
        });
        const url = canvas.toDataURL({ format: 'png', multiplier: EXPORT_MULTIPLIER });
        marks.forEach((o, i) => {
          o.visible = before[i];
        });
        canvas.requestRenderAll();
        return url;
      },
      undo: () =>
        withCanvas((canvas) => {
          const h = historyRef.current;
          if (h.index <= 0) return;
          h.index -= 1;
          restoreSnapshot(canvas, h.stack[h.index]);
        }),
      redo: () =>
        withCanvas((canvas) => {
          const h = historyRef.current;
          if (h.index >= h.stack.length - 1) return;
          h.index += 1;
          restoreSnapshot(canvas, h.stack[h.index]);
        }),
      // Read the live zoom off the canvas rather than the captured `zoom`
      // state: two quick clicks would otherwise both compute from the same
      // stale value and only one step would land.
      zoomIn: () => applyZoom((canvasRef.current?.getZoom() ?? 1) + 0.25),
      zoomOut: () => applyZoom((canvasRef.current?.getZoom() ?? 1) - 0.25),
      zoomReset: () => applyZoom(1),
      setPreview: (on: boolean) =>
        withCanvas((canvas) => {
          // Preview drops the registration marks so the card reads as it will
          // print — the stripe, signature panel and scratch-off patch stay,
          // because those are manufactured onto the card.
          canvas.getObjects().forEach((o) => {
            if (isRegistration(o)) o.visible = !on;
          });
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }),
      addText: () =>
        withCanvas((canvas) => {
          // ~4mm cap height: legible on a card rather than a 20px speck.
          placeCentred(
            canvas,
            new fabric.IText('Text', {
              fontFamily: FONT_SANS,
              fontSize: mm(4),
              fill: PAINT.ink,
            }),
          );
        }),
      addRect: () =>
        withCanvas((canvas) => {
          placeCentred(
            canvas,
            new fabric.Rect({
              width: mm(30),
              height: mm(15),
              fill: PAINT.gold,
              rx: mm(1),
              ry: mm(1),
            }),
          );
        }),
      addCircle: () =>
        withCanvas((canvas) => {
          placeCentred(canvas, new fabric.Circle({ radius: mm(8), fill: PAINT.teal }));
        }),
      addImage: (file: File) =>
        withCanvas((canvas) => {
          const reader = new FileReader();
          reader.onload = () => {
            void fabric.FabricImage.fromURL(String(reader.result)).then((img) => {
              // Background art must reach the BLEED edge, so cover the board.
              const scale = Math.max(CW / (img.width || 1), CH / (img.height || 1));
              img.set({ left: 0, top: 0, scaleX: scale, scaleY: scale });
              canvas.add(img);
              canvas.sendObjectToBack(img);
              canvas.setActiveObject(img);
              canvas.requestRenderAll();
            });
          };
          reader.readAsDataURL(file);
        }),
      deleteSelected: () =>
        withCanvas((canvas) => {
          canvas.getActiveObjects().forEach((o) => canvas.remove(o));
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }),
      bringForward: () =>
        withCanvas((canvas) => {
          const o = canvas.getActiveObject();
          if (o) canvas.bringObjectForward(o);
          canvas.requestRenderAll();
        }),
      sendBackward: () =>
        withCanvas((canvas) => {
          const o = canvas.getActiveObject();
          if (o) canvas.sendObjectBackwards(o);
          canvas.requestRenderAll();
        }),
      addElement: (kind: CardElement) =>
        withCanvas((canvas) => {
          const t = geo.trim;
          // Every position is measured from the TRIM edge, so elements land
          // correctly whatever card format the spec selects.
          const x = (v: number) => t.left + mm(v);
          const y = (v: number) => t.top + mm(v);
          const fromRight = (v: number, w: number) => t.left + t.width - mm(v) - w;
          const mono = FONT_MONO;
          const sans = FONT_SANS;
          let obj: fabric.FabricObject | null = null;

          if (kind === 'chip') {
            // EMV contact plate: gold body with contact separations.
            const w = mm(ELEMENT_MM.chip.width);
            const h = mm(ELEMENT_MM.chip.height);
            const body = new fabric.Rect({
              left: 0, top: 0, width: w, height: h, rx: 4, ry: 4,
              fill: PAINT.chipGold, stroke: PAINT.chipEdge, strokeWidth: 0.75,
            });
            const lines = [
              new fabric.Line([0, h / 3, w, h / 3], { stroke: PAINT.chipEdge, strokeWidth: 0.75 }),
              new fabric.Line([0, (h * 2) / 3, w, (h * 2) / 3], { stroke: PAINT.chipEdge, strokeWidth: 0.75 }),
              new fabric.Line([w / 3, 0, w / 3, h], { stroke: PAINT.chipEdge, strokeWidth: 0.75 }),
              new fabric.Line([(w * 2) / 3, 0, (w * 2) / 3, h], { stroke: PAINT.chipEdge, strokeWidth: 0.75 }),
            ];
            obj = new fabric.Group([body, ...lines], {
              left: x(ELEMENT_MM.chip.left), top: y(ELEMENT_MM.chip.top),
            });
          } else if (kind === 'cardNumber') {
            obj = new fabric.IText('1234 5678 9012 3456', {
              left: x(ELEMENT_MM.cardNumber.left), top: y(ELEMENT_MM.cardNumber.top),
              fontFamily: mono, fontSize: mm(ELEMENT_MM.cardNumber.fontSize),
              fill: PAINT.cardInk, charSpacing: 40,
            });
          } else if (kind === 'validThru') {
            obj = new fabric.IText('VALID\nTHRU  00/00', {
              left: x(ELEMENT_MM.validThru.left), top: y(ELEMENT_MM.validThru.top),
              fontFamily: sans, fontSize: mm(ELEMENT_MM.validThru.fontSize),
              fill: PAINT.cardInk, lineHeight: 1,
            });
          } else if (kind === 'holderName') {
            obj = new fabric.IText('NAME SURNAME', {
              left: x(ELEMENT_MM.holderName.left), top: y(ELEMENT_MM.holderName.top),
              fontFamily: sans, fontSize: mm(ELEMENT_MM.holderName.fontSize),
              fill: PAINT.cardInk, charSpacing: 30,
            });
          } else if (kind === 'brandName') {
            // Seeded from `card_spec.card_brand` so the spec's brand is what
            // lands on the card; still editable, since the brand mark's
            // wording is a design decision, not a spec column.
            const text = new fabric.IText((cardBrand ?? 'BANK NAME').toUpperCase(), {
              fontFamily: sans, fontSize: mm(ELEMENT_MM.brandName.fontSize),
              fill: PAINT.cardInk, charSpacing: 40,
            });
            text.set({
              left: fromRight(ELEMENT_MM.brandName.right, text.width ?? 0),
              top: y(ELEMENT_MM.brandName.top),
            });
            obj = text;
          } else if (kind === 'magStripe') {
            // Real artwork (not the guide): a printed stripe on the back.
            obj = new fabric.Rect({
              left: geo.magStripe.left, top: geo.magStripe.top,
              width: geo.magStripe.width, height: geo.magStripe.height,
              fill: PAINT.stripeInk,
            });
          } else if (kind === 'sigPanel') {
            obj = new fabric.Rect({
              left: geo.sigPanel.left, top: geo.sigPanel.top,
              width: geo.sigPanel.width, height: geo.sigPanel.height,
              fill: PAINT.sigPanel, stroke: PAINT.chipEdge, strokeWidth: 0.75,
            });
          } else if (kind === 'cvv') {
            const text = new fabric.IText('234', {
              fontFamily: mono, fontSize: mm(ELEMENT_MM.cvv.fontSize),
              fill: PAINT.ink,
            });
            text.set({
              left: geo.sigPanel.left + geo.sigPanel.width - (text.width ?? 0) - mm(2),
              top: geo.sigPanel.top + (geo.sigPanel.height - (text.height ?? 0)) / 2,
            });
            obj = text;
          }

          if (!obj) return;
          canvas.add(obj);
          canvas.setActiveObject(obj);
          canvas.requestRenderAll();
        }),
      setFill: (color: string) =>
        withCanvas((canvas) => {
          canvas.getActiveObjects().forEach((o) => o.set({ fill: color }));
          canvas.requestRenderAll();
          onDirtyRef.current?.();
        }),
    });

    return () => handleRef(null);
  }, [handleRef, ready, geo, CW, CH, applyZoom, restoreSnapshot, cardBrand]);

  useEffect(() => {
    onStateRef.current?.({ canUndo, canRedo, zoom });
  }, [canUndo, canRedo, zoom]);

  const hTicks = rulerTicks(geo.type.widthMm);
  const vTicks = rulerTicks(geo.type.heightMm);
  const bleedPx = geo.trim.left;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-auto rounded-lg border border-border bg-surface-alt p-2">
        <div className="relative" style={{ paddingLeft: RULER, paddingTop: RULER }}>
          {/* Horizontal ruler (mm) */}
          <div
            className="absolute text-[9px] text-muted-foreground"
            style={{ left: RULER, top: 0, width: CW * zoom, height: RULER }}
          >
            <span className="absolute -left-[22px] top-2 font-semibold">mm</span>
            {hTicks.map((t) => (
              <span
                key={`h-${t}`}
                className="absolute top-2 -translate-x-1/2 tabular-nums"
                style={{ left: (bleedPx + t * PX_PER_MM) * zoom }}
              >
                {t}
              </span>
            ))}
          </div>

          {/* Vertical ruler (mm) */}
          <div
            className="absolute text-[9px] text-muted-foreground"
            style={{ left: 0, top: RULER, width: RULER, height: CH * zoom }}
          >
            {vTicks.map((t) => (
              <span
                key={`v-${t}`}
                className="absolute right-1.5 -translate-y-1/2 tabular-nums"
                style={{ top: (bleedPx + t * PX_PER_MM) * zoom }}
              >
                {t}
              </span>
            ))}
          </div>

          <div ref={hostRef} />
        </div>

        {/* Cursor position in millimetres; falls back to the card format. */}
        <div className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold tabular-nums text-foreground shadow-xs">
          {cursor
            ? `X ${cursor.x.toFixed(1)}  Y ${cursor.y.toFixed(1)}`
            : `${geo.type.label} · ${geo.type.widthMm} × ${geo.type.heightMm} mm`}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <LegendKey color={PAINT.trim} label="Trim" />
        <LegendKey color={PAINT.bleed} label="Bleed" dashed />
        <LegendKey color={PAINT.safe} label="Safe area" dashed />
        <LegendKey color={PAINT.feature} label="Feature zone" />
        <span className="ml-auto">{geo.type.label} · 300 DPI export</span>
      </div>

      {error ? <span className="text-[12px] text-danger-500">{error}</span> : null}
    </div>
  );
}

function LegendKey({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-3 rounded-[3px]"
        style={{ border: `1.5px ${dashed ? 'dashed' : 'solid'} ${color}` }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export default CardDesigner;
