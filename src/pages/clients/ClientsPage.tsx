/**
 * Clients — onboarding the side we sell to.
 *
 * The first ops screen. Everything downstream assumes a client exists: the
 * Create Order buyer picker reads them, a rate card binds to one, and Deal
 * Review prices against that rate card.
 *
 * Reads `client_board` — every merchant whatever its status, with its rate card
 * and its order history — and writes through `client_create` / `client_update`
 * for the client and `pricing_template_create` / `pricing_template_role_*` for
 * the card.
 *
 * The screen is a gate, not a form. A client is created `onboarding` and stays
 * out of Create Order until activated, and activation is refused while the rate
 * card would produce a deal nobody can price. That is the whole point: the
 * alternative is discovering a 0%-margin card body at Deal Review, which is
 * exactly what happened to Williams-Sonoma on GC-1073.
 *
 * The rate card is EDITED here, not on a page of its own. A `pricing_template`
 * binds to exactly one client and only one may be active per client, so it is a
 * property of the client rather than a catalogue. Splitting the two made
 * onboarding a round trip — create here, price there, return here to activate —
 * with the margins being the only thing standing between those steps.
 */
import { useCallback, useMemo, useState } from 'react';
import { useSavedQuerySingle } from '@/hooks';
import type { SavedQueryName } from '@/types/saved-queries.generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { COMPONENT_ROLES, pct, pctToBps, type ComponentRole } from '@/pages/_shared/pricing';
import { createPricingTemplate, setRoleMargin } from '@/pages/orders/order-api';
import { createClient, updateClient } from './client-api';
import {
  activationBlockers,
  buildClientViews,
  canActivate,
  deactivationNote,
  matchesClient,
  orderableCount,
  type ClientAdminResult,
  type ClientView,
} from './client-helpers';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success-50 text-success-700',
  onboarding: 'bg-warning-50 text-warning-700',
  inactive: 'bg-muted text-muted-foreground',
};

/**
 * The board query, addressed around two platform quirks.
 *
 * The name is `client_board`, not `client_admin`: the edge WAF blocks any
 * request path containing "admin", so the original name returned a CloudFront
 * 403 before it ever reached Phoenix. Nothing in the app can be called *_admin
 * — see `pricing_template_admin`, registered and never once called.
 *
 * The cast and the explicit app key are because codegen for the saved-query
 * registry is WAF-blocked too, so `client_board` is not in `SavedQueryName`
 * and `SAVED_QUERY_APP_KEYS` has no entry to resolve. Both go away the first
 * time the registry can be regenerated.
 */
const CLIENT_BOARD = 'client_board' as SavedQueryName;
const APP_KEY = 'aswathtestapp_6a67823a8fa7215710927dbc';

/**
 * One role's margin, as an input that commits on blur.
 *
 * `defaultValue` keyed by the stored margin rather than a controlled `value`:
 * every keystroke of "12.5" passes through "1" and "12", and a controlled input
 * wired straight to the write would have saved each of them. The key resets the
 * field when the refetch brings back a different number.
 */
function MarginRow({
  view,
  role,
  busy,
  onCommit,
}: {
  view: ClientView;
  role: ComponentRole;
  busy: boolean;
  onCommit: (view: ClientView, role: ComponentRole, typed: string) => Promise<void>;
}) {
  const bps = view.margins[role];
  const atFloor = view.atFloor.includes(role);
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={`${view.id}-${role}`}
        className="flex-1 text-[12.5px] capitalize text-foreground"
      >
        {role}
      </label>
      <Input
        id={`${view.id}-${role}`}
        name={`${view.id}-${role}`}
        key={bps === undefined ? 'unset' : bps}
        data-testid={`client-margin-${view.name}-${role}`}
        className={`h-7 w-[5rem] text-right text-[12.5px] tabular-nums ${
          atFloor ? 'border-warning-500' : ''
        }`}
        inputMode="decimal"
        placeholder="—"
        aria-label={`${role} margin for ${view.name}, percent`}
        disabled={busy}
        defaultValue={bps === undefined ? '' : String(bps / 100)}
        onBlur={(e) => void onCommit(view, role, e.target.value)}
      />
      <span
        className={`w-[4rem] text-[11.5px] ${
          bps === undefined || atFloor ? 'text-warning-700' : 'text-muted-foreground'
        }`}
      >
        {bps === undefined ? 'unpriced' : atFloor ? 'at floor' : '%'}
      </span>
    </div>
  );
}

