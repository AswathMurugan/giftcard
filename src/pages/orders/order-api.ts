/**
 * Create-order data plane.
 *
 * Why this exists instead of the usual hooks
 * ------------------------------------------
 * The create-order chain spans two contracts the starter's hooks can't express:
 *
 * 1. **URL-param saved queries.** `useSavedQueryMutation` POSTs a flat JSON
 *    body and never sets query params. That fits queries written against
 *    `$body.<field>` (`order_create`, `order_link_tq`) but NOT ones written
 *    against bare `$param` (`tq_create` → `$taskName`, `tq_sub_task_add` →
 *    `$instanceId`/`$subTaskName`/`$stateName`). Verified against the live
 *    sandbox: the same param sent as `?orderId=…` succeeds, and sent in the
 *    body returns **500**. So param-style queries must go through the URL.
 *
 * 2. **Workflows aren't in the generated registry.** `useWorkflow` is typed by
 *    `src/types/workflows.generated.ts`, which this app has not generated
 *    (the tenant's `/api/internal/*` codegen endpoints are blocked by
 *    CloudFront from outside the VPC). Both workflows we need take a single
 *    string input, so a small typed wrapper is clearer than hand-forging
 *    codegen output.
 *
 * Everything below still goes through `apiManager` + `getDataHeaders`, so auth,
 * tenant/app headers and the 403-refresh interceptor behave exactly as they do
 * for the generated hooks.
 */
import { apiManager } from '@/services/api-manager';
import { getDataHeaders, getDataHeadersWithUser } from '@/config/api-config';
import { getAuthService } from '@/config/auth-service-manager';
import { logger } from '@/utils/logger';

/** The tenant's single task-queue process (`tq_definition.name`). */
export const TASK_DEFINITION_NAME = 'Gift Card Order';

/** First stage + state of that process (`tq_stage_list`, `is_initial: true`). */
export const INITIAL_STAGE = 'Order';
export const INITIAL_STATE = 'Order Received';

/** Long-running order workflow. Input: the tq_instance id. */
export const CREATE_ORDER_WORKFLOW = 'create_order';

/**
 * The PO's own workflow — three stages against the "Supplier Order" process,
 * each waiting on a signal the supplier fires from Relay.
 */
export const SUPPLIER_ORDER_WORKFLOW = 'create_supplier_order';
/**
 * The tenant's demo wrapper around the signal call. NOT used — `sendStageResponse`
 * hits `/v1/signals/{id}/trigger` directly, which is all this workflow does.
 * Kept as a pointer to the tenant-side equivalent.
 */
export const SEND_RESPONSE_WORKFLOW = 'test_send_response';

/** Saved query executed with **URL** params (`$param` substitution). */
export async function runSavedQueryWithParams<T = unknown>(
  name: string,
  params: Record<string, string | number | undefined | null>,
): Promise<T> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  // URLSearchParams form-encodes a space as `+`, which the data-manager reads
  // literally rather than decoding — the same fix the starter applies in
  // `buildSavedQueryRequest`. `Gift Card Order` must arrive with real spaces.
  const qs = search.toString().replace(/\+/g, '%20');
  const url = `/saved-queries/${encodeURIComponent(name)}/execute${qs ? `?${qs}` : ''}`;
  const res = await apiManager.post('data', url, {}, getDataHeaders());
  return res.data as T;
}

/** Saved query executed with a flat JSON **body** (`$body.<field>`). */
export async function runSavedQueryWithBody<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `/saved-queries/${encodeURIComponent(name)}/execute`;
  const res = await apiManager.post('data', url, body, getDataHeaders());
  return res.data as T;
}

/**
 * Execute a workflow.
 *
 * `mode` matters here. The starter's `useWorkflow` only ever calls
 * `/v1/execute/sync/{name}`, which BLOCKS until the run finishes — fine for a
 * short transform, wrong for `create_order`, which drives nine stages and
 * parks on a signal wait at each one. Started synchronously it never returns.
 *
 * The workflow service exposes an async variant (confirmed in the Phoenix
 * workflow OpenAPI spec: `POST /v1/execute/async/{workflowName}`), which
 * enqueues the run and returns immediately. That's what a long-running,
 * signal-driven workflow needs.
 *
 * `getDataHeadersWithUser` adds `X-Jiffy-User-Id`, which the spec marks
 * REQUIRED on both execute routes.
 */
export async function runWorkflow<T = unknown>(
  name: string,
  input: Record<string, unknown>,
  mode: 'async' | 'sync' = 'async',
): Promise<T> {
  const url = `/v1/execute/${mode}/${encodeURIComponent(name)}`;
  const res = await apiManager.post('workflow', url, input, getDataHeadersWithUser());
  return res.data as T;
}

/**
 * Pull the first id out of a saved-query response.
 *
 * CTE writes come back in several shapes depending on the query: a bare row, a
 * `{ data: [...] }` envelope, or an object keyed by the CTE step name (e.g.
 * `tq_create` → `{ inst: { id } }`). Rather than encode each one, walk the
 * structure and take the first `id` found.
 */
export function extractId(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === 'string') return payload || null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractId(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.id === 'string' && obj.id) return obj.id;
    for (const value of Object.values(obj)) {
      const found = extractId(value);
      if (found) return found;
    }
  }
  return null;
}

export interface CreateOrderInput {
  orderCode: string;
  orderBrief: string;
  buyerPartyId: string;
  requestedDelivery: string;
  orderKind?: string;
  orderType?: string;
}

export interface CreateOrderResult {
  orderId: string;
  instanceId: string;
  /** False when the order + task exist but the workflow failed to start. */
  workflowStarted: boolean;
  workflowError?: string;
  /** True when the new order was assigned to a user (vs left claimable). */
  assigned: boolean;
}

/** One step of the chain, surfaced so the UI can show progress honestly. */
export type CreateOrderStep =
  | 'order'
  | 'task'
  | 'stage'
  | 'link'
  | 'assign'
  | 'workflow'
  | 'done';

/**
 * Resolve a process id from its name, cached for the session.
 *
 * `order_start_full` takes `taskDefId` rather than a name: it is a single
 * nested INSERT, and a nested insert can't run a by-name lookup (that needs a
 * CTE). Resolving here keeps the id out of the source — hardcoding a UUID
 * would silently target the wrong process in another environment.
 */
let taskDefinitionIdCache: Record<string, string> = {};

export async function resolveTaskDefinitionId(
  name: string,
): Promise<string | null> {
  if (taskDefinitionIdCache[name]) return taskDefinitionIdCache[name];
  const data = await runSavedQueryWithParams<unknown>('tq_definition_list', {});
  const rows = Array.isArray(data)
    ? data
    : ((data as { data?: unknown[] })?.data ??
      Object.values((data ?? {}) as Record<string, unknown>).find(Array.isArray) ??
      []);
  for (const row of rows as Array<{ id?: string; name?: string }>) {
    if (row?.name && row?.id) taskDefinitionIdCache[row.name] = row.id;
  }
  return taskDefinitionIdCache[name] ?? null;
}

/** Exposed for tests — drops the memoised process ids. */
export function clearTaskDefinitionCache(): void {
  taskDefinitionIdCache = {};
}

/**
 * Read the task instance id linked to an order.
 *
 * A DynQL write returns only the ROOT row's id — the `select` clause's nested
 * links are not echoed — so the instance created by `order_start_full`'s
 * nested insert has to be read back. `order_detail` already projects
 * `tq_instance{id}`, so no new query is needed.
 */
export async function fetchOrderInstanceId(
  orderId: string,
): Promise<string | null> {
  const data = await runSavedQueryWithParams<unknown>('order_detail', { orderId });
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    const id = (row as { tq_instance?: { id?: string } })?.tq_instance?.id;
    if (id) return id;
  }
  return null;
}

