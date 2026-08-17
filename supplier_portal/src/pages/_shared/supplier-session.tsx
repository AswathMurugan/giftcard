/**
 * Who is looking at Relay.
 *
 * The identity comes from the signed-in account, not from the viewer. A
 * `party_user` grant keyed to their email says which supplier (or suppliers)
 * they may act for; every screen reads the resolved id from here and no screen
 * invents its own.
 *
 * This replaced a header picker over EVERY supplier in the tenant. That picker
 * was not authorisation — it asked the viewer to declare who they were and
 * took the answer on trust, so any authenticated user could read any
 * supplier's orders, prices and documents. The switcher still exists, but it
 * can now only offer parties the grant contains, and for most users there is
 * nothing to switch between.
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
import { NoAccess } from './NoAccess';
import { useSavedQueryList } from '@/hooks';
import type { PartyUserAccessRow } from '@/types/saved-queries.generated';
import {
  needsChooser,
  resolveActiveParty,
  resolveEntitlement,
  selectableParties,
  type EntitledParty,
  type Entitlement,
} from './entitlement';

export interface SupplierOption {
  id: string;
  name: string;
}

interface SupplierSession {
  supplierId: string;
  supplierName: string;
  /** Only the parties this account is granted — never the tenant list. */
  options: SupplierOption[];
  isLoading: boolean;
  /** True when there is more than one legitimate option to pick from. */
  canSwitch: boolean;
  /** True when the grant is an operator one, so the UI can say so. */
  isOperator: boolean;
  /** True when the account has no supplier entitlement at all. */
  hasNoAccess: boolean;
  /** The email the entitlement was resolved from, for the no-access message. */
  viewerEmail: string;
  setSupplierId: (id: string) => void;
}

const Ctx = createContext<SupplierSession | null>(null);

/**
 * Remembered across reloads so a refresh does not bounce a multi-party user to
 * a different supplier. Re-validated against the live grant on every load —
 * see `resolveActiveParty`.
 */
const STORAGE_KEY = 'relay.supplierId';

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

export function SupplierSessionProvider({ children }: { children: React.ReactNode }) {
  const viewer = useViewerEmail();

  const grants = useSavedQueryList('party_user_access', {
    input: { userEmail: viewer.email },
    enabled: Boolean(viewer.email),
  });

  /**
   * The tenant supplier list is fetched ONLY for an operator.
   *
   * Gating the request on the grant is deliberate: a supplier's browser should
   * never receive the full list of their competitors, and leaving the query
   * ungated would put it on the wire even though the UI dropped it.
   */
  const isOperatorGrant = useMemo(
    () =>
      ((grants.data ?? []) as PartyUserAccessRow[]).some(
        (r) => (r.portal ?? '').toLowerCase() === 'operator',
      ),
    [grants.data],
  );

  const suppliers = useSavedQueryList('supplier_list', { enabled: isOperatorGrant });

  const allParties = useMemo<EntitledParty[]>(
    () =>
      ((suppliers.data ?? []) as Array<{ id?: string; name?: string }>)
        .filter((r): r is { id: string; name?: string } => Boolean(r.id))
        .map((r) => ({ id: r.id, name: r.name ?? 'Unnamed supplier' })),
    [suppliers.data],
  );

  const loading =
    viewer.isLoading || grants.isLoading || (isOperatorGrant && suppliers.isLoading);

  const entitlement = useMemo<Entitlement>(
    () =>
      resolveEntitlement(
        (grants.data ?? []) as PartyUserAccessRow[],
        'supplier',
        allParties,
        loading,
      ),
    [grants.data, allParties, loading],
  );

  const [remembered, setRemembered] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? '',
  );

  const supplierId = useMemo(
    () => resolveActiveParty(entitlement, remembered),
    [entitlement, remembered],
  );

  const options = useMemo(() => selectableParties(entitlement), [entitlement]);

  const setSupplierId = (id: string) => {
    // Never trust the argument: a caller could pass any id. Only a granted one
    // is written, so tampering with the control cannot widen access.
    if (!options.some((o) => o.id === id)) return;
    localStorage.setItem(STORAGE_KEY, id);
    setRemembered(id);
  };

  const value = useMemo<SupplierSession>(
    () => ({
      supplierId,
      supplierName: options.find((o) => o.id === supplierId)?.name ?? '',
      options,
      isLoading: entitlement.kind === 'loading',
      canSwitch: needsChooser(entitlement),
      isOperator: entitlement.kind === 'operator',
      hasNoAccess: entitlement.kind === 'none',
      viewerEmail: viewer.email,
      setSupplierId,
    }),
    [supplierId, options, entitlement, viewer.email],
  );

  /**
   * The refusal is enforced HERE, not per page.
   *
   * Gating each screen separately is how a new screen ends up unguarded — and
   * an unguarded screen in this portal is exactly the hole being closed. One
   * gate at the provider means every current and future page inherits it.
   */
  if (value.hasNoAccess) {
    return (
      <Ctx.Provider value={value}>
        <NoAccess viewerEmail={value.viewerEmail} portalName="supplier" />
      </Ctx.Provider>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSupplierSession(): SupplierSession {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useSupplierSession must be used inside <SupplierSessionProvider>');
  }
  return ctx;
}
