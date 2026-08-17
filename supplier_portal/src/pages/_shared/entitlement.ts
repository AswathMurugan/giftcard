/**
 * What the signed-in user is allowed to act for.
 *
 * This replaces the old "Viewing as" picker, which let anyone choose any
 * supplier from a list of every supplier in the tenant. That was never
 * authorisation — it asked the viewer to declare who they were and believed
 * the answer. The identity now comes from `party_user`, keyed to the account
 * that signed in, and the UI can only ever offer what that grant contains.
 *
 * Three outcomes, and the difference between them matters:
 *
 *   entitled  — one party. No chooser; the portal simply IS that party.
 *   choice    — several parties (an agency acting for two suppliers is real).
 *               A chooser, but only over the granted set.
 *   operator  — Fiserv staff. May act for any party, because their job is to
 *               work every supplier's orders. Explicitly recorded as a grant
 *               rather than assumed, so it is auditable and revocable.
 *   none      — no grant. An explicit refusal, NOT a list of everyone.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText } from '@/lib/runtime';
import type { PartyUserAccessRow } from '@/types/saved-queries.generated';

/** The portal an entitlement is for. */
export type PortalKind = 'supplier' | 'client';

/** Fiserv staff: entitled to every party rather than one. */
export const OPERATOR_PORTAL = 'operator';

export interface EntitledParty {
  id: string;
  name: string;
}

export type Entitlement =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'operator'; parties: EntitledParty[] }
  | { kind: 'entitled'; parties: EntitledParty[] };

/**
 * Read the grants for one portal.
 *
 * An operator grant wins outright: it is not additive with a party grant, and
 * treating it as "one more option" would quietly cap a Fiserv operator to
 * whichever parties they happened to also be named on.
 *
 * `allParties` is only consulted for an operator — for everyone else the
 * entitled set comes from their own rows, so the full tenant list can never
 * leak into a supplier's chooser.
 */
export function resolveEntitlement(
  rows: PartyUserAccessRow[] | undefined,
  portal: PortalKind,
  allParties: EntitledParty[],
  isLoading: boolean,
): Entitlement {
  if (isLoading) return { kind: 'loading' };

  const active = (rows ?? []).filter((r) => asText(r.status).toLowerCase() === 'active');

  if (active.some((r) => asText(r.portal).toLowerCase() === OPERATOR_PORTAL)) {
    return { kind: 'operator', parties: allParties };
  }

  const parties: EntitledParty[] = [];
  const seen = new Set<string>();
  for (const r of active) {
    if (asText(r.portal).toLowerCase() !== portal) continue;
    const id = r.party?.id;
    if (!id || seen.has(id)) continue;
    // A party that is itself inactive does not become accessible just because
    // somebody still holds a grant against it.
    if (asText(r.party?.status).toLowerCase() === 'inactive') continue;
    seen.add(id);
    parties.push({ id, name: asText(r.party?.name) || 'Unnamed party' });
  }

  if (parties.length === 0) return { kind: 'none' };
  return { kind: 'entitled', parties };
}

/** The parties a viewer may pick from — empty when they may pick nothing. */
export function selectableParties(e: Entitlement): EntitledParty[] {
  return e.kind === 'operator' || e.kind === 'entitled' ? e.parties : [];
}

/** True when a chooser is warranted: more than one legitimate option. */
export function needsChooser(e: Entitlement): boolean {
  return selectableParties(e).length > 1;
}

/**
 * Keep a remembered choice only if it is still granted.
 *
 * A remembered id is user input from a previous session — it has to be
 * re-checked against the current grant every time, or revoking access would
 * leave the last-viewed party pinned in localStorage and still working.
 * Returns the id to use, or '' when nothing may be shown.
 */
export function resolveActiveParty(e: Entitlement, remembered: string): string {
  const options = selectableParties(e);
  if (options.length === 0) return '';
  if (remembered && options.some((o) => o.id === remembered)) return remembered;
  return options[0].id;
}
