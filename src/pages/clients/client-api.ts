/**
 * Writers for the Clients screen.
 *
 * Kept out of `order-api` on purpose: nothing here belongs to an order's life,
 * and the two saved queries these call are the only way a client is ever
 * created or activated. They reuse `runSavedQueryWithBody` rather than a second
 * transport so the auth headers and the error shape stay identical to every
 * other write in the app.
 */
import { runSavedQueryWithBody } from '@/pages/orders/order-api';
import type { ClientStatus } from './client-helpers';

/**
 * Onboard a client.
 *
 * The id is minted here and inserted as the row id — the convention
 * `supply_order_create` uses for `supplyOrderId` — so the caller can bind a
 * rate card to the new client without reading it back. `client_create` hard-
 * codes `kind: 'merchant'`, so this cannot mint a supplier however it is called.
 *
 * A new client starts `onboarding`, NOT active: the buyer picker reads only
 * active merchants, so they stay out of Create Order until someone activates
 * them, and that is refused until the rate card clears its floor.
 */
export async function createClient(input: {
  name: string;
  legalName: string;
}): Promise<{ clientId: string }> {
  const clientId = crypto.randomUUID();
  await runSavedQueryWithBody('client_create', {
    clientId,
    name: input.name,
    legalName: input.legalName || input.name,
    status: 'onboarding' satisfies ClientStatus,
  });
  return { clientId };
}

/**
 * Edit a client, including the activation switch.
 *
 * Name and legal name go with the status on every call because the underlying
 * query writes all three: sending a status alone would blank the names. The
 * page therefore always passes the current values it is holding.
 */
export async function updateClient(input: {
  clientId: string;
  name: string;
  legalName: string;
  status: ClientStatus;
}): Promise<void> {
  await runSavedQueryWithBody('client_update', {
    clientId: input.clientId,
    name: input.name,
    legalName: input.legalName || input.name,
    status: input.status,
  });
}
