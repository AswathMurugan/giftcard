/**
 * Card templates — the reusable design library, independent of any order.
 *
 * A `card_template` is a COPY: artwork plus build parameters, with no link to
 * an order, a client or the `card_spec` it came from. That is what lets the
 * same design be applied to any order for any client, and it is why this page
 * can exist at all without an order behind it.
 *
 * The parameter list is NOT redeclared here. It is the same `PARAM_GROUPS` the
 * in-order spec panel renders, narrowed to what a template is allowed to hold —
 * see `templateGroups`.
 */
import { asNumber, asText } from '@/lib/runtime';
import { PARAM_GROUPS, type ParamSpec } from '@/pages/orders/spec-helpers';
import { TEMPLATE_SPEC_KEYS } from '@/pages/orders/order-api';

/** One row from `card_templates`. */
export interface TemplateRow {
  id?: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  /** `{dataUrl}` — Json, because a PNG data URL exceeds the 255-char Text cap. */
  thumbnail?: { dataUrl?: string | null } | null;
  artwork_front?: unknown;
  artwork_back?: unknown;
  spec?: Record<string, unknown> | null;
  created_at?: string | null;
}

/** The form's working copy: every value a string, as an input holds it. */
export type SpecDraft = Record<string, string>;

const TEMPLATE_KEYS = new Set<string>(TEMPLATE_SPEC_KEYS);

/**
 * The parameters a template may carry, grouped as the spec panel groups them.
 *
 * Filtered rather than rewritten, so a new finish or coercivity added to the
 * order spec shows up here with no change. The Identifiers group disappears
 * entirely — BIN, ICA and pre-print BIN are the ISSUER's, and a template is
 * explicitly shareable across clients, so carrying them would leak one
 * client's issuer numbers onto another client's card.
 */
export function templateGroups(): Array<{ name: string; params: ParamSpec[] }> {
  return PARAM_GROUPS.map((g) => ({
    name: g.name,
    params: g.params.filter((p) => TEMPLATE_KEYS.has(p.key)),
  })).filter((g) => g.params.length > 0);
}

/** Every template-eligible parameter, flat. */
export function templateParams(): ParamSpec[] {
  return templateGroups().flatMap((g) => g.params);
}

/**
 * Seed the form from a stored spec, falling back to each parameter's default.
 *
 * Booleans arrive as real booleans and numbers as numbers, but the form holds
 * strings, so everything is stringified on the way in and parsed on the way
 * out. `asText` rather than `String()` because the backend does not honour the
 * declared types — see the runtime-coercion note in the project guide.
 */
export function draftFromSpec(spec: Record<string, unknown> | null | undefined): SpecDraft {
  const out: SpecDraft = {};
  for (const p of templateParams()) {
    const raw = spec?.[p.key];
    if (raw === undefined || raw === null) {
      out[p.key] = p.defaultValue === undefined ? '' : String(p.defaultValue);
      continue;
    }
    out[p.key] = p.kind === 'boolean' ? (raw === true || raw === 'true' ? 'true' : 'false') : asText(raw);
  }
  return out;
}

/**
 * The form back into a spec object, typed the way the seeded templates are.
 *
 * Empty stays OUT rather than going in as `''` or `0`. A template that carries
 * `thickness_mil: 0` would apply a real, wrong thickness to any order that
 * picked it up; one that omits the key leaves the order's own value alone.
 */
export function specFromDraft(draft: SpecDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of templateParams()) {
    const value = (draft[p.key] ?? '').trim();
    if (value === '') continue;
    if (p.kind === 'boolean') {
      out[p.key] = value === 'true';
      continue;
    }
    if (p.kind === 'number') {
      const n = asNumber(value);
      if (n === null || Number.isNaN(n)) continue;
      out[p.key] = n;
      continue;
    }
    out[p.key] = value;
  }
  return out;
}

/** How many of the template's parameters carry a value. */
export function specCount(draft: SpecDraft): { set: number; total: number } {
  const params = templateParams();
  return {
    set: Object.keys(specFromDraft(draft)).length,
    total: params.length,
  };
}

export interface TemplateProblem {
  field: 'name';
  message: string;
}

/**
 * What stops a template being saved.
 *
 * The name is the only hard requirement — it is the whole of the tile's label
 * and the only thing anyone picks by. A duplicate is refused because the
 * picker shows nothing else to tell two same-named designs apart, so the
 * second one is unpickable by intent.
 */
export function validateTemplate(name: string, existing: TemplateRow[]): TemplateProblem[] {
  const trimmed = name.trim();
  if (!trimmed) return [{ field: 'name', message: 'Give the template a name.' }];
  const clash = existing.some((t) => (t.name ?? '').trim().toLowerCase() === trimmed.toLowerCase());
  if (clash) {
    return [{ field: 'name', message: `A template called “${trimmed}” already exists.` }];
  }
  return [];
}

/** Case-insensitive match on name, category or description. */
export function matchesTemplate(row: TemplateRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (row.name ?? '').toLowerCase().includes(q) ||
    (row.category ?? '').toLowerCase().includes(q) ||
    (row.description ?? '').toLowerCase().includes(q)
  );
}

/** The categories in use, for the filter row. Blank categories are ignored. */
export function categoriesOf(rows: TemplateRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const c = (r.category ?? '').trim();
    if (c) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Newest first — a template just saved should be the first tile seen. */
export function byNewest(rows: TemplateRow[]): TemplateRow[] {
  return [...rows].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}
