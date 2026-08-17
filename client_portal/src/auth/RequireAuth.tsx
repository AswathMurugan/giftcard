import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getAuthService } from '@/config/auth-service-manager';
import { usePermissions } from '@/queries/use-permissions';
import { loadApplications, areApplicationsLoaded } from '@/config/applications';

/**
 * Auth guard — redirects to /login if no valid session.
 *
 * Per-tenant branding is applied separately by `BrandingProvider`, which
 * fetches preferences at runtime; this guard only checks the session.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const authService = useMemo(() => getAuthService(), []);
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  usePermissions();

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const token = authService.getAccessToken();
        let authed = false;
        if (token) {
          authed = true;
        } else {
          const session = await authService.getSession();
          authed = !!session?.isValid;
        }
        if (cancelled) return;
        setAuthenticated(authed);
        // Load the tenant application catalogue only once a valid session is
        // confirmed. Fire-and-forget (chrome only; must not block navigation)
        // and guarded so it fetches at most once per session.
        if (authed && !areApplicationsLoaded()) {
          void loadApplications();
        }
      } catch {
        if (!cancelled) setAuthenticated(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    void check();

    return () => {
      cancelled = true;
    };
  }, [authService]);

  if (checking) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

export default RequireAuth;