/**
 * Add a card to an order: the item, its revision 1, an empty `card_spec`, and
 * the order line that points at it.
 *
 * `card_add` requires the CALLER to mint all three UUIDs — that is deliberate
 * on the query's part, so the ids are known without a read-back (a DynQL write
 * only echoes the root id). `card_line_add` then stores `item` as a jsonb
 * SNAPSHOT, not a link, and its description warns that `$body` params must not
 * be inlined into the jsonb literal — they get single-quoted and the join
 * breaks — so the whole snapshot is passed as one object.
 */
export async function addCardToOrder(input: {
  orderId: string;
  name: string;
  qty: number;
  ownerPartyId: string;
}): Promise<{ cardSpecId: string; itemRevId: string; orderLineId: string }> {
  const cardSpecId = crypto.randomUUID();
  const itemRevId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const orderLineId = crypto.randomUUID();

  await runSavedQueryWithBody('card_add', {
    cardSpecId,
    itemRevId,
    itemId,
    name: input.name,
    ownerPartyId: input.ownerPartyId,
  });

  await runSavedQueryWithBody('card_line_add', {
    orderLineId,
    orderId: input.orderId,
    qty: input.qty,
    // One object — never interpolated field-by-field into the jsonb.
    item: { item_rev_id: itemRevId, name: input.name, status: 'draft' },
  });

  return { cardSpecId, itemRevId, orderLineId };
}

/**
 * Save EVERYTHING about one card in a single write.
 *
 * `card_spec_save` updates the parameter columns and both artwork faces in one
 * statement, so the studio has one save rather than separate spec/artwork
 * buttons that could leave the record half-updated.
 *
 * The query REPLACES every column it names, so the caller must pass the full
 * merged state — any field omitted here is written as null. That includes the
 * face that isn't being edited: its existing artwork is sent back unchanged so
 * saving the front never blanks the back.
 */
export function saveCard(input: {
  cardSpecId: string;
  /** Parameter columns, already merged (stored values + unsaved edits). */
  fields: Record<string, unknown>;
  artworkFront?: unknown;
  artworkBack?: unknown;
  artworkCarrier?: unknown;
  previewFront?: string | null;
  previewBack?: string | null;
  previewCarrier?: string | null;
}): Promise<unknown> {
  return runSavedQueryWithBody('card_spec_save', {
    cardSpecId: input.cardSpecId,
    ...input.fields,
    artworkFront: input.artworkFront ?? null,
    artworkBack: input.artworkBack ?? null,
    artworkCarrier: input.artworkCarrier ?? null,
    // A `{front, back, carrier}` object, not a Text column: data URLs blow
    // past the 255-character cap (the saved query's own description explains
    // this).
    artworkPreview: {
      front: input.previewFront ?? null,
      back: input.previewBack ?? null,
      carrier: input.previewCarrier ?? null,
    },
    artworkUpdatedAt: new Date().toISOString(),
  });
}

/**
 * The card_spec columns a template carries.
 *
 * The physical build, and ONLY the physical build. `bin`, `ica` and
 * `preprint_bin` are deliberately absent: they identify the issuer rather than
 * the card, so carrying them would stamp one client's BIN onto another
 * client's card the first time a template is reused across clients — which is
 * the whole point of templates having no client link.
 */
export const TEMPLATE_SPEC_KEYS = [
  'shape',
  'substrate',
  'thickness_mil',
  'finish',
  'front_color_code',
  'back_color_code',
  'carrier_color_code',
  'mag_stripe',
  'mag_coercivity',
  'mag_tracks',
  'sig_panel',
  'scratch_off',
  'personalization',
  'card_brand',
] as const;

