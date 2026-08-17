import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ThemeProvider } from '@/components/theme-provider';
import { BrandingProvider } from '@/components/branding-provider';
import { ConfigProvider } from '@/config/customization';
import { ensureAuthConfigured } from './config/auth-service-manager';
import { initializeApi } from './config/api-config';
import { logger } from './utils/logger';
import { installDevErrorToast } from './utils/dev-error-toast';
import { applyStoredTheme } from './lib/theme';
import { shouldRetryQuery, queryRetryDelay } from '@/lib/query-retry';
import { APPLICATION } from './types/app.generated';
// NOTE: ag-grid module/license registration is NOT imported here anymore.
// It lives in DataTable.tsx as a module side-effect, so ag-grid (community +
// enterprise) only enters the bundle when a page actually renders a
// <DataTable> — not on every app boot. See PHX-4455.
import './index.css';

logger.log('app:boot', { ts: Date.now() });

// Tab title = the deployed app's label (the static index.html ships a generic
// "vite-app" placeholder, which can't know the tenant's app at build time).
const appTitle = APPLICATION?.label || APPLICATION?.name;
if (appTitle && typeof document !== 'undefined') {
  document.title = appTitle;
}

// Apply the cached colour mode (light/dark) synchronously before React
// renders to prevent a flash. Per-tenant branding (theme/logo/favicon) is
// applied at runtime by BrandingProvider once preferences resolve.
applyStoredTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      // Status-aware: never retry 4xx; transient 5xx/network failures get 2
      // retries with capped exponential backoff. Mutations deliberately keep
      // the default of 0 retries (writes are not idempotent) — see
      // lib/query-retry.ts.
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
    },
  },
});

// Initialize auth + API services BEFORE rendering React. Otherwise the
// first React Query fires before the API client has an auth token and
// the request gets 403 from the platform. The user only sees this on
// the first load — a refresh works because the tokens are cached by
// then. Awaiting here makes the first render correct too.
async function boot() {
  installDevErrorToast();
  try {
    await ensureAuthConfigured();
    initializeApi();
    // The tenant application catalogue (cross-app navigation targets) is loaded
    // lazily once a valid session is confirmed in RequireAuth — not at boot, so
    // unauthenticated visitors (e.g. on /login) never trigger the fetch.
  } catch (err) {
    logger.error('app:boot:auth-failed', { error: String(err) });
    // Don't block render — auth-gated routes will handle the failure.
  }

  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement,
  );

  // Data router (createBrowserRouter + RouterProvider) instead of the classic
  // <BrowserRouter>: RR7's classic router does NOT support `useBlocker`, which
  // takeover flows need for unsaved-changes navigation guards. A single `*`
  // splat route renders the existing <App/> (and its descendant <Routes> in
  // routes/index.tsx + PrivateApp), so the page-authoring API is unchanged —
  // only the router base moves. Providers live INSIDE the route element so they
  // keep router context exactly as they did nested under <BrowserRouter>.
  const router = createBrowserRouter([
    {
      path: '*',
      element: (
        <QueryClientProvider client={queryClient}>
          {/* JiffyAI is a light design system — flat white surfaces, hairline
              borders, dark chrome only on the header. Default to light rather
              than "system", so the app never renders dark just because the OS
              is.

              `storageKey` is app-scoped on purpose. Every locally-run Vite app
              shares the `http://localhost:5173` origin, so the generic `theme`
              key leaks between them: a stale `"system"` written by a different
              app silently won over this default and forced dark. Namespacing
              the key keeps this app's preference its own. */}
          <ThemeProvider defaultTheme="light" storageKey="forge-theme">
            <BrandingProvider>
              <ConfigProvider>
                <App />
              </ConfigProvider>
            </BrandingProvider>
          </ThemeProvider>
        </QueryClientProvider>
      ),
    },
  ]);

  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void boot();
