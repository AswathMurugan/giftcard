/**
 * When a client may be sold to.
 *
 * Activation is not cosmetic: `party_list` returns only active merchants, so
 * these rules decide whether a client can be named on an order at all. Every
 * blocker below is something that would otherwise turn up as a broken order —
 * the floor case is Williams-Sonoma's, whose rate card carried 0% on the card
 * body and put the whole of GC-1073 under the 8% floor.
 */
import { describe, it, expect } from 'vitest';
import {
  activationBlockers,
  buildClientViews,
  canActivate,
  deactivationNote,
  matchesClient,
  nextStatus,
  orderableCount,
  toClientStatus,
  type ClientAdminResult,
} from '@/pages/clients/client-helpers';

const CLIENT = '9c10b3ba';
const TEMPLATE = '0c3cf1aa';

/** A fully-priced, above-floor rate card — the ready case. */
function result(over: Partial<ClientAdminResult> = {}): ClientAdminResult {
  return {
    clients: [{ id: CLIENT, name: 'Sephora', legal_name: 'Sephora USA, Inc.', status: 'active' }],
    templates: [
      {
        id: TEMPLATE,
        name: 'Sephora standard',
        scenario: 'standard',
        active: true,
        floor_bps: 800,
        client: { id: CLIENT },
      },
    ],
    roles: [
      { id: 'r1', component_role: 'card', margin_bps: 1200, template: { id: TEMPLATE } },
      { id: 'r2', component_role: 'carrier', margin_bps: 1700, template: { id: TEMPLATE } },
      { id: 'r3', component_role: 'features', margin_bps: 2000, template: { id: TEMPLATE } },
      { id: 'r4', component_role: 'setup', margin_bps: 1000, template: { id: TEMPLATE } },
    ],
    orders: [],
    ...over,
  };
}

const only = (r: ClientAdminResult) => buildClientViews(r)[0];

describe('buildClientViews', () => {
  it('joins the rate card onto the client', () => {
    const v = only(result());
    expect(v.name).toBe('Sephora');
    expect(v.templateName).toBe('Sephora standard');
    expect(v.margins.card).toBe(1200);
    expect(v.unpriced).toEqual([]);
    expect(v.atFloor).toEqual([]);
  });

  it('carries the role row id beside each margin', { tags: ['important'] }, () => {
    // This is what decides insert vs update when the margin is saved on the
    // client card: `setRoleMargin` updates when it has a roleId and inserts
    // when it does not. Losing the id here would silently create a SECOND
    // margin row for a role that already had one.
    const v = only(result());
    expect(v.roleIds.card).toBe('r1');
    expect(v.roleIds.setup).toBe('r4');
  });

  it('leaves roleIds empty for a role that was never priced', { tags: ['edge-case'] }, () => {
    const v = only(
      result({
        roles: [{ id: 'r1', component_role: 'card', margin_bps: 1200, template: { id: TEMPLATE } }],
      }),
    );
    expect(v.roleIds.card).toBe('r1');
    expect(v.roleIds.carrier).toBeUndefined();
    expect(v.unpriced).toContain('carrier');
  });

  it('does not borrow another template’s role rows', { tags: ['edge-case'] }, () => {
    const v = only(
      result({
        roles: [
          { id: 'r1', component_role: 'card', margin_bps: 1200, template: { id: TEMPLATE } },
          { id: 'x9', component_role: 'carrier', margin_bps: 9900, template: { id: 'other' } },
        ],
      }),
    );
    expect(v.margins.carrier).toBeUndefined();
    expect(v.roleIds.carrier).toBeUndefined();
  });

  it('counts only that client’s orders', () => {
    const v = only(
      result({
        orders: [
          { id: 'o1', buyer_party_id: { id: CLIENT } },
          { id: 'o2', buyer_party_id: { id: CLIENT } },
          { id: 'o3', buyer_party_id: { id: 'someone-else' } },
          { id: 'o4', buyer_party_id: null },
        ],
      }),
    );
    expect(v.orderCount).toBe(2);
  });

  it('ignores role rows belonging to another template', () => {
    const v = only(
      result({
        roles: [{ id: 'r9', component_role: 'card', margin_bps: 5000, template: { id: 'other' } }],
      }),
    );
    expect(v.margins.card).toBeUndefined();
    expect(v.unpriced).toHaveLength(4);
  });

  it('prefers the active template when a superseded one is still on file', () => {
    const v = only(
      result({
        templates: [
          { id: 'old', name: 'Sephora 2025', active: false, floor_bps: 800, client: { id: CLIENT } },
          { id: TEMPLATE, name: 'Sephora standard', active: true, floor_bps: 800, client: { id: CLIENT } },
        ],
      }),
    );
    expect(v.templateName).toBe('Sephora standard');
    expect(v.templateActive).toBe(true);
  });

  it('still shows an inactive card rather than reporting none', () => {
    const v = only(
      result({
        templates: [
          { id: TEMPLATE, name: 'Sephora standard', active: false, floor_bps: 800, client: { id: CLIENT } },
        ],
      }),
    );
    expect(v.templateId).toBe(TEMPLATE);
    expect(v.templateActive).toBe(false);
  });
});