/** Narrow any spec-shaped object down to what a template is allowed to carry. */
export function templateSpecFrom(
  spec: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TEMPLATE_SPEC_KEYS) {
    const value = spec?.[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/**
 * Save the current design as a reusable template.
 *
 * The row is a COPY with no link back to the order, the client or the
 * card_spec it came from, so the same template can be applied to any order for
 * any client. Editing the card afterwards does not change the template, and
 * applying the template elsewhere does not touch this card.
 */
export function saveCardTemplate(input: {
  name: string;
  description?: string | null;
  category?: string | null;
  thumbnail?: string | null;
  artworkFront?: unknown;
  artworkBack?: unknown;
  spec?: Record<string, unknown> | null;
  /**
   * Revise this template instead of creating one.
   *
   * The two paths share every field, so they share a function: a second one
   * would have to be kept in step with this every time the template gains a
   * column, and the `spec`/`thumbnail` shaping is exactly where a divergence
   * would be silent. `created_at` and `active` are untouched on a revision —
   * editing a template does not restart its life or resurrect a retired one.
   */
  templateId?: string | null;
}): Promise<unknown> {
  if (input.templateId) {
    return runSavedQueryWithBody('card_template_update', {
      templateId: input.templateId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      thumbnail: { dataUrl: input.thumbnail ?? null },
      artworkFront: input.artworkFront ?? null,
      artworkBack: input.artworkBack ?? null,
      spec: templateSpecFrom(input.spec),
    });
  }
  return runSavedQueryWithBody('card_template_create', {
    // Minted client-side so the caller knows the id without a read-back.
    templateId: crypto.randomUUID(),
    name: input.name,
    description: input.description ?? null,
    category: input.category ?? null,
    // A `{dataUrl}` object, not Text: a PNG data URL blows past the 255-char cap.
    thumbnail: { dataUrl: input.thumbnail ?? null },
    artworkFront: input.artworkFront ?? null,
    artworkBack: input.artworkBack ?? null,
    spec: templateSpecFrom(input.spec),
    createdAt: new Date().toISOString(),
  });
}

/** One card being put out to bid. */
export interface RfeBidLine {
  orderLineId: string;
  itemRevId: string;
  qty: number;
}

/**
 * Create one supplier's complete RFE: the RFE, a bid line per selected card,
 * and one quantity tier per line.
 *
 * Sequenced PER SUPPLIER rather than per step across all suppliers. These are
 * three separate saved queries with no transaction around them, so a failure
 * part-way is possible either way — but finishing one supplier before starting
 * the next means a failure leaves N COMPLETE RFEs and a truthful "sent to 2 of
 * 3", instead of three half-built ones that the Quote grid would read as real.
 *
 * (The clean fix is a single composite CTE per supplier. `save_or_update_query`
 * cannot write CTEs on this tenant — round-tripping the unmodified `tq_create`
 * returns 400 while a plain dynamic query saves — so that has to be authored in
 * Phoenix directly. This is the correct interim.)
 *
 * Note the two param styles are NOT interchangeable: `rfe_create` is written
 * against `$body.*` and `rfe_line_create` / `rfe_tier_create` against bare
 * `$param`, which must go on the query string. Sending a bare-param query a
 * JSON body returns 500.
 */
export async function createRfeForSupplier(input: {
  orderId: string;
  supplierId: string;
  setupInstructions: string;
  respondBy: string;
  lines: RfeBidLine[];
}): Promise<{ rfeId: string; lineCount: number }> {
  const created = await runSavedQueryWithBody<unknown>('rfe_create', {
    orderId: input.orderId,
    supplierId: input.supplierId,
    setupInstructions: input.setupInstructions,
    respondBy: input.respondBy,
    // Stamped here, not defaulted in the query: the RFE is "sent" at the
    // moment this call is made, and respond_by is measured against it. Without
    // it every RFE claimed to be sent with no idea when.
    sentAt: new Date().toISOString(),
  });
  const rfeId = extractId(created);
  if (!rfeId) {
    throw new Error('rfe_create did not return an RFE id.');
  }

  for (const line of input.lines) {
    const lineRow = await runSavedQueryWithParams<unknown>('rfe_line_create', {
      rfeId,
      itemRevId: line.itemRevId,
      orderLineId: line.orderLineId,
      qty: line.qty,
    });
    const rfeLineId = extractId(lineRow);
    if (!rfeLineId) {
      throw new Error(`rfe_line_create did not return an id for ${line.orderLineId}.`);
    }
    // One tier per MATERIAL, all at the line's own quantity. A supplier
    // prices the card body, personalisation, carrier and setup separately and
    // those costs sum to the card's unit cost — quoting a single blended
    // number would lose the breakdown that each material's margin is applied
    // to in Deal Review.
    for (const component of COMPONENT_ROLES) {
      await runSavedQueryWithParams('rfe_tier_create', {
        rfeLineId,
        tierQty: line.qty,
        componentRole: component.role,
      });
    }
  }

  return { rfeId, lineCount: input.lines.length };
}

/** One priced line in a supplier's response. */
export interface SupplierQuoteLine {
  tierId: string;
  /** Unit cost in micros. Ignored when `declined` or `uncosted`. */
  costMicros: number;
  declined: boolean;
  uncosted: boolean;
}

/**
 * Record a supplier's quote against one RFE.
 *
 * Four saved queries in order, because each depends on the last:
 *   rfe_response_start        opens the round, returns the response id
 *   rfe_response_line_create  one cost per tier, hung off that id
 *   rfe_response_submit       the header (quote no, validity, lead time)
 *   rfe_mark_responded        flips the RFE sent → responded
 *
 * The last step is separate on purpose — the catalog notes a CTE spanning two
 * entities cannot be saved through the tooling, so the status flip is its own
 * query rather than part of the submit.
 *
 * Param transport differs per query and is NOT interchangeable: `submit` is
 * written against `$body.*` because a quote number is free text that would
 * split on a comma in a query string, while the other three use bare `$param`
 * and must go on the URL.
 */
export async function recordSupplierQuote(input: {
  rfeId: string;
  round: number;
  supplierQuoteNo: string;
  validityUntil: string | null;
  commitsToDelivery: boolean;
  leadTimeWeeks: number | null;
  lines: SupplierQuoteLine[];
}): Promise<{ responseId: string; lineCount: number }> {
  const started = await runSavedQueryWithParams<unknown>('rfe_response_start', {
    rfeId: input.rfeId,
    round: input.round,
  });
  const responseId = extractId(started);
  if (!responseId) throw new Error('rfe_response_start did not return a response id.');

  for (const line of input.lines) {
    await runSavedQueryWithParams('rfe_response_line_create', {
      responseId,
      tierId: line.tierId,
      costMicros: line.costMicros,
      uncosted: String(line.uncosted),
      declined: String(line.declined),
    });
  }

  await runSavedQueryWithBody('rfe_response_submit', {
    responseId,
    supplierQuoteNo: input.supplierQuoteNo,
    validityUntil: input.validityUntil,
    commitsToDelivery: input.commitsToDelivery,
    leadTimeWeeks: input.leadTimeWeeks,
    submittedAt: new Date().toISOString(),
  });

  await runSavedQueryWithParams('rfe_mark_responded', { rfeId: input.rfeId });

  return { responseId, lineCount: input.lines.length };
}

/** One awarded quantity on an order line. */
export interface AllocationInput {
  orderId: string;
  orderLineId: string;
  supplierId: string;
  qty: number;
  unitCostMicros: number | null;
  /**
   * `line` for a share of the line's quantity; `carve_out` when one MATERIAL
   * is made by someone other than the supplier assembling the card.
   *
   * Defaults to `line` so existing callers are unchanged.
   */
  kind?: 'line' | 'carve_out';
  /** The material being carved out. Null on a plain quantity allocation. */
  componentRole?: string | null;
  /** Who receives the carved-out material and assembles it into the card. */
  assemblerId?: string | null;
  exceptionNote?: string | null;
}

/**
 * Body `allocation_create` expects.
 *
 * `assemblerId` and `componentRole` carry a value only on a `carve_out`, per
 * the saved query's own contract. They were previously hardcoded to null with
 * `kind: 'line'`, which wrote every carve-out as a plain quantity row and lost
 * the material and its maker without any error.
 */
function allocationBody(row: AllocationInput): Record<string, unknown> {
  const isCarveOut = row.kind === 'carve_out';
  return {
    orderId: row.orderId,
    orderLineId: row.orderLineId,
    supplierId: row.supplierId,
    assemblerId: isCarveOut ? (row.assemblerId ?? null) : null,
    kind: row.kind ?? 'line',
    qty: row.qty,
    unitCostMicros: row.unitCostMicros,
    componentRole: isCarveOut ? (row.componentRole ?? null) : null,
    exceptionNote: row.exceptionNote ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Replace an order's allocations with the current set.
 *
 * Clear-then-insert rather than a diff: `allocation_clear_order` exists
 * precisely so the UI can re-state the whole allocation for an order without
 * having to reconcile which rows changed. The clear is a delete, so it runs
 * once and only when there is a replacement set to write.
 */
export async function replaceAllocations(
  orderId: string,
  rows: AllocationInput[],
): Promise<number> {
  // URL param, NOT body. `allocation_clear_order` is written against a bare
  // `$orderId`, so a JSON body returns 500 "missing required query parameters".
  // The catalog's write boilerplate claims every write takes a body — it does
  // not, and the two styles are never interchangeable. `allocation_create`
  // below genuinely is body-based, because exceptionNote is free text.
  await runSavedQueryWithParams('allocation_clear_order', { orderId });
  for (const row of rows) {
    await runSavedQueryWithBody('allocation_create', allocationBody(row));
  }
  return rows.length;
}

/**
 * Record a per-order margin override.
 *
 * `reason` is mandatory by contract, not by convention — `margin_override`
 * declares it as the justification without which the row cannot be saved, and
 * the Forge demo prompts for it before committing any margin change. Blank
 * reasons are rejected here rather than reaching the server.
 */
export function recordMarginOverride(input: {
  orderId: string;
  componentRole: string;
  marginBps: number;
  fromBps: number | null;
  scenario: string;
  reason: string;
}): Promise<unknown> {
  if (!input.reason.trim()) {
    throw new Error('A margin override needs a reason.');
  }
  return runSavedQueryWithBody('margin_override_create', {
    orderId: input.orderId,
    componentRole: input.componentRole,
    marginBps: input.marginBps,
    fromBps: input.fromBps,
    scenario: input.scenario,
    reason: input.reason.trim(),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Write the immutable award snapshot that ends the Decision chain.
 *
 * The snapshot is a whole JSON object, deliberately denormalised: later edits
 * to the allocations or to the supplier quotes must leave the awarded evidence
 * byte-identical, which a live link could not guarantee.
 */
export function writeAwardRecord(input: {
  orderId: string;
  totalCostMicros: number;
  snapshot: Record<string, unknown>;
}): Promise<unknown> {
  return runSavedQueryWithBody('award_record_create', {
    orderId: input.orderId,
    allocationsSnapshot: input.snapshot,
    totalCostMicros: input.totalCostMicros,
    awardedAt: new Date().toISOString(),
    awardedBy: getAuthService().getJiffyUserId() ?? 'unknown',
  });
}

/**
 * Create a client pricing template.
 *
 * `effectiveFrom` defaults to today so the template is live immediately;
 * `effectiveTo` is left open. `basis`/`model`/`scenario` match every existing
 * row in this tenant — a template that disagreed with its siblings on those
 * would price differently for no visible reason.
 */
export function createPricingTemplate(input: {
  name: string;
  clientId: string;
  floorBps: number;
}): Promise<unknown> {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return runSavedQueryWithBody('pricing_template_create', {
    name: input.name,
    clientId: input.clientId,
    model: 'markup_pct',
    basis: 'cost_plus',
    scenario: 'standard',
    floorBps: input.floorBps,
    effectiveFrom: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    effectiveTo: null,
  });
}

/**
 * Set one component-role margin, creating the row if the role is unpriced.
 *
 * Two queries rather than an upsert because that is what exists:
 * `pricing_template_role_create` inserts, `pricing_template_role_update`
 * changes an existing row by its id. Both take bare `$param`s, so both go on
 * the query string.
 */
export function setRoleMargin(input: {
  templateId: string;
  roleId: string | null;
  componentRole: string;
  marginBps: number;
}): Promise<unknown> {
  if (input.roleId) {
    return runSavedQueryWithParams('pricing_template_role_update', {
      roleId: input.roleId,
      marginBps: input.marginBps,
    });
  }
  return runSavedQueryWithParams('pricing_template_role_create', {
    templateId: input.templateId,
    componentRole: input.componentRole,
    marginBps: input.marginBps,
  });
}

/**
 * Approve a card's item revision — freeze the design.
 *
 * Two DIFFERENT things are easy to confuse here, and conflating them is why a
 * designed card could sit at `draft` forever:
 *
 *   · `item_revision.status` is the DESIGN's own state (draft → Approved).
 *     This query sets it, and its own description notes it deliberately does
 *     NOT touch the task instance.
 *   · the order's task state ("In Design" → "Approved") is the STAGE's state,
 *     moved only by the workflow signal.
 *
 * They are separate acts on purpose: a design can be frozen before anyone is
 * ready to advance the order, and the order should not advance on the strength
 * of a design nobody approved. Saving artwork does neither — it only writes
 * `card_spec`.
 *
 * Matters because an RFE quotes a REVISION: suppliers bidding on a draft are
 * bidding on something that can still change under them.
 */
export function approveCardSpec(itemRevId: string): Promise<unknown> {
  return runSavedQueryWithParams('card_spec_approve', { itemRevId });
}

/**
 * Build the proposal — record that the deal has been reviewed.
 *
 * Runs the domain model's B5 approval engine rather than setting a flag:
 * `review_request` (kind `deal_review`) → `verdict` → close. Three writes,
 * because a decision that gates a commercial commitment should leave WHO
 * decided and WHY behind, not just a boolean.
 *
 * That also survives a reload and a change of operator — the chain reads the
 * review back rather than trusting component state.
 */
export async function buildProposal(input: {
  orderId: string;
  round: number;
  note?: string;
}): Promise<string> {
  const created = await runSavedQueryWithBody<unknown>('review_request_create', {
    orderId: input.orderId,
    reviewKind: 'deal_review',
    // proof_type is meaningful only for the proof kind.
    proofType: null,
    round: input.round,
    requestedAt: new Date().toISOString(),
    dueAt: null,
  });
  const reviewId = extractId(created);
  if (!reviewId) throw new Error('review_request_create did not return a review id.');

  await runSavedQueryWithBody('verdict_record', {
    reviewId,
    decision: 'approve',
    reasonCode: 'margin_reviewed',
    comment: input.note?.trim() || 'Margins reviewed against the supplier quotes.',
    decidedBy: getAuthService().getJiffyUserId() ?? 'unknown',
    decidedAt: new Date().toISOString(),
  });

  // Separate from the verdict on purpose — the status is a decision about the
  // whole review (policy satisfied), not a side effect of one approver.
  await runSavedQueryWithBody('review_request_close', {
    reviewId,
    status: 'approved',
  });

  return reviewId;
}

/**
 * The component roles an order can be priced by.
 *
 * These are exactly `pricing_template_role.component_role`, which is what
 * makes component-wise margin work: a line whose item carries `carrier` picks
 * up the carrier margin, and so on. Labels follow the demo's wording.
 *
 * `perUnit: false` marks a charge that is NOT multiplied by the card
 * quantity — a press setup is one fee for the run, so its line carries qty 1
 * and the quoted cost IS the total.
 */
export const COMPONENT_ROLES = [
  { role: 'card', label: 'Card body', perUnit: true },
  { role: 'features', label: 'Personalization', perUnit: true },
  { role: 'carrier', label: 'Carrier', perUnit: true },
  { role: 'setup', label: 'Setup / press', perUnit: false },
] as const;

/** Look up a material's display label. */
export function componentLabel(role: string | null | undefined): string {
  return COMPONENT_ROLES.find((c) => c.role === role)?.label ?? (role || 'Material');
}

export type ComponentRole = (typeof COMPONENT_ROLES)[number]['role'];

/**
 * Add a component line to an order.
 *
 * Three saved queries in order, as their own descriptions number them:
 *   component_item_create  the item carrying the component role
 *   component_rev_create   revision 1, already approved — a component has no
 *                          separate design review to pass
 *   component_line_create  the order line pointing at that revision
 *
 * Each component is a LINE, not a column on the card: that is what lets a
 * supplier quote it separately and lets the deal apply that role's own margin.
 */
export async function addComponentLine(input: {
  orderId: string;
  name: string;
  componentRole: ComponentRole;
  qty: number;
  ownerPartyId: string;
}): Promise<{ itemRevId: string; orderLineId: string }> {
  const item = await runSavedQueryWithBody<unknown>('component_item_create', {
    name: input.name,
    componentRole: input.componentRole,
    itemType: input.componentRole,
    ownerPartyId: input.ownerPartyId,
  });
  const itemId = extractId(item);
  if (!itemId) throw new Error('component_item_create did not return an item id.');

  // Mints the revision id client-side so the caller has it without a read-back,
  // matching how addCardToOrder works.
  const itemRevId = crypto.randomUUID();
  await runSavedQueryWithParams('component_rev_create', { itemId, itemRevId });

  const line = await runSavedQueryWithBody<unknown>('component_line_create', {
    orderId: input.orderId,
    // A WHOLE object, never $body params nested inside the jsonb literal —
    // that path wraps each value in literal quotes, and a quoted item_rev_id
    // matches no revision, which silently drops the line from the BOM join.
    item: {
      item_rev_id: itemRevId,
      name: input.name,
      description: `${input.componentRole} component`,
      status: 'approved',
    },
    qty: input.qty,
  });
  const orderLineId = extractId(line);
  if (!orderLineId) throw new Error('component_line_create did not return a line id.');

  return { itemRevId, orderLineId };
}

/** What `POST /doc/pdf/from-html/` returns — directly, with no envelope. */
export interface PdfFromHtmlResult {
  file_id: string;
  storage_key: string;
  output_filename: string;
}

/**
 * Render an HTML string to a PDF.
 *
 * The service rasterises the HTML server-side, stores the result in Jiffy
 * Drive and hands back the Drive `file_id` — the bytes never come back over
 * this call, which is why the id has to be persisted (see `saveSpecPdfRef`)
 * for the document to be retrievable later.
 *
 * `base_url` resolves relative URLs inside the HTML. We send `null` and inline
 * everything (styles in a `<style>` block, the card faces as data: URIs), so
 * the renderer never has to reach back out to fetch an asset it may not be
 * able to authenticate for.
 *
 * `X-Jiffy-User-ID` is required by this endpoint, hence
 * `getDataHeadersWithUser` rather than the plain data headers.
 */
export async function generatePdfFromHtml(
  html: string,
  filename: string,
): Promise<PdfFromHtmlResult> {
  const res = await apiManager.post(
    'doc',
    '/pdf/from-html/',
    { html, filename, base_url: null },
    getDataHeadersWithUser(),
  );
  return res.data as PdfFromHtmlResult;
}

/**
 * Record the generated PDF against the card spec.
 *
 * `generatePdfFromHtml` returns only an id; without this write the document
 * exists in Drive but nothing on the order points at it, so the supplier
 * spec sheet could never be reopened.
 */
export function saveSpecPdfRef(input: {
  cardSpecId: string;
  pdfFileId: string;
  pdfName: string;
}): Promise<unknown> {
  return runSavedQueryWithBody('card_spec_pdf_save', {
    cardSpecId: input.cardSpecId,
    pdfFileId: input.pdfFileId,
    pdfName: input.pdfName,
    pdfAt: new Date().toISOString(),
  });
}

/**
 * Add a variation of a card to an order.
 *
 * A variation is NOT a copy of the spec — `card_variant.delta` stores only the
 * fields that differ from the base card, so editing a shared field on the base
 * still flows through to every variation. `approved` starts false; Send-for-
 * quotes stays blocked until at least one variation is approved.
 */
export async function addCardVariant(input: {
  orderId: string;
  cardSpecId: string;
  label: string;
  qty: number;
  dueDate?: string | null;
  delta?: Record<string, unknown>;
}): Promise<string> {
  const variantId = crypto.randomUUID();
  await runSavedQueryWithBody('card_variant_create', {
    variantId,
    orderId: input.orderId,
    cardSpecId: input.cardSpecId,
    label: input.label,
    // Only the differences — an empty object means "identical to base so far".
    delta: input.delta ?? {},
    qty: input.qty,
    dueDate: input.dueDate ?? null,
    createdAt: new Date().toISOString(),
  });
  return variantId;
}

/**
 * Save one variation's own style.
 *
 * `delta` is REPLACED wholesale, so pass the complete set of differences from
 * the base card, not a patch. Approval is deliberately not written here —
 * `card_variant_approve` owns that flag.
 */
export function saveCardVariant(input: {
  variantId: string;
  label: string;
  delta: Record<string, unknown>;
  qty: number | null;
  dueDate?: string | null;
}): Promise<unknown> {
  return runSavedQueryWithBody('card_variant_update', {
    variantId: input.variantId,
    label: input.label,
    delta: input.delta,
    qty: input.qty ?? null,
    dueDate: input.dueDate ?? null,
  });
}

/**
 * Assign a task instance to a user (`tq_instance.assignee`).
 *
 * Touches ONLY `assignee` — `current_task` / `current_status` belong to the
 * workflow and must not be written from here.
 */
export function assignTask(
  instanceId: string,
  userId: string,
): Promise<unknown> {
  return runSavedQueryWithParams('tq_assign', {
    taskInstanceId: instanceId,
    userId,
  });
}

/**
 * Create an order and start its workflow.
 *
 * Four calls, in order — each consumes the previous one's id:
 *   1. `tq_definition_list` → resolve the process id by name (cached per
 *      session; a nested insert cannot do a by-name lookup).
 *   2. `order_start_full`   → ONE write that inserts the orders row AND, via a
 *      nested insert on the `tq_instance` link, creates the task instance,
 *      sets its assignee and links it to the order. Replaces the old
 *      order_create + tq_create + order_link_tq + tq_assign sequence.
 *   3. `order_detail`       → read the new order back for its tq_instance id.
 *      Needed because a DynQL write returns ONLY the root row's id; the
 *      `select` clause's nested links are not echoed, so the instance id
 *      cannot come back from the insert itself.
 *   4. `tq_sub_task_add`    → open the first stage (Order / Order Received).
 *      Kept separate on purpose: it is the single owner of creating sub-task
 *      instances + their initial state, so the first stage and every later
 *      one go through one identical code path.
 *   5. `create_order`       → start the workflow that drives the 9 stages.
 *
 * The workflow is started LAST and its failure is reported rather than thrown:
 * by then the order and its task already exist, so throwing would strand the
 * caller with committed rows and no id.
 */
export async function createOrderAndStartWorkflow(
  input: CreateOrderInput,
  onStep?: (step: CreateOrderStep) => void,
  /**
   * Who owns the new order. Defaults to the signed-in user. Pass `null` to
   * leave it unassigned so it lands in Today's claimable "Unassigned" list.
   */
  assignToUserId?: string | null,
): Promise<CreateOrderResult> {
  onStep?.('order');
  const currentUserId =
    assignToUserId === null ? null : (assignToUserId ?? getAuthService().getJiffyUserId());

  const taskDefId = await resolveTaskDefinitionId(TASK_DEFINITION_NAME);
  if (!taskDefId) {
    throw new Error(
      `No tq_definition named "${TASK_DEFINITION_NAME}" — cannot create the task instance.`,
    );
  }

  // One write: order row + task instance + assignee + the link between them.
  const orderRes = await runSavedQueryWithBody('order_start_full', {
    orderCode: input.orderCode,
    orderKind: input.orderKind ?? 'demand',
    orderType: input.orderType ?? 'standard',
    orderBrief: input.orderBrief,
    buyerPartyId: input.buyerPartyId,
    requestedDelivery: input.requestedDelivery,
    taskDefId,
    userId: currentUserId ?? undefined,
  });
  const orderId = extractId(orderRes);
  if (!orderId) {
    throw new Error('order_start_full did not return an order id.');
  }

  // Read the instance id back — the write only echoes the root order id.
  onStep?.('task');
  const instanceId = await fetchOrderInstanceId(orderId);
  if (!instanceId) {
    throw new Error(
      'order_start_full created the order but no task instance was linked to it.',
    );
  }
  const assigned = Boolean(currentUserId);

  onStep?.('stage');
  await runSavedQueryWithParams('tq_sub_task_add', {
    instanceId,
    subTaskName: INITIAL_STAGE,
    stateName: INITIAL_STATE,
  });

  onStep?.('workflow');
  try {
    // ASYNC: create_order parks on a signal wait at every stage, so a sync
    // call would hang until the whole order completed.
    await runWorkflow(CREATE_ORDER_WORKFLOW, { taskInstanceId: instanceId }, 'async');
  } catch (error) {
    return {
      orderId,
      instanceId,
      assigned,
      workflowStarted: false,
      workflowError: error instanceof Error ? error.message : String(error),
    };
  }

  onStep?.('done');
  return { orderId, instanceId, assigned, workflowStarted: true };
}

/** One `tq_status_history` row (the task instance's state trail). */
export interface StatusHistoryEntry {
  id?: string;
  created_at?: string;
  is_current?: boolean;
  tq_state_definition?: { state?: string };
  tq_sub_task_instance?: { tq_sub_task_definition?: { name?: string } };
}

/**
 * Read the task instance's state trail directly.
 *
 * `useSavedQueryList` exposes `refetch(): void`, so a caller can't read the
 * fresh rows from it — which polling after a signal needs. This returns the
 * rows, leaving the hook to handle steady-state rendering.
 */
export async function fetchStatusHistory(
  instanceId: string,
): Promise<StatusHistoryEntry[]> {
  const data = await runSavedQueryWithParams<unknown>('tq_status_history', {
    instanceId,
  });
  if (Array.isArray(data)) return data as StatusHistoryEntry[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as StatusHistoryEntry[];
    const keys = Object.keys(obj);
    if (keys.length === 1 && Array.isArray(obj[keys[0]])) {
      return obj[keys[0]] as StatusHistoryEntry[];
    }
  }
  return [];
}

/** Current stage + state from a trail, or nulls when nothing is current. */
export function currentPosition(rows: StatusHistoryEntry[]): {
  stage: string | null;
  state: string | null;
} {
  const current = rows.find((r) => r.is_current);
  return {
    stage: current?.tq_sub_task_instance?.tq_sub_task_definition?.name ?? null,
    state: current?.tq_state_definition?.state ?? null,
  };
}

/**
 * Fire the signal that advances the running workflow to its next stage.
 *
 * Calls the signal endpoint DIRECTLY rather than going through the
 * `test_send_response` workflow. That workflow does nothing but POST to this
 * same route (its only step is a CallBackNode hitting
 * `/workflow/internal/v1/signals/{taskInstanceId}/trigger`), so routing
 * through it just adds a workflow run, hides the real status code behind a
 * generic `true`, and makes failures far harder to read.
 *
 * `POST /v1/signals/{signalId}/trigger` is the public route for this — the
 * same one the starter's SR submit uses (`buildSrSubmitUrl`). The task
 * instance id is the signal id.
 */
/**
 * File the order — the last transition, and the only one that is not a signal.
 *
 * Order Close carries two states, `Closing` and `Closed`, but by the time an
 * order reaches it the workflow run has already finished: signalling there
 * returns ERROR_SIGNAL_NO_ACTIVE_WORKFLOW. So every completed order sat at
 * `Closing` for ever with no control anywhere on the page to finish it — the
 * stage strip showed the last step lit and nothing to click.
 *
 * `tq_state_add` writes the state directly on the current sub-task, which is
 * exactly what is needed here and nothing more: it flips the old `is_current`
 * row, appends the new one, and repoints the instance. No run is restarted.
 */
export function closeOrder(instanceId: string): Promise<unknown> {
  return runSavedQueryWithParams('tq_state_add', { instanceId, stateName: 'Closed' });
}

/**
 * Close the quote-collection window without the suppliers who never answered.
 *
 * The Quote stage parks in a loop that counts the RFEs still marked `sent` and
 * re-parks while any remain, so there is no "skip" signal to send — the way out
 * is to make the count true. This flips the stragglers to `outdated`, after
 * which the next `sendStageResponse` finds nothing outstanding and the stage
 * falls through to Deal Review with the quotes that did arrive.
 *
 * Deliberately does NOT signal. The caller advances afterwards, so a failure
 * here stops before anything is signalled rather than half-closing the round.
 */
export function closeOutstandingRfes(orderId: string): Promise<unknown> {
  return runSavedQueryWithBody('rfe_close_outstanding', { orderId });
}

export function sendStageResponse(
  instanceId: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  const url = `/v1/signals/${encodeURIComponent(instanceId)}/trigger`;
  return apiManager
    .post('workflow', url, payload, getDataHeadersWithUser())
    .then((res) => res.data as unknown)
    .catch((error: unknown) => {
      // The signal API returns a precise diagnosis in the body and a bare 500
      // in the status line — most usefully ERROR_SIGNAL_NO_ACTIVE_WORKFLOW,
      // which means the run expired rather than anything being wrong with the
      // request. Axios' default message ("Request failed with status code
      // 500") throws that away, so unwrap it.
      const body = (error as { response?: { data?: { code?: string; message?: string } } })
        ?.response?.data;
      if (body?.message) {
        throw new Error(body.code ? `${body.code}: ${body.message}` : body.message);
      }
      throw error;
    });
}

/* ── Proposal (domain model B3) ───────────────────────────────────────── */

export interface ProposalRow {
  id?: string;
  version?: number;
  currency?: string;
  layout?: string;
  status?: string;
  total_cost_micros?: number;
  total_sell_micros?: number;
  blended_bps?: number;
  pdf_file_id?: string | null;
  pdf_name?: string | null;
  pdf_at?: string | null;
  sent_at?: string | null;
  sent_by?: string | null;
  accepted_at?: string | null;
  loss_reason?: string | null;
  comments?: string | null;
  created_at?: string;
  deal_snap?: Record<string, unknown> | null;
}

/**
 * Generate a proposal VERSION.
 *
 * `dealSnap` is the immutable commercial payload — priced lines, per-material
 * margins, totals. An issued proposal never re-reads the live deal, so a later
 * margin change cannot silently alter what the client was sent; re-pricing
 * creates a new version instead.
 */
export async function createProposal(input: {
  orderId: string;
  version: number;
  currency: string;
  layout: string;
  dealSnap: Record<string, unknown>;
  totalCostMicros: number;
  totalSellMicros: number;
  blendedBps: number | null;
}): Promise<string> {
  const created = await runSavedQueryWithBody<unknown>('proposal_create', {
    orderId: input.orderId,
    version: input.version,
    currency: input.currency,
    layout: input.layout,
    dealSnap: input.dealSnap,
    totalCostMicros: input.totalCostMicros,
    totalSellMicros: input.totalSellMicros,
    blendedBps: input.blendedBps,
    status: 'draft',
    createdAt: new Date().toISOString(),
  });
  const id = extractId(created);
  if (!id) throw new Error('proposal_create did not return a proposal id.');
  return id;
}

/**
 * Patch a proposal version.
 *
 * `proposal_update` REPLACES every column it names, so the caller sends the
 * full merged state — the same contract as `card_spec_save`, and the same
 * reason: a field omitted from the body is written as null, which would
 * silently clear a PDF reference or a sent timestamp.
 */
export function updateProposal(input: {
  proposalId: string;
  status: string;
  pdfFileId?: string | null;
  pdfName?: string | null;
  pdfAt?: string | null;
  sentAt?: string | null;
  sentBy?: string | null;
  acceptedAt?: string | null;
  lossReason?: string | null;
  comments?: string | null;
}): Promise<unknown> {
  return runSavedQueryWithBody('proposal_update', {
    proposalId: input.proposalId,
    status: input.status,
    pdfFileId: input.pdfFileId ?? null,
    pdfName: input.pdfName ?? null,
    pdfAt: input.pdfAt ?? null,
    sentAt: input.sentAt ?? null,
    sentBy: input.sentBy ?? null,
    acceptedAt: input.acceptedAt ?? null,
    lossReason: input.lossReason ?? null,
    comments: input.comments ?? null,
  });
}

/* ── Fulfilment: Award → Produce → Proof → Ship → Bill ───────────────── */

/**
 * Raise the supply orders for an award.
 *
 * One supply order per supplier — the domain model's own constraint — built
 * from the committed `line_allocation` rows rather than from anything on
 * screen, so what gets ordered is exactly what was awarded.
 *
 * The supply order id is minted here so `order_relation` can be linked
 * without a read-back, matching how `addCardToOrder` mints its revision id.
 */
/**
 * The operating entity that BUYS from suppliers.
 *
 * A supply order is our purchase order, so we are its buyer and the
 * manufacturer is its seller — the domain model's role binding, and the only
 * reading under which `buyer_party_id` means the same thing on both kinds of
 * order.
 */
export const FISERV_PARTY_ID = '22222222-0000-4000-8000-000000000001';

/**
 * Raise the award: supply orders, their lines, and the record that freezes it.
 *
 * Three things happen per supplier, in an order that matters:
 *
 *  1. the SUPPLY ORDER — our purchase order to them (we buy, they sell);
 *  2. its LINES — the same item revision the client's line carries, at the
 *     supplier's cost rather than the client's price;
 *  3. the ALLOCATION is pointed at the supply line it will be fulfilled by.
 *
 * An AWARD RECORD is written first and every allocation binds to it, so what
 * was awarded survives any later re-pricing of the deal. The domain model is
 * explicit that this snapshot is immutable and that a change is a change
 * order, never an in-place edit.
 */
export async function createSupplyOrders(input: {
  orderId: string;
  orderCode: string;
  requestedDelivery?: string | null;
  /**
   * How many supply orders this order ALREADY has.
   *
   * The suffix continues from here rather than restarting at 1. Raising
   * suppliers in two batches — which is the normal case, since only the
   * un-ordered ones are offered — otherwise minted a second GC-1061-PO1.
   */
  existingCount?: number;
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    lines: number;
    /** Finished-goods share — `line` allocations only. */
    qty: number;
    /** Carved-out components this supplier makes, by label. */
    components?: string[];
    /**
     * The allocation rows this supplier's order is built from, each with the
     * demand line it fulfils and what that line is made of.
     */
    allocations: Array<{
      allocationId: string;
      qty: number;
      unitCostMicros: number;
      /** The demand line's item snapshot, copied onto the supply line. */
      item: unknown;
      uom: string;
    }>;
  }>;
}): Promise<number> {
  const awardedAt = new Date().toISOString();

  // Written BEFORE the orders, so every row raised under it can point back at
  // one immutable statement of what was awarded.
  const awardRecordId = crypto.randomUUID();
  await runSavedQueryWithBody('award_record_create', {
    awardRecordId,
    orderId: input.orderId,
    allocationsSnapshot: {
      awarded: input.suppliers.map((s) => ({
        supplier: s.supplierName,
        supplierId: s.supplierId,
        units: s.qty,
        components: s.components ?? [],
        lines: s.allocations.map((a) => ({
          allocationId: a.allocationId,
          qty: a.qty,
          unitCostMicros: a.unitCostMicros,
        })),
      })),
    },
    totalCostMicros: input.suppliers.reduce(
      (n, s) => n + s.allocations.reduce((m, a) => m + a.unitCostMicros * a.qty, 0),
      0,
    ),
    awardedAt,
    awardedBy: getAuthService().getJiffyUserId() ?? 'unknown',
  });

  let index = input.existingCount ?? 0;
  for (const supplier of input.suppliers) {
    index += 1;
    const supplyOrderId = crypto.randomUUID();
    await runSavedQueryWithBody('supply_order_create', {
      supplyOrderId,
      /**
       * Derived from the demand order's code so the two are legible together
       * on a packing note or an invoice: GC-1061 → GC-1061-PO1.
       *
       * PO, not SO. This is Fiserv BUYING from the supplier, and in standard
       * procurement terms the buy-side document is a Purchase Order — SO means
       * Sales Order, the sell side, which is the demand order. The suffix read
       * backwards to anyone with ERP background. The domain model's own word
       * for the record is "supply order", which the entity and queries keep;
       * only the two-letter code changes, because that abbreviation is the one
       * that collides.
       */
      orderCode: `${input.orderCode}-PO${index}`,
      // A carve-out supplier may have no quantity share at all, so the brief
      // is built from whichever parts exist rather than always leading with a
      // unit count that can legitimately be zero.
      orderBrief: [
        supplier.qty > 0
          ? `${supplier.qty.toLocaleString()} units across ${supplier.lines} line${
              supplier.lines === 1 ? '' : 's'
            }`
          : '',
        supplier.components?.length ? `${supplier.components.join(', ')} carved out` : '',
      ]
        .filter(Boolean)
        .join(' · ')
        .concat(` for ${input.orderCode}`),
      orderType: 'purchase',
      // We buy, they sell.
      buyerId: { id: FISERV_PARTY_ID },
      supplierId: { id: supplier.supplierId },
      requestedDelivery: input.requestedDelivery ?? null,
      createdAt: awardedAt,
    });

    /**
     * Start the PO's own workflow.
     *
     * `supply_order_create` now nests the tq_instance insert, so the instance
     * exists by the time this runs; `create_supplier_order` opens PO
     * Acknowledge and then waits for the supplier to act in Relay. Until
     * 2026-08-17 a PO had no lifecycle at all — no instance, and a `status`
     * jsonb frozen at `{state:"Open"}` — so nothing could record that a
     * supplier had accepted the work.
     *
     * ASYNC and non-fatal, exactly as the demand side does it: the workflow
     * parks on a signal wait for up to 30 days, so a sync call would hang,
     * and by this point the PO and its lines already exist — throwing here
     * would strand a real order behind a workflow problem.
     */
    const supplyInstanceId = await fetchOrderInstanceId(supplyOrderId);
    if (supplyInstanceId) {
      try {
        await runWorkflow(
          SUPPLIER_ORDER_WORKFLOW,
          { taskInstanceId: supplyInstanceId },
          'async',
        );
      } catch (error) {
        logger.error('createSupplyOrders: workflow did not start', {
          orderCode: `${input.orderCode}-PO${index}`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await runSavedQueryWithBody('order_relation_create', {
      parentOrderId: input.orderId,
      childOrderId: supplyOrderId,
      kind: 'supply',
      createdAt: awardedAt,
    });

    // One supply line per allocation, then bind the two together. Without the
    // line-to-line link a short delivery has nothing on the buy side to hang
    // off — you would know 500 arrived, but not against which commitment.
    for (const alloc of supplier.allocations) {
      const lineId = crypto.randomUUID();
      await runSavedQueryWithBody('supply_line_create', {
        lineId,
        supplyOrderId,
        item: alloc.item ?? null,
        qty: alloc.qty,
        // The supplier's cost, in currency — the client's price never appears
        // on their paperwork.
        unitPrice: alloc.unitCostMicros / 1_000_000,
        uom: alloc.uom || 'each',
      });
      await runSavedQueryWithBody('allocation_bind_award', {
        allocationId: alloc.allocationId,
        supplyLineId: lineId,
        awardRecordId,
      });
    }
  }
  return input.suppliers.length;
}

/** Open a proof round against the order. */
export async function openProof(input: {
  orderId: string;
  proofType: string;
  round: number;
  dueAt?: string | null;
}): Promise<string> {
  const created = await runSavedQueryWithBody<unknown>('review_request_create', {
    orderId: input.orderId,
    reviewKind: 'proof',
    proofType: input.proofType,
    round: input.round,
    requestedAt: new Date().toISOString(),
    dueAt: input.dueAt ?? null,
  });
  const id = extractId(created);
  if (!id) throw new Error('review_request_create did not return a review id.');
  return id;
}

/** Record a decision on a proof round. */
export function decideProof(input: {
  reviewId: string;
  decision: 'approve' | 'reject';
  reasonCode: string;
  comment: string;
}): Promise<unknown> {
  return runSavedQueryWithBody('verdict_record', {
    reviewId: input.reviewId,
    decision: input.decision,
    reasonCode: input.reasonCode,
    comment: input.comment,
    decidedBy: getAuthService().getJiffyUserId() ?? 'unknown',
    decidedAt: new Date().toISOString(),
  });
}

/** Plan a despatch: where a supply order's units are going. */
export function createShipmentRecord(input: {
  supplyOrderId: string;
  shipmentType: string;
  destination: string;
  qty: number;
  plannedDate?: string | null;
}): Promise<unknown> {
  return runSavedQueryWithBody('shipment_record_create', {
    supplyOrderId: input.supplyOrderId,
    // No order_line: a destination is planned per SUPPLY order, and a null
    // link on the insert is rejected outright by the writer.
    shipmentType: input.shipmentType,
    destination: input.destination,
    qty: input.qty,
    plannedDate: input.plannedDate ?? null,
    status: 'planned',
  });
}

/** Record what actually shipped against a plan. */
export function createShipment(input: {
  shipmentRecordId: string;
  trackingNo: string;
  carrier: string;
  shippedQty: number;
  shippingCostMicros: number | null;
  shipDate?: string | null;
}): Promise<unknown> {
  return runSavedQueryWithBody('shipment_create', {
    shipmentRecordId: input.shipmentRecordId,
    trackingNo: input.trackingNo,
    carrier: input.carrier,
    shippedQty: input.shippedQty,
    shippingCostMicros: input.shippingCostMicros,
    shipDate: input.shipDate ?? new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  });
}

/** A billable extra against a supply order. */
export function createExpense(input: {
  supplyOrderId: string;
  category: string;
  description: string;
  qty: number;
  unitCostMicros: number;
  unitPriceMicros: number;
  billToPartyId?: string | null;
}): Promise<unknown> {
  return runSavedQueryWithBody('expense_create', {
    supplyOrderId: input.supplyOrderId,
    category: input.category,
    description: input.description,
    qty: input.qty,
    unitCostMicros: input.unitCostMicros,
    unitPriceMicros: input.unitPriceMicros,
    billToPartyId: input.billToPartyId ?? null,
    status: 'billable',
    createdAt: new Date().toISOString(),
  });
}

/* ── Proofing ─────────────────────────────────────────────────────────── */

/**
 * Attach the uploaded document to a proof round.
 *
 * The Drive upload itself is done by the caller through `useDriveFiles` — a
 * hook cannot be called from this module — and this records the resulting
 * file id against the ROUND, so each version keeps its own artefact.
 */
export function saveProofDocument(input: {
  reviewId: string;
  fileId: string;
  fileName: string;
}): Promise<unknown> {
  return runSavedQueryWithBody('review_proof_document', {
    reviewId: input.reviewId,
    proofFileId: input.fileId,
    proofFileName: input.fileName,
    proofUploadedAt: new Date().toISOString(),
    // Receiving the document IS what moves it to review — the two are one
    // act, so they are written together rather than left to a second click.
    status: 'in_review',
  });
}

/**
 * Move a proof to a new status.
 *
 * `review_request_close` is a plain status update, so it serves every
 * transition in the proof loop — received, approved, sent to the client for
 * signature — not only closure.
 */
export function setProofStatus(reviewId: string, status: string): Promise<unknown> {
  return runSavedQueryWithBody('review_request_close', { reviewId, status });
}

/**
 * Reject a proof: record WHY, close this version, open the next.
 *
 * Three writes in a deliberate order. The verdict carries the reason codes
 * the supplier has to act on; the current version closes as
 * `changes_requested` so the history shows what was wrong with it; and a new
 * round opens awaiting their re-upload. Superseding a version in place would
 * erase the fault that caused it.
 */
export async function rejectProof(input: {
  orderId: string;
  reviewId: string;
  proofType: string;
  round: number;
  reason: string;
}): Promise<string> {
  await runSavedQueryWithBody('verdict_record', {
    reviewId: input.reviewId,
    decision: 'reject',
    reasonCode: 'changes_requested',
    comment: input.reason,
    decidedBy: getAuthService().getJiffyUserId() ?? 'unknown',
    decidedAt: new Date().toISOString(),
  });
  await setProofStatus(input.reviewId, 'changes_requested');

  const created = await runSavedQueryWithBody<unknown>('review_request_create', {
    orderId: input.orderId,
    reviewKind: 'proof',
    proofType: input.proofType,
    round: input.round + 1,
    requestedAt: new Date().toISOString(),
    dueAt: null,
  });
  const id = extractId(created);
  if (!id) throw new Error('review_request_create did not return a review id.');
  return id;
}

/**
 * Approve a proof round.
 *
 * A client-facing proof does NOT finish here: CS approving the art means it
 * is fit to show the client, and the client still has to sign. An internal
 * proof completes outright.
 */
export async function approveProof(input: {
  reviewId: string;
  nextStatus: string;
  comment: string;
}): Promise<unknown> {
  await runSavedQueryWithBody('verdict_record', {
    reviewId: input.reviewId,
    decision: 'approve',
    reasonCode: 'proof_approved',
    comment: input.comment,
    decidedBy: getAuthService().getJiffyUserId() ?? 'unknown',
    decidedAt: new Date().toISOString(),
  });
  return setProofStatus(input.reviewId, input.nextStatus);
}

/* ── Schedule (B6 Plan) ───────────────────────────────────────────────── */

/**
 * Apply a plan template to an order.
 *
 * Writes the plan and its milestones in one go. The plan id is minted here
 * rather than read back, so the items can be inserted without a round trip
 * between each one — the same trick `createSupplyOrders` uses.
 *
 * `provisional` is the only status this can produce: the dates are
 * back-calculated from the client's committed delivery date, before any
 * supplier lead time is known. Firming them against the awarded supplier is a
 * separate, later act.
 */
export async function applyPlanTemplate(input: {
  orderId: string;
  templateId: string;
  anchorDate: string;
  milestones: Array<{
    milestoneType: string;
    sequence: number;
    targetDate: string;
    ownerRole: string;
    clientObligation: boolean;
    padDays: number;
  }>;
}): Promise<string> {
  const planId = crypto.randomUUID();
  await runSavedQueryWithBody('plan_create', {
    planId,
    orderId: input.orderId,
    templateId: input.templateId,
    status: 'provisional',
    anchorDate: input.anchorDate,
    createdAt: new Date().toISOString(),
  });

  for (const m of input.milestones) {
    await runSavedQueryWithBody('plan_item_create', {
      planId,
      milestoneType: m.milestoneType,
      sequence: m.sequence,
      targetDate: m.targetDate,
      // Empty until the event that satisfies it actually happens.
      actualDate: null,
      status: 'pending',
      ownerRole: m.ownerRole,
      ownerName: null,
      // Part of the set the client is committed to, as opposed to something
      // raised by hand on this order later.
      origin: 'template',
      clientObligation: m.clientObligation,
      padDays: m.padDays,
      note: null,
    });
  }
  return planId;
}

/**
 * Stamp a milestone with the date of the event that satisfied it.
 *
 * The note records WHICH event, because "met on the 14th" is worth little
 * next to "met on the 14th — art proof signed off".
 */
export function stampMilestone(input: {
  itemId: string;
  actualDate: string;
  status: string;
  note: string;
}): Promise<unknown> {
  return runSavedQueryWithBody('plan_item_stamp', {
    itemId: input.itemId,
    actualDate: input.actualDate,
    status: input.status,
    note: input.note,
  });
}

/**
 * An operator's own edit to a milestone — the target date, or who owes it.
 *
 * Separate from `stampMilestone` on purpose: that records what HAPPENED and is
 * written by the machine from an event, this records what we are asking for
 * and is written by a person. Conflating them would let someone type a
 * completion date.
 */
export function editMilestone(input: {
  itemId: string;
  targetDate: string;
  status: string;
  ownerRole: string;
  clientObligation: boolean;
}): Promise<unknown> {
  return runSavedQueryWithBody('plan_item_edit', {
    itemId: input.itemId,
    targetDate: input.targetDate,
    status: input.status,
    ownerRole: input.ownerRole,
    clientObligation: input.clientObligation,
  });
}

/** Firm a plan against the awarded supplier, or publish it to the client. */
export function setPlanState(input: {
  planId: string;
  status: string;
  publishedToClient: boolean;
}): Promise<unknown> {
  return runSavedQueryWithBody('plan_set_state', {
    planId: input.planId,
    status: input.status,
    publishedToClient: input.publishedToClient,
  });
}

/**
 * Announce that a schedule went to the client.
 *
 * The publish itself is a database flag; this is the OUTBOUND half — today a
 * single log step, tomorrow the portal push or the email. It is a workflow
 * rather than a direct call so that when the real notification is added, it is
 * added to the workflow and this page does not change.
 *
 * Run synchronously: it is two steps, and a failure is worth reporting rather
 * than losing into a queue. The plan is already marked published by the time
 * this runs, so a failure here means "the client was not told", not "the
 * publish did not happen" — the caller says so in those words.
 */
export function notifySchedulePublished(input: {
  orderId: string;
  orderCode: string;
  planId: string;
  planStatus: string;
  clientName: string;
  deliverBy: string;
  milestoneCount: number;
}): Promise<unknown> {
  return runWorkflow(
    'schedule_published',
    {
      ...input,
      publishedBy: getAuthService().getJiffyUserId() ?? 'unknown',
    },
    'sync',
  );
}

/**
 * Add an ad-hoc milestone to an order's plan.
 *
 * The template covers what every order of this kind commits to; this covers
 * what THIS one needs — a press check before a long run, a production start
 * the client asked to witness. Marked `added` so it never leaks into the
 * client-facing schedule, which is the set they accepted.
 */
export function addMilestone(input: {
  planId: string;
  milestoneType: string;
  sequence: number;
  targetDate: string;
  ownerRole: string;
  ownerName: string | null;
  clientObligation: boolean;
}): Promise<unknown> {
  return runSavedQueryWithBody('plan_item_create', {
    planId: input.planId,
    milestoneType: input.milestoneType,
    sequence: input.sequence,
    targetDate: input.targetDate,
    actualDate: null,
    status: 'pending',
    ownerRole: input.ownerRole,
    ownerName: input.ownerName,
    origin: 'added',
    clientObligation: input.clientObligation,
    padDays: 0,
    note: null,
  });
}

/**
 * Spend or restore a milestone's padding.
 *
 * Padding pulls a target earlier than strictly necessary, so giving a day back
 * moves the target a day LATER. Both are written together because a buffer
 * means nothing apart from the date it produced.
 */
export function setMilestonePad(input: {
  itemId: string;
  padDays: number;
  targetDate: string;
}): Promise<unknown> {
  return runSavedQueryWithBody('plan_item_pad', {
    itemId: input.itemId,
    padDays: input.padDays,
    targetDate: input.targetDate,
  });
}
