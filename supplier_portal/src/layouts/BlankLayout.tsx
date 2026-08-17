import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { Spinner } from '@/components/ui/spinner';

/**
 * Minimal full-bleed layout with no app chrome.
 * Used for login, onboarding, print views, or any page that should
 * render edge-to-edge without the sidebar / topbar.
 */
export function BlankLayout() {
  const location = useLocation();
  return (
    <div className="min-h-svh w-full bg-background text-foreground">
      <ErrorBoundary key={location.pathname} context={location.pathname}>
        {/* Suspense boundary for lazily-imported pages (see DefaultLayout /
            CLAUDE.md). PHX-4455. */}
        <Suspense
          fallback={
            <div className="flex min-h-svh w-full items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export default BlankLayout;