describe('toClientStatus', () => {
  it('keeps the three real statuses', () => {
    expect(toClientStatus('active')).toBe('active');
    expect(toClientStatus('onboarding')).toBe('onboarding');
    expect(toClientStatus('inactive')).toBe('inactive');
  });

  it('never promotes an unknown or missing status to active', () => {
    // A null status is what a hand-seeded party carries. Reading it as active
    // would put a client nobody vetted into the Create Order dropdown.
    expect(toClientStatus(null)).toBe('onboarding');
    expect(toClientStatus(undefined)).toBe('onboarding');
    expect(toClientStatus('ACTIVE')).toBe('onboarding');
    expect(toClientStatus('prospect')).toBe('onboarding');
  });
});

describe('activationBlockers', () => {
  it('passes a fully-priced card above the floor', () => {
    const v = only(result());
    expect(activationBlockers(v)).toEqual([]);
    expect(canActivate(v)).toBe(true);
  });

  it('refuses a client with no rate card, and says only that', () => {
    const v = only(result({ templates: [], roles: [] }));
    expect(activationBlockers(v)).toHaveLength(1);
    expect(activationBlockers(v)[0]).toMatch(/No rate card/);
  });

  it('refuses a role priced at the floor', () => {
    const v = only(
      result({
        roles: [
          { id: 'r1', component_role: 'card', margin_bps: 800, template: { id: TEMPLATE } },
          { id: 'r2', component_role: 'carrier', margin_bps: 1700, template: { id: TEMPLATE } },
          { id: 'r3', component_role: 'features', margin_bps: 2000, template: { id: TEMPLATE } },
          { id: 'r4', component_role: 'setup', margin_bps: 1000, template: { id: TEMPLATE } },
        ],
      }),
    );
    expect(v.atFloor).toEqual(['card']);
    expect(canActivate(v)).toBe(false);
    expect(activationBlockers(v)[0]).toMatch(/Card sits at or below the 8.0% floor/);
  });

  it('refuses the Williams-Sonoma case — 0% on the card body', () => {
    const v = only(
      result({
        roles: [
          { id: 'r1', component_role: 'card', margin_bps: 0, template: { id: TEMPLATE } },
          { id: 'r2', component_role: 'carrier', margin_bps: 1500, template: { id: TEMPLATE } },
          { id: 'r3', component_role: 'features', margin_bps: 2000, template: { id: TEMPLATE } },
          { id: 'r4', component_role: 'setup', margin_bps: 1000, template: { id: TEMPLATE } },
        ],
      }),
    );
    expect(canActivate(v)).toBe(false);
  });

  it('names every unpriced role', () => {
    const v = only(
      result({
        roles: [{ id: 'r1', component_role: 'card', margin_bps: 1200, template: { id: TEMPLATE } }],
      }),
    );
    expect(v.unpriced).toEqual(['carrier', 'features', 'setup']);
    expect(activationBlockers(v)[0]).toMatch(/Carrier, Features, Setup have no margin set/);
  });

  it('reports an inactive card as its own blocker', () => {
    const v = only(
      result({
        templates: [
          { id: TEMPLATE, name: 'Sephora standard', active: false, floor_bps: 800, client: { id: CLIENT } },
        ],
      }),
    );
    expect(activationBlockers(v)[0]).toMatch(/inactive/);
  });

  it('treats a card with no floor as unblocked by the floor', () => {
    const v = only(
      result({
        templates: [
          { id: TEMPLATE, name: 'No floor', active: true, floor_bps: null, client: { id: CLIENT } },
        ],
      }),
    );
    expect(v.atFloor).toEqual([]);
    expect(canActivate(v)).toBe(true);
  });
});

describe('nextStatus', () => {
  it('activates only what may be activated', () => {
    expect(nextStatus(only(result()), 'activate')).toBe('active');
    expect(nextStatus(only(result({ templates: [], roles: [] })), 'activate')).toBeNull();
  });

  it('deactivates only what is active', () => {
    const active = only(result());
    expect(nextStatus(active, 'deactivate')).toBe('inactive');
    const onboarding = only(
      result({ clients: [{ id: CLIENT, name: 'Sephora', status: 'onboarding' }] }),
    );
    expect(nextStatus(onboarding, 'deactivate')).toBeNull();
  });
});

describe('deactivationNote', () => {
  it('says nothing when the client has no history', () => {
    expect(deactivationNote(only(result()))).toBeNull();
  });

  it('warns about orders already raised, without blocking', () => {
    const v = only(result({ orders: [{ id: 'o1', buyer_party_id: { id: CLIENT } }] }));
    expect(deactivationNote(v)).toMatch(/1 order already reference/);
    // A heads-up, not a gate — the client can still be deactivated.
    expect(nextStatus(v, 'deactivate')).toBe('inactive');
  });
});

describe('search and counts', () => {
  it('matches on name, legal name, status and template', () => {
    const v = only(result());
    expect(matchesClient(v, '')).toBe(true);
    expect(matchesClient(v, 'seph')).toBe(true);
    expect(matchesClient(v, 'USA')).toBe(true);
    expect(matchesClient(v, 'active')).toBe(true);
    expect(matchesClient(v, 'standard')).toBe(true);
    expect(matchesClient(v, 'idemia')).toBe(false);
  });

  it('counts only the clients an order may name', () => {
    const views = buildClientViews({
      clients: [
        { id: 'a', name: 'A', status: 'active' },
        { id: 'b', name: 'B', status: 'onboarding' },
        { id: 'c', name: 'C', status: 'inactive' },
      ],
    });
    expect(orderableCount(views)).toBe(1);
  });
});