export function ClientsPage() {
  const admin = useSavedQuerySingle(CLIENT_BOARD, { appDefinitionKey: APP_KEY });
  const result = admin.data as ClientAdminResult | null;

  const views = useMemo(() => buildClientViews(result), [result]);

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLegal, setNewLegal] = useState('');

  // The client a new rate card is being created for, or null when none is.
  const [cardFor, setCardFor] = useState<ClientView | null>(null);
  const [newCardName, setNewCardName] = useState('');
  const [newFloor, setNewFloor] = useState('8');

  const visible = useMemo(() => views.filter((v) => matchesClient(v, query)), [views, query]);

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      await admin.refetch();
    } catch (e) {
      setNote(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    await run('Create', async () => {
      await createClient({ name: newName.trim(), legalName: newLegal.trim() });
      setAdding(false);
      setNewName('');
      setNewLegal('');
      setNote(
        'Client created as onboarding. Give them a rate card below, then activate them.',
      );
    });
  }

  /**
   * Give a client its first rate card.
   *
   * Created empty — no role margins — which is deliberate: the blockers list
   * immediately says which roles are unpriced, and Activate stays refused until
   * they are. Seeding plausible defaults would clear that gate with numbers
   * nobody chose.
   */
  async function handleCreateCard() {
    const client = cardFor;
    if (!client) return;
    await run('Create rate card', async () => {
      await createPricingTemplate({
        name: newCardName.trim(),
        clientId: client.id,
        floorBps: pctToBps(newFloor),
      });
      setCardFor(null);
      setNote(`Rate card created for ${client.name}. Set a margin on each role below.`);
    });
  }

  /** Commit one role's margin. Called on blur, so typing does not write. */
  const handleMargin = useCallback(
    async (view: ClientView, role: ComponentRole, typed: string) => {
      if (!view.templateId) return;
      const bps = pctToBps(typed);
      // Nothing typed against an unpriced role is not a request to set it to 0%.
      if (typed.trim() === '' && view.margins[role] === undefined) return;
      if (view.margins[role] === bps) return;
      await run('Save margin', async () => {
        await setRoleMargin({
          templateId: view.templateId as string,
          roleId: view.roleIds[role] ?? null,
          componentRole: role,
          marginBps: bps,
        });
        setNote(`${view.name}: ${role} set to ${pct(bps)}.`);
      });
    },
    // `run` closes over admin.refetch, which React Query keeps stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function handleStatus(view: ClientView, status: 'active' | 'inactive') {
    await run(status === 'active' ? 'Activate' : 'Deactivate', async () => {
      await updateClient({
        clientId: view.id,
        name: view.name,
        legalName: view.legalName,
        status,
      });
      setNote(
        status === 'active'
          ? `${view.name} is active — they now appear in Create Order.`
          : `${view.name} is inactive — no new order can name them.`,
      );
    });
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="clients-page">
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Clients</h1>
      <p className="mb-5 mt-1 text-[15px] text-muted-foreground">
        The side we sell to. A client can only be chosen on a new order once they are active, and
        activation needs a rate card that clears its own margin floor.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="client-search">Search</Label>
          <Input
            id="client-search"
            name="clientSearch"
            data-testid="client-search"
            className="w-[16rem]"
            placeholder="Client, legal name or status"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          data-testid="add-client"
          onClick={() => {
            setNewName('');
            setNewLegal('');
            setAdding(true);
          }}
        >
          <i className="icon icon_-Tb_circle_plus" aria-hidden="true" />
          Add client
        </Button>
        <span className="ml-auto text-[13px] text-muted-foreground" data-testid="client-counts">
          {orderableCount(views)} of {views.length} orderable
        </span>
      </div>

      {admin.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13.5px] text-muted-foreground">
          {views.length === 0 ? 'No clients yet.' : 'No clients match.'}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((view) => {
            const blockers = activationBlockers(view);
            const warning = deactivationNote(view);
            return (
              <div
                key={view.id}
                data-testid={`client-${view.name}`}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-foreground">{view.name}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                      STATUS_STYLE[view.status] ?? STATUS_STYLE.inactive
                    }`}
                    data-testid={`client-status-${view.name}`}
                  >
                    {view.status}
                  </span>
                  <span className="ml-auto text-[12.5px] text-muted-foreground">
                    {view.orderCount === 0
                      ? 'no orders yet'
                      : `${view.orderCount.toLocaleString()} order${
                          view.orderCount === 1 ? '' : 's'
                        }`}
                  </span>
                </div>

                {view.legalName && view.legalName !== view.name ? (
                  <div className="text-[12.5px] text-muted-foreground">{view.legalName}</div>
                ) : null}

                {/* The rate card, EDITABLE here.
                    It used to be read-only with a pointer at a separate Pricing
                    page, which made onboarding a round trip: create the client,
                    leave to price it, come back to activate. The margins are the
                    only thing standing between those two steps, so they belong
                    between them. */}
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                      Rate card
                    </span>
                    <span className="text-[12.5px] text-foreground">
                      {view.templateName ?? 'None'}
                    </span>
                    {view.templateId && !view.templateActive ? (
                      <span className="text-[11.5px] text-warning-700">inactive</span>
                    ) : null}
                    {view.floorBps !== null ? (
                      <span className="ml-auto text-[12px] text-muted-foreground">
                        floor {pct(view.floorBps)}
                      </span>
                    ) : null}
                  </div>
                  {view.templateId ? (
                    <div className="flex flex-col gap-1.5">
                      {COMPONENT_ROLES.map((role) => (
                        <MarginRow
                          key={role}
                          view={view}
                          role={role}
                          busy={busy}
                          onCommit={handleMargin}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] text-muted-foreground">
                        No rate card yet — nothing can be priced for this client.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`add-rate-card-${view.name}`}
                        disabled={busy}
                        onClick={() => {
                          setCardFor(view);
                          setNewCardName(`${view.name} standard`);
                          setNewFloor('8');
                        }}
                      >
                        Add rate card
                      </Button>
                    </div>
                  )}
                </div>

                {/* Why the button is refused, stated where it is refused. */}
                {blockers.length > 0 ? (
                  <ul
                    className="flex flex-col gap-0.5"
                    data-testid={`client-blockers-${view.name}`}
                  >
                    {blockers.map((b) => (
                      <li key={b} className="text-[12px] text-warning-700">
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {view.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`deactivate-${view.name}`}
                      aria-busy={busy}
                      disabled={busy}
                      onClick={() => void handleStatus(view, 'inactive')}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      data-testid={`activate-${view.name}`}
                      aria-busy={busy}
                      disabled={busy || !canActivate(view)}
                      title={canActivate(view) ? 'Let orders be raised for this client' : blockers[0]}
                      onClick={() => void handleStatus(view, 'active')}
                    >
                      Activate
                    </Button>
                  )}
                  <span className="text-[12.5px] text-muted-foreground">
                    {view.status === 'active'
                      ? (warning ?? 'Appears in Create Order.')
                      : canActivate(view)
                        ? 'Ready — activating puts them in Create Order.'
                        : 'Not orderable yet.'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {note ? (
        <p className="mt-3 text-[13px] text-muted-foreground" data-testid="client-note">
          {note}
        </p>
      ) : null}

      <Dialog open={cardFor !== null} onOpenChange={(open) => !open && setCardFor(null)}>
        <DialogContent className="sm:max-w-[28rem]" data-testid="add-rate-card-dialog">
          <DialogHeader>
            <DialogTitle>Rate card for {cardFor?.name}</DialogTitle>
            <DialogDescription>
              One active rate card per client, so this is the one every order for them prices
              against. It is created with no margins — set those on the card, then activate.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-card-name">Rate card name</Label>
              <Input
                id="new-card-name"
                name="rateCardName"
                data-testid="new-rate-card-name"
                value={newCardName}
                onChange={(e) => setNewCardName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-floor">Margin floor (%)</Label>
              <Input
                id="new-floor"
                name="floor"
                data-testid="new-rate-card-floor"
                inputMode="decimal"
                value={newFloor}
                onChange={(e) => setNewFloor(e.target.value.replace(/[^0-9.]/g, ''))}
              />
              <span className="text-[11.5px] text-muted-foreground">
                The lowest margin a deal may reach before it needs an override.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid="confirm-add-rate-card"
                onClick={() => void handleCreateCard()}
                aria-busy={busy}
                disabled={busy || !newCardName.trim()}
              >
                {busy ? 'Creating…' : 'Create rate card'}
              </Button>
              <Button variant="outline" onClick={() => setCardFor(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-[28rem]" data-testid="add-client-dialog">
          <DialogHeader>
            <DialogTitle>Add a client</DialogTitle>
            <DialogDescription>
              Created as onboarding, not active — they appear on new orders once they have a rate
              card and someone activates them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-client-name">Trading name</Label>
              <Input
                id="new-client-name"
                name="clientName"
                data-testid="new-client-name"
                value={newName}
                placeholder="Williams-Sonoma"
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-client-legal">Legal name</Label>
              <Input
                id="new-client-legal"
                name="clientLegalName"
                data-testid="new-client-legal"
                value={newLegal}
                placeholder="Williams-Sonoma, Inc."
                onChange={(e) => setNewLegal(e.target.value)}
              />
              <span className="text-[11.5px] text-muted-foreground">
                What goes on the invoice. Left blank, the trading name is used.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid="confirm-add-client"
                onClick={handleCreate}
                aria-busy={busy}
                disabled={busy || !newName.trim()}
              >
                {busy ? 'Creating…' : 'Create client'}
              </Button>
              <Button variant="outline" onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ClientsPage;
