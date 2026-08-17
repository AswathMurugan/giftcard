import { Login } from '@/login/login';
import { LogoutPage } from '@/login/logout-page';
import type { HiddenRouteConfig } from './types';

/**
 * Routes accessible without authentication.
 * Add additional public routes (signup, password reset, etc.) here.
 */
export const publicRoutes: HiddenRouteConfig[] = [
  { path: '/login', element: <Login />, layout: 'blank' },
  // SSO/federated logout (PHX-4075): clears the session and routes back to
  // /login (or /login?idp=none for default-SSO tenants, to avoid auto-relogin).
  { path: '/logout', element: <LogoutPage />, layout: 'blank' },
];
