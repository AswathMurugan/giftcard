/**
 * Which client is looking at Vista.
 *
 * The identity comes from the signed-in account, not from the viewer. A
 * `party_user` grant keyed to their email says which client (or clients) they
 * may act for; every screen reads the resolved id from here and no screen
 * resolves its own.
 *
 * This replaced a header picker over every buyer in the tenant — the same
 * stand-in Relay had. It was not authorisation: it asked the viewer to declare
 * who they were and took the answer on trust, so any authenticated user could
 * read any client's orders, prices, proofs and signed documents. The switcher
 * still exists, but it can only offer parties the grant contains, and a client
 * with a single grant has nothing to switch between.
 *
 * What this is still NOT: row-level enforcement. Every saved query the portal
 * uses is filtered server-side by the resolved id, so a forgetful caller
 * cannot leak — but a hostile caller with a token could still call the API
 * directly with someone else's id. Closing that needs a row-level
 * `accessControl` rule on the entity, keyed to the signed-in user, so it holds
 * regardless of which query or app arrives. Resolving identity here is the
 * prerequisite for that rule, not a substitute for it.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getAuthService } from '@/config/auth-service-manager';
import { useSavedQueryList } from '@/hooks';
import type { PartyUserAccessRow } from '@/types/saved-queries.generated';
import { NoAccess } from './NoAccess';
import {
  needsChooser,
  resolveActiveParty,
  resolveEntitlement,
  selectableParties,
  type EntitledParty,
  type Entitlement,
} from './entitlement';

export interface ClientOption {
  id: string;
  name: string;
}

interface ClientSession {
  clientId: string;
  clientName: string;
  /** Only the parties this account is granted — never the tenant list. */
  options: ClientOption[];
  isLoading: boolean;
  /** True when there is more than one legitimate option to pick from. */
  canSwitch: boolean;
  /** True when the grant is an operator one, so the UI can say so. */
  isOperator: boolean;
  /** True when the account has no client entitlement at all. */
  hasNoAccess: boolean;
  /** The email the entitlement was resolved from, for the no-access message. */
  viewerEmail: string;
  setClientId: (id: string) => void;
}

const Ctx = createContext<ClientSession | null>(null);

/**
 * Remembered across reloads so a refresh does not bounce a multi-party user to
 * a different client. Re-validated against the live grant on every load — see
 * `resolveActiveParty`.
 */
const STORAGE_KEY = 'vista.clientId';

/** The signed-in account's email. `getSession()` is async, so this settles after first paint. */
function useViewerEmail(): { email: string; isLoading: boolean } {
  const [email, setEmail] = useState('');
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void getAuthService()
      .getSession()
      .then((session) => {
        if (cancelled) return;
        setEmail(session?.user?.email || session?.user?.username || '');
        setLoading(false);
      })
      .catch(() => {
        // Signed out or no session — resolve to no access rather than hang.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { email, isLoading };
}

export function ClientSessionProvider({ children }: { children: React.ReactNode }) {
  const viewer = useViewerEmail();

  const grants = useSavedQueryList('party_user_access', {
    input: { userEmail: viewer.email },
    enabled: Boolean(viewer.email),
  });

  const isOperatorGrant = useMemo(
    () =>
      ((grants.data ?? []) as PartyUserAccessRow[]).some(
        (r) => (r.portal ?? '').toLowerCase() === 'operator',
      ),
    [grants.data],
  );

  /**
   * The tenant buyer list is fetched ONLY for an operator.
   *
   * A client's browser must never receive the list of Fiserv's other clients,
   * and leaving the query ungated would put it on the wire even though the UI
   * dropped it.
   */
  const parties = useSavedQueryList('party_list', { enabled: isOperatorGrant });

  const allParties = useMemo<EntitledParty[]>(
    () =>
      ((parties.data ?? []) as Array<{ id?: string; name?: string }>)
        .filter((r): r is { id: string; name?: string } => Boolean(r.id))
        .map((r) => ({ id: r.id, name: r.name ?? 'Unnamed client' })),
    [parties.data],
  );

  const loading =
    viewer.isLoading || grants.isLoading || (isOperatorGrant && parties.isLoading);

  const entitlement = useMemo<Entitlement>(
    () =>
      resolveEntitlement(
        (grants.data ?? []) as PartyUserAccessRow[],
        'client',
        allParties,
        loading,
      ),
    [grants.data, allParties, loading],
  );

  const [remembered, setRemembered] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? '',
  );

  const clientId = useMemo(
    () => resolveActiveParty(entitlement, remembered),
    [entitlement, remembered],
  );

  const options = useMemo(() => selectableParties(entitlement), [entitlement]);

  const setClientId = (id: string) => {
    // Never trust the argument: only a granted id is written, so tampering
    // with the control cannot widen access.
    if (!options.some((o) => o.id === id)) return;
    localStorage.setItem(STORAGE_KEY, id);
    setRemembered(id);
  };

  const value = useMemo<ClientSession>(
    () => ({
      clientId,
      clientName: options.find((o) => o.id === clientId)?.name ?? '',
      options,
      isLoading: entitlement.kind === 'loading',
      canSwitch: needsChooser(entitlement),
      isOperator: entitlement.kind === 'operator',
      hasNoAccess: entitlement.kind === 'none',
      viewerEmail: viewer.email,
      setClientId,
    }),
    [clientId, options, entitlement, viewer.email],
  );

  /**
   * The refusal is enforced HERE, not per page — gating each screen separately
   * is how a new screen ends up unguarded, and an unguarded screen in this
   * portal is exactly the hole being closed.
   */
  if (value.hasNoAccess) {
    return (
      <Ctx.Provider value={value}>
        <NoAccess viewerEmail={value.viewerEmail} portalName="client" />
      </Ctx.Provider>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientSession(): ClientSession {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useClientSession must be used inside <ClientSessionProvider>');
  }
  return ctx;
}
