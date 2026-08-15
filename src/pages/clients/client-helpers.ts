/**
 * Clients — the ops side of the party table.
 *
 * A client is a `party` of kind `merchant`: the side we sell to, as opposed to
 * the suppliers we buy from and the one internal party we invoice as. Until
 * this screen existed there was no way to create one, so the tenant had exactly
 * the two that were seeded by hand and the Pricing page's "Add template" button
 * was permanently disabled — its rule is one template per client, and both
 * clients already had one.
 *
 * The rules that matter are here rather than in the page, for the same reason
 * the quote and fulfilment rules are: they decide whether an order can be taken
 * at all, and they need testing without a browser.
 *
 * `status` is the load-bearing field. `party_list` — the Create Order buyer
 * picker — returns only ACTIVE merchants, so a client sits outside the dropdown
 * until someone activates them here, and activation is refused while the rate
 * card would produce a deal nobody can price.
 */
import { COMPONENT_ROLES, pct, type ComponentRole } from '@/pages/pricing/pricing-helpers';

/** Onboarding → active → inactive. Nothing else is a client status. */
export const CLIENT_STATUSES = ['onboarding', 'active', 'inactive'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

/** A merchant party, whatever its status — `client_admin` does not filter. */
export interface AdminClientRow {
  id?: string;
  name?: string;
  legal_name?: string | null;
  status?: string | null;
}

export interface AdminTemplateRow {
  id?: string;
  name?: string;
  scenario?: string | null;
  active?: boolean | null;
  floor_bps?: number | null;
  effective_from?: string | null;
  client?: { id?: string } | null;
}

export interface AdminRoleRow {
  id?: string;
  component_role?: string | null;
  margin_bps?: number | null;
  template?: { id?: string } | null;
}

export interface AdminOrderRow {
  id?: string;
  order_code?: string | null;
  buyer_party_id?: { id?: string } | null;
}

export interface ClientAdminResult {
  clients?: AdminClientRow[];
  templates?: AdminTemplateRow[];
  roles?: AdminRoleRow[];
  orders?: AdminOrderRow[];
}

/** One client, with the rate card and the order history that decide its fate. */
export interface ClientView {
  id: string;
  name: string;
  legalName: string;
  status: ClientStatus;
  /** The active standard template bound to this client, if any. */
  templateId: string | null;
  templateName: string | null;
  templateActive: boolean;
  floorBps: number | null;
  /** component role → margin in basis points. Missing = never priced. */
  margins: Partial<Record<ComponentRole, number>>;
  /** Roles with no margin row at all. */
  unpriced: ComponentRole[];
  /** Roles priced at or below the template's floor. */
  atFloor: ComponentRole[];
  /** Demand orders raised against this client, ever. */
  orderCount: number;
}

/** A status we do not recognise is treated as onboarding, never as active. */
export function toClientStatus(value: string | null | undefined): ClientStatus {
  return (CLIENT_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ClientStatus)
    : 'onboarding';
}

/**
 * Join the four lists `client_admin` returns into one row per client.
 *
 * A client may hold several templates over time (a superseded rate card stays
 * on file), so the ACTIVE one wins and an inactive one is only reported so the
 * operator can see why the client is not ready.
 */
export function buildClientViews(result: ClientAdminResult | null | undefined): ClientView[] {
  const templates = result?.templates ?? [];
  const roles = result?.roles ?? [];
  const orders = result?.orders ?? [];

  const ordersByClient = new Map<string, number>();
  for (const o of orders) {
    const id = o.buyer_party_id?.id;
    if (!id) continue;
    ordersByClient.set(id, (ordersByClient.get(id) ?? 0) + 1);
  }

  return (result?.clients ?? [])
    .filter((c) => c.id)
    .map((c) => {
      const clientId = c.id as string;
      const mine = templates.filter((t) => t.client?.id === clientId);
      // Prefer the active card; fall back to any so an inactive one is visible.
      const template = mine.find((t) => t.active) ?? mine[0] ?? null;
      const margins: Partial<Record<ComponentRole, number>> = {};
      if (template?.id) {
        for (const r of roles) {
          if (r.template?.id !== template.id) continue;
          const role = r.component_role as ComponentRole;
          if (!COMPONENT_ROLES.includes(role)) continue;
          if (typeof r.margin_bps === 'number') margins[role] = r.margin_bps;
        }
      }
      const floorBps = template?.floor_bps ?? null;

      return {
        id: clientId,
        name: c.name ?? '—',
        legalName: c.legal_name ?? '',
        status: toClientStatus(c.status),
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        templateActive: Boolean(template?.active),
        floorBps,
        margins,
        unpriced: COMPONENT_ROLES.filter((role) => margins[role] === undefined),
        atFloor: COMPONENT_ROLES.filter(
          (role) => floorBps !== null && margins[role] !== undefined && (margins[role] as number) <= floorBps,
        ),
        orderCount: ordersByClient.get(clientId) ?? 0,
      } satisfies ClientView;
    });
}

/**
 * May this client be activated?
 *
 * Activation is what puts them in the Create Order dropdown, so every blocker
 * here is something that would otherwise surface as a broken order rather than
 * a refused button. The floor check is the one with history: Williams-Sonoma's
 * template carried 0% on the card body, which put GC-1073's whole deal under
 * the 8% floor and needed a margin override before the order could move — a
 * rate card in that state is not ready, and saying so here is cheaper than
 * discovering it at Deal Review.
 */
export function activationBlockers(view: ClientView): string[] {
  const out: string[] = [];
  if (!view.templateId) {
    out.push('No rate card yet — add a pricing template for this client.');
    return out;
  }
  if (!view.templateActive) {
    out.push(`${view.templateName} is inactive — a deal cannot price against it.`);
  }
  if (view.unpriced.length > 0) {
    out.push(
      `${view.unpriced.map(titleCase).join(', ')} ${
        view.unpriced.length === 1 ? 'has' : 'have'
      } no margin set.`,
    );
  }
  if (view.atFloor.length > 0) {
    out.push(
      `${view.atFloor.map(titleCase).join(', ')} ${
        view.atFloor.length === 1 ? 'sits' : 'sit'
      } at or below the ${pct(view.floorBps)} floor — every order would need an override.`,
    );
  }
  return out;
}

export function canActivate(view: ClientView): boolean {
  return activationBlockers(view).length === 0;
}

/**
 * What deactivating would mean, when it is worth saying.
 *
 * Deactivation does not touch orders already in flight — it only takes the
 * client out of the picker — so the count is a heads-up rather than a blocker.
 * Refusing here would strand a client nobody may raise work for AND nobody may
 * stop raising work for.
 */
export function deactivationNote(view: ClientView): string | null {
  if (view.orderCount === 0) return null;
  return `${view.orderCount} order${view.orderCount === 1 ? '' : 's'} already reference ${
    view.name
  }. Those are unaffected — this only stops new ones being raised.`;
}

/** The status an action moves a client to, or null when the action is refused. */
export function nextStatus(view: ClientView, action: 'activate' | 'deactivate'): ClientStatus | null {
  if (action === 'activate') return canActivate(view) ? 'active' : null;
  return view.status === 'active' ? 'inactive' : null;
}

export function matchesClient(view: ClientView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    view.name.toLowerCase().includes(q) ||
    view.legalName.toLowerCase().includes(q) ||
    view.status.includes(q) ||
    (view.templateName ?? '').toLowerCase().includes(q)
  );
}

/** How many clients a new order may actually be raised against. */
export function orderableCount(views: ClientView[]): number {
  return views.filter((v) => v.status === 'active').length;
}

function titleCase(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
