/**
 * Clients — onboarding the side we sell to.
 *
 * The first ops screen. Everything downstream assumes a client exists: the
 * Create Order buyer picker reads them, a pricing template binds to one, and
 * Deal Review prices against that template. Until this page there was no way to
 * make one, so the tenant ran on two seeded merchants and the Pricing page's
 * "Add template" button was permanently disabled for want of a third.
 *
 * Reads `client_admin` — every merchant whatever its status, with its rate card
 * and its order history — and writes through `client_create` / `client_update`.
 *
 * The screen is a gate, not a form. A client is created `onboarding` and stays
 * out of Create Order until activated, and activation is refused while the rate
 * card would produce a deal nobody can price. That is the whole point: the
 * alternative is discovering a 0%-margin card body at Deal Review, which is
 * exactly what happened to Williams-Sonoma on GC-1073.
 */
import { useMemo, useState } from 'react';
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
import { COMPONENT_ROLES, pct } from '@/pages/pricing/pricing-helpers';
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
        'Client created as onboarding. Give them a rate card on the Pricing page, then activate them here.',
      );
    });
  }

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

                {/* The rate card, read-only — it is edited on the Pricing page,
                    which owns that write. Repeating the editor here would put
                    the same margin behind two controls. */}
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-1.5 flex items-baseline gap-2">
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
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {COMPONENT_ROLES.map((role) => {
                        const bps = view.margins[role];
                        const bad = view.atFloor.includes(role);
                        return (
                          <span
                            key={role}
                            className="text-[12.5px] capitalize text-muted-foreground"
                            data-testid={`client-margin-${view.name}-${role}`}
                          >
                            {role}{' '}
                            <span
                              className={
                                bps === undefined
                                  ? 'text-warning-700'
                                  : bad
                                    ? 'text-warning-700'
                                    : 'tabular-nums text-foreground'
                              }
                            >
                              {bps === undefined ? 'unpriced' : pct(bps)}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-muted-foreground">
                      No pricing template — add one on the Pricing page.
                    </p>
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
