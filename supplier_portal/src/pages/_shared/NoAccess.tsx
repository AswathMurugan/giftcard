/**
 * What an account with no entitlement sees.
 *
 * The important thing is what it does NOT do: fall back to showing everything.
 * The old picker's failure mode was exactly that — no identity meant "pick from
 * every supplier in the tenant" — so the safe state has to be an explicit
 * refusal, and it has to be the state every screen reaches when the grant is
 * absent rather than something each page decides for itself.
 *
 * It names the account it resolved, because the most common cause is a real
 * person signed into the wrong one, and "no access" without saying whose is a
 * support ticket.
 */
import { PAGE_CONTAINER } from '@/pages/page-shell';

export function NoAccess({
  viewerEmail,
  portalName,
}: {
  viewerEmail: string;
  portalName: string;
}) {
  return (
    <div className={PAGE_CONTAINER} data-testid="no-access">
      <div className="mx-auto mt-10 max-w-xl rounded-xl border border-border bg-card px-6 py-10 text-center">
        <i
          className="icon icon_-Tb_lock text-[1.75rem] text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="mt-3 text-[18px] font-bold text-foreground">
          This account has no {portalName} access
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {viewerEmail ? (
            <>
              <span className="font-semibold text-foreground">{viewerEmail}</span> is signed
              in, but it is not linked to any organisation on this portal.
            </>
          ) : (
            <>We could not identify the signed-in account.</>
          )}
        </p>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Ask your Fiserv contact to grant access for this address, or sign in with the
          account that was invited.
        </p>
      </div>
    </div>
  );
}

export default NoAccess;
