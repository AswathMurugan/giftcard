import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { createJiffyAuthProvider, apiManager } from '@/services/api-manager';
import { cookieUtils, type SsoProvider } from '@/services/auth-service';
import { getAuthService, ensureAuthConfigured } from '@/config/auth-service-manager';
import { usePrefetchPreferences } from '@/queries/use-preferences';
import { usePrefetchPermissions } from '@/queries/use-permissions';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SsoButtons } from './sso-buttons';
import { resolveAutoSsoTarget } from './auto-sso';
import jiffyLogo from './assets/jiffy-logo.svg';
import loginHero from './assets/login-left.jpg';

const REMEMBER_ME_KEY = 'jiffy_remember_me';
const SAVED_USERNAME_KEY = 'jiffy_saved_username';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from || '/';

  const [isConfiguring, setIsConfiguring] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<SsoProvider[]>([]);
  const [isAutoRedirecting, setIsAutoRedirecting] = useState(false);
  const [unknownIdp, setUnknownIdp] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    () => localStorage.getItem(REMEMBER_ME_KEY) === 'true',
  );

  const authService = useMemo(() => getAuthService(), []);
  const prefetchPreferences = usePrefetchPreferences();
  const prefetchPermissions = usePrefetchPermissions();

  const { register, handleSubmit, watch, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username:
        localStorage.getItem(REMEMBER_ME_KEY) === 'true'
          ? localStorage.getItem(SAVED_USERNAME_KEY) || ''
          : '',
      password: '',
    },
  });

  // Source parity: the Login button is disabled (muted) until both fields have
  // content — matches the renderer's `isFieldsEmpty` gating.
  const watchedUsername = watch('username');
  const watchedPassword = watch('password');
  const isFieldsEmpty = !watchedUsername?.trim() || !watchedPassword?.trim();

  /**
   * Shared post-authentication steps: reconfigure the data API with the fresh
   * token, prime preferences + permissions caches, then navigate. Used by both
   * the password form and the SSO callback path.
   */
  const completeSignIn = useCallback(async () => {
    const origin =
      window.location.hostname === 'localhost' ||
      window.location.hostname.endsWith('.localhost')
        ? ''
        : window.location.origin;

    apiManager.configure(
      'data',
      `${origin}/data`,
      { Accept: 'application/json' },
      createJiffyAuthProvider({ authService, cookieUtils }),
      authService,
    );

    await prefetchPreferences().catch(() => null);
    await prefetchPermissions().catch(() => null);

    navigate(from, { replace: true });
  }, [authService, from, navigate, prefetchPreferences, prefetchPermissions]);

  // Configure auth on mount; capture the tenant's SSO providers.
  useEffect(() => {
    let cancelled = false;

    const configure = async () => {
      try {
        await ensureAuthConfigured();
        if (cancelled) return;
        setSsoProviders(authService.getSsoProviders());
        // Check if already has a valid session
        const session = await authService.getSession();
        if (cancelled) return;
        if (session?.isValid) {
          navigate(from, { replace: true });
          return;
        }
      } catch {
        // Config failed, show login form anyway
      } finally {
        if (!cancelled) setIsConfiguring(false);
      }
    };
    void configure();

    return () => {
      cancelled = true;
    };
  }, [authService, from, navigate]);

  // Initiate an SSO redirect to the IdP (Cognito Hosted UI).
  const startSso = useCallback(
    async (provider: SsoProvider) => {
      setIsAutoRedirecting(true);
      setLoginError(null);
      try {
        // Drop this tenant's stale cookies before federating out.
        cookieUtils.clearAuthCookies();
        await authService.handleSsoSignIn(provider);
      } catch (error) {
        setIsAutoRedirecting(false);
        setLoginError(
          error instanceof Error
            ? error.message
            : `Could not sign in with ${provider.provider_name ?? 'provider'}.`,
        );
      }
    },
    [authService],
  );

  // SSO callback + auto-redirect. After the IdP returns to /login?code=,
  // getSession() (called in the configure effect) completes the code exchange;
  // here we route based on the URL + configured providers.
  useEffect(() => {
    if (isConfiguring) return;

    // This effect re-runs on `location.search` / `ssoProviders` / `isConfiguring`
    // changes, so several `run()` calls can be in flight at once. Without the
    // guard a superseded run can still navigate, complete a sign-in, or fire a
    // second SSO redirect after a newer one has already started.
    let cancelled = false;

    const run = async () => {
      const session = await authService.getSession().catch(() => null);
      if (cancelled) return;
      if (session?.isValid) {
        await completeSignIn();
        return;
      }

      const resolution = resolveAutoSsoTarget(location.search, ssoProviders);
      switch (resolution.kind) {
        case 'callback':
        case 'form':
          return;
        case 'unknown':
          setUnknownIdp(resolution.idp);
          return;
        case 'redirect':
          await startSso(resolution.provider);
          return;
      }
    };

    // `run()` is fire-and-forget: without a catch, a throw from completeSignIn()
    // surfaces as an unhandled rejection on the auth path.
    void run().catch(() => {
      // Auth bootstrap failed — the form below is the fallback.
    });

    return () => {
      cancelled = true;
    };
  }, [
    authService,
    completeSignIn,
    isConfiguring,
    location.search,
    ssoProviders,
    startSso,
  ]);

  const onSubmit = useCallback(async (data: LoginFormData) => {
    setLoginError(null);
    setIsSubmitting(true);

    try {
      const result = await authService.login({
        username: data.username,
        password: data.password,
      });

      if (result.success) {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_ME_KEY, 'true');
          localStorage.setItem(SAVED_USERNAME_KEY, data.username);
        } else {
          localStorage.removeItem(REMEMBER_ME_KEY);
          localStorage.removeItem(SAVED_USERNAME_KEY);
        }
        await completeSignIn();
      } else {
        setLoginError(result.error?.message || 'Login failed. Please check your credentials.');
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }, [authService, completeSignIn, rememberMe]);

  // While federating out to an IdP, show a minimal redirecting state.
  if (isAutoRedirecting) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div
          className="flex items-center gap-3 text-base text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          Redirecting to your sign-in provider…
        </div>
      </div>
    );
  }

  const isFormDisabled = isConfiguring || isSubmitting;

  return (
    <div className="min-h-svh w-full bg-background py-[10vh]">
      <div className="grid h-full grid-cols-1 justify-center lg:grid-cols-[49rem_33rem]">
        {/* Left promo panel — fixed 49rem column, hidden below lg */}
        <div className="hidden h-full lg:ml-8 lg:mr-20 lg:block">
          <div className="flex h-[80vh] flex-col items-center rounded-[1.5rem] bg-[#f9f4e1] p-12 text-center">
            <img
              src={loginHero}
              alt="Team collaborating"
              className="mb-6 min-h-0 w-full flex-1 rounded-[0.8125rem] object-cover"
            />
            <h2 className="mb-2 shrink-0 text-[0.875rem] font-semibold leading-[2rem] text-[#282c36]">
              Imagine faster change.
            </h2>
            <p className="max-w-[34rem] shrink-0 text-[0.9375rem] font-[350] leading-[1.45] text-[#282c36]">
              See your data, people, and technology in a new light.
              <br />
              Build fresh concepts, connections and business workflows.
              <br />
              Imagine the possibilities of the future. Done, in a jiffy!
            </p>
          </div>
        </div>

        {/* Right form panel — fixed 33rem column, form fills it */}
        <div className="flex flex-col items-center justify-center p-8">
          <div className="flex w-full flex-col">
            <div className="mb-8 flex flex-col items-center text-center">
              {/* Renderer parity: the logo sits in a 9rem (144px) square box,
                  centered — the wide mark scales to ~144px wide / ~34px tall,
                  leaving whitespace that reads as a small logo + large gap. */}
              <div className="flex h-36 w-36 items-center justify-center">
                <img
                  src={jiffyLogo}
                  alt="JIFFY.ai"
                  className="w-36 object-contain"
                />
              </div>
              <h1 className="text-[1.25rem] font-normal leading-[2.25rem] tracking-[0.04rem] text-[#282c36]">
                {unknownIdp ? 'Provider not configured' : 'Welcome aboard!'}
              </h1>
              <p className="text-[0.8rem] leading-[1.45] tracking-[0.01rem] text-[#73767c]">
                {unknownIdp
                  ? `“${unknownIdp}” is not configured for this tenant.`
                  : 'Login to your account'}
              </p>
            </div>

            {unknownIdp ? (
              <Button
                variant="outline"
                className="h-[2.625rem] w-full rounded-[1.5rem]"
                onClick={() => {
                  setUnknownIdp(null);
                  navigate(location.pathname, { replace: true });
                }}
              >
                Use default sign-in
              </Button>
            ) : (
              <>
                <form
                  onSubmit={handleSubmit(onSubmit)}
                  className="flex w-full flex-col gap-4"
                >
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="username" className="text-[0.875rem] font-normal tracking-[0.015625rem] text-black">
                      Username
                    </Label>
                    <Input
                      id="username"
                      type="text"
                      autoComplete="username"
                      disabled={isFormDisabled}
                      placeholder="Type here"
                      className="h-[2.625rem] rounded-[0.5rem] px-3 py-2 font-normal leading-6 text-black"
                      {...register('username')}
                    />
                    {errors.username && (
                      <p className="text-sm text-destructive">
                        {errors.username.message}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="password" className="text-[0.875rem] font-normal tracking-[0.015625rem] text-black">
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        disabled={isFormDisabled}
                        placeholder="Type here"
                        className="h-[2.625rem] rounded-[0.5rem] px-3 py-2 pr-10 font-normal leading-6 text-black"
                        {...register('password')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="text-sm text-destructive">
                        {errors.password.message}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="remember-me"
                      className="rounded-full"
                      checked={rememberMe}
                      onCheckedChange={(v) => setRememberMe(v === true)}
                    />
                    <Label htmlFor="remember-me" className="font-normal">
                      Remember me
                    </Label>
                  </div>

                  {loginError && (
                    <Alert variant="destructive">
                      <AlertDescription>{loginError}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    className="mt-2 h-[2.625rem] w-full rounded-[1.5rem] px-3 text-[1rem] font-bold leading-6"
                    disabled={isFormDisabled || isFieldsEmpty}
                  >
                    {isConfiguring ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading…
                      </>
                    ) : isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      'Login'
                    )}
                  </Button>
                </form>

                {ssoProviders.length > 0 && (
                  <div className="mt-6">
                    <SsoButtons
                      providers={ssoProviders}
                      onProviderClick={startSso}
                      isDisabled={isFormDisabled}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
