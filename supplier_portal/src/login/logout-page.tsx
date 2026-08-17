import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuthService } from '@/config/auth-service-manager';

const REMEMBER_ME_KEY = 'jiffy_remember_me';
const SAVED_USERNAME_KEY = 'jiffy_saved_username';

/**
 * Logout route (`/logout`). Signs out of Cognito, clears local state, and
 * routes back to `/login`.
 *
 * SSO nuance (PHX-4075): if the tenant has a DEFAULT SSO provider, navigating
 * to a bare `/login` would auto-redirect straight back into a fresh SSO
 * session — defeating the logout. So we capture that BEFORE signing out and
 * route to `/login?idp=none` instead, landing the user on the form.
 */
export function LogoutPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const performLogout = async () => {
      // Capture default-SSO config before tearing down the auth service.
      let hasDefaultSso = false;
      try {
        hasDefaultSso = getAuthService().hasDefaultSsoProvider();
      } catch {
        // Auth service not initialized; treat as non-default tenant.
      }

      try {
        await getAuthService().logout();
      } catch {
        // Continue with local cleanup even if signOut failed.
      }

      // Preserve remember-me before the full clear, then restore.
      const rememberMe = localStorage.getItem(REMEMBER_ME_KEY);
      const savedUsername = localStorage.getItem(SAVED_USERNAME_KEY);
      localStorage.clear();
      if (rememberMe) localStorage.setItem(REMEMBER_ME_KEY, rememberMe);
      if (savedUsername) localStorage.setItem(SAVED_USERNAME_KEY, savedUsername);

      if (cancelled) return;
      navigate(hasDefaultSso ? '/login?idp=none' : '/login', { replace: true });
    };

    void performLogout();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}

export default LogoutPage;
