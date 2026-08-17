/**
 * Entitlement — who a signed-in account may act for.
 *
 * This is security code, so the tests that matter most are the negative ones:
 * no grant must mean NO access rather than a fallback to everything, a grant
 * for the other portal must not carry over, a revoked grant must stop working,
 * and a remembered choice from localStorage must not survive losing the grant
 * that allowed it.
 */
import { describe, it, expect } from 'vitest';
import {
  needsChooser,
  resolveActiveParty,
  resolveEntitlement,
  selectableParties,
  type EntitledParty,
} from '@/pages/_shared/entitlement';
import type { PartyUserAccessRow } from '@/types/saved-queries.generated';

const TENANT: EntitledParty[] = [
  { id: 'p-travel', name: 'Travel Tags' },
  { id: 'p-cpi', name: 'CPI Card Group' },
  { id: 'p-thales', name: 'Thales' },
];

function grant(over: Partial<Record<string, unknown>>): PartyUserAccessRow {
  return {
    id: 'g1',
    portal: 'supplier',
    status: 'active',
    user_email: 'buyer@travel-tags.example',
    party: { id: 'p-travel', name: 'Travel Tags', status: 'active' },
    ...over,
  } as unknown as PartyUserAccessRow;
}

describe('resolveEntitlement', { tags: ['entitlement', 'important'] }, () => {
  it('is loading before the grant has resolved', { tags: ['edge-case'] }, () => {
    // Must not read as "no access" mid-flight, or the portal flashes a refusal
    // at a user who is perfectly entitled.
    expect(resolveEntitlement(undefined, 'supplier', TENANT, true).kind).toBe('loading');
  });

  it('NO grant means no access — never a fallback to every party', () => {
    // This is the hole being closed. The old picker's failure mode was exactly
    // "no identity ⇒ choose from the whole tenant".
    const e = resolveEntitlement([], 'supplier', TENANT, false);
    expect(e.kind).toBe('none');
    expect(selectableParties(e)).toEqual([]);
  });

  it('resolves a single grant with no chooser', () => {
    const e = resolveEntitlement([grant({})], 'supplier', TENANT, false);
    expect(e.kind).toBe('entitled');
    expect(selectableParties(e)).toEqual([{ id: 'p-travel', name: 'Travel Tags' }]);
    expect(needsChooser(e)).toBe(false);
  });

  it('offers a chooser over several granted parties, and only those', () => {
    const e = resolveEntitlement(
      [
        grant({ id: 'g1' }),
        grant({ id: 'g2', party: { id: 'p-cpi', name: 'CPI Card Group', status: 'active' } }),
      ],
      'supplier',
      TENANT,
      false,
    );
    expect(needsChooser(e)).toBe(true);
    // Thales is in the tenant but not granted — it must not appear.
    expect(selectableParties(e).map((p) => p.id)).toEqual(['p-travel', 'p-cpi']);
  });

  it('ignores a revoked grant', { tags: ['important'] }, () => {
    const e = resolveEntitlement([grant({ status: 'revoked' })], 'supplier', TENANT, false);
    expect(e.kind).toBe('none');
  });

  it('does not carry a client grant into the supplier portal', { tags: ['important'] }, () => {
    // A client-portal user must not gain a supplier's view of the same tenant.
    const e = resolveEntitlement([grant({ portal: 'client' })], 'supplier', TENANT, false);
    expect(e.kind).toBe('none');
  });

  it('does not grant access to a party that is itself inactive', { tags: ['edge-case'] }, () => {
    const e = resolveEntitlement(
      [grant({ party: { id: 'p-travel', name: 'Travel Tags', status: 'inactive' } })],
      'supplier',
      TENANT,
      false,
    );
    expect(e.kind).toBe('none');
  });

  it('ignores a party grant with no party attached', { tags: ['edge-case'] }, () => {
    // Only an operator row legitimately has a null party.
    const e = resolveEntitlement([grant({ party: null })], 'supplier', TENANT, false);
    expect(e.kind).toBe('none');
  });

  it('de-duplicates two grants for the same party', { tags: ['edge-case'] }, () => {
    const e = resolveEntitlement([grant({ id: 'a' }), grant({ id: 'b' })], 'supplier', TENANT, false);
    expect(selectableParties(e)).toHaveLength(1);
    expect(needsChooser(e)).toBe(false);
  });

  describe('operator', { tags: ['important'] }, () => {
    it('may act for every party', () => {
      const e = resolveEntitlement(
        [grant({ portal: 'operator', party: null })],
        'supplier',
        TENANT,
        false,
      );
      expect(e.kind).toBe('operator');
      expect(selectableParties(e)).toEqual(TENANT);
    });

    it('is not capped by a party grant they also happen to hold', () => {
      // Treating operator as "one more option" would silently limit a Fiserv
      // operator to whichever suppliers they were also named on.
      const e = resolveEntitlement(
        [grant({ id: 'a' }), grant({ id: 'b', portal: 'operator', party: null })],
        'supplier',
        TENANT,
        false,
      );
      expect(e.kind).toBe('operator');
      expect(selectableParties(e)).toHaveLength(3);
    });

    it('loses everything when the operator grant is revoked', () => {
      const e = resolveEntitlement(
        [grant({ portal: 'operator', party: null, status: 'revoked' })],
        'supplier',
        TENANT,
        false,
      );
      expect(e.kind).toBe('none');
    });
  });
});

describe('resolveActiveParty', { tags: ['entitlement', 'important'] }, () => {
  it('honours a remembered choice that is still granted', () => {
    const e = resolveEntitlement(
      [
        grant({ id: 'g1' }),
        grant({ id: 'g2', party: { id: 'p-cpi', name: 'CPI Card Group', status: 'active' } }),
      ],
      'supplier',
      TENANT,
      false,
    );
    expect(resolveActiveParty(e, 'p-cpi')).toBe('p-cpi');
  });

  it('discards a remembered choice that is no longer granted', { tags: ['important'] }, () => {
    // localStorage is user input from a past session. If revoking access left
    // the last-viewed party pinned there and still working, the revocation
    // would not actually revoke anything.
    const e = resolveEntitlement([grant({})], 'supplier', TENANT, false);
    expect(resolveActiveParty(e, 'p-thales')).toBe('p-travel');
  });

  it('resolves to nothing when there is no access', () => {
    const e = resolveEntitlement([], 'supplier', TENANT, false);
    expect(resolveActiveParty(e, 'p-travel')).toBe('');
  });

  it('resolves to nothing while still loading', { tags: ['edge-case'] }, () => {
    const e = resolveEntitlement(undefined, 'supplier', TENANT, true);
    expect(resolveActiveParty(e, 'p-travel')).toBe('');
  });
});
