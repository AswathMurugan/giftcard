import { describe, it, expect } from 'vitest';
import type { PrivateRouteDeclaration } from '@/routes/PrivateRoute';
import {
  userRoutes,
  hasUserPages,
  firstUserPath,
  resolveDocumentTitle,
  excludeReservedPageRoutes,
  isBuiltInPagePath,
} from './PrivateApp';

/** Minimal route declaration factory for the helper tests (no React render). */
function route(
  path: string,
  opts: Partial<PrivateRouteDeclaration> = {},
): PrivateRouteDeclaration {
  return {
    path,
    element: null,
    label: opts.label,
    icon: opts.icon,
    description: opts.description,
    layout: opts.layout ?? 'default',
    contentPadding: opts.contentPadding ?? 'default',
    hideFromNav: opts.hideFromNav ?? false,
    hideFromHelper: opts.hideFromHelper ?? false,
    permission: opts.permission,
    preload: opts.preload,
  };
}

describe('PrivateApp routing helpers', { tags: ['routing', 'logic'] }, () => {
  describe('hasUserPages', { tags: ['important'] }, () => {
    it('is false when only the root `/` route exists', () => {
      expect(hasUserPages([route('/')])).toBe(false);
    });

    it('is false for an empty route list', { tags: ['edge-case'] }, () => {
      expect(hasUserPages([])).toBe(false);
    });

    it('is true once any non-root page is declared', () => {
      expect(hasUserPages([route('/'), route('/clients')])).toBe(true);
    });
  });

  describe('userRoutes', { tags: ['smoke'] }, () => {
    it('excludes the root `/` path', () => {
      const result = userRoutes([route('/'), route('/clients'), route('/accounts')]);
      expect(result.map((r) => r.path)).toEqual(['/clients', '/accounts']);
    });
  });

  describe('firstUserPath', { tags: ['important'] }, () => {
    it('returns null when there are no user pages', { tags: ['edge-case'] }, () => {
      expect(firstUserPath([route('/')])).toBeNull();
    });

    it('returns the first nav-eligible page', () => {
      const routes = [route('/'), route('/clients'), route('/accounts')];
      expect(firstUserPath(routes)).toBe('/clients');
    });

    it('skips hidden-from-nav pages when a visible one follows', () => {
      const routes = [
        route('/'),
        route('/clients/:id', { hideFromNav: true }),
        route('/clients'),
      ];
      expect(firstUserPath(routes)).toBe('/clients');
    });

    it('skips param deep links even when nav-eligible', { tags: ['edge-case'] }, () => {
      const routes = [route('/'), route('/clients/:id'), route('/accounts')];
      expect(firstUserPath(routes)).toBe('/accounts');
    });

    it('falls back to the first user route when all are hidden/param', () => {
      const routes = [
        route('/'),
        route('/clients/:id', { hideFromNav: true }),
        route('/accounts/:id', { hideFromNav: true }),
      ];
      expect(firstUserPath(routes)).toBe('/clients/:id');
    });
  });

  describe('resolveDocumentTitle', { tags: ['important'] }, () => {
    const routes = [
      route('/'),
      route('/clients', { label: 'Clients' }),
      route('/clients/:id', { label: 'Client Detail', hideFromNav: true }),
      route('/blank', { hideFromNav: true }), // no label
    ];

    it('returns the page label when a route matches', () => {
      expect(resolveDocumentTitle('/clients', routes, 'My App')).toBe('Clients');
    });

    it('matches param routes and uses their label', () => {
      expect(resolveDocumentTitle('/clients/42', routes, 'My App')).toBe(
        'Client Detail',
      );
    });

    it('falls back to the app name on no match (e.g. root)', { tags: ['edge-case'] }, () => {
      expect(resolveDocumentTitle('/', routes, 'My App')).toBe('My App');
      expect(resolveDocumentTitle('/nope', routes, 'My App')).toBe('My App');
    });

    it('falls back to the app name for a matched route without a label', { tags: ['edge-case'] }, () => {
      expect(resolveDocumentTitle('/blank', routes, 'My App')).toBe('My App');
    });

    it('ignores external (cross-app) entries', { tags: ['edge-case'] }, () => {
      const withExternal = [
        ...routes,
        route('/__external__/x/y', {
          label: 'Other App',
          external: { appKey: 'x', screen: 'y' },
        }),
      ];
      // The external item's synthetic path shouldn't ever match a real URL, and
      // even its label must not leak as a title.
      expect(resolveDocumentTitle('/clients', withExternal, 'My App')).toBe(
        'Clients',
      );
    });
  });

  describe('reserved built-in pages', { tags: ['important'] }, () => {
    it('recognizes the built-in preference route with an optional trailing slash', () => {
      expect(isBuiltInPagePath('/preference')).toBe(true);
      expect(isBuiltInPagePath('/preference/')).toBe(true);
      expect(isBuiltInPagePath('/Preference')).toBe(true);
      expect(isBuiltInPagePath('/preferences')).toBe(false);
    });

    it('excludes a generated route that reuses the preference page name', () => {
      const routes = [route('/clients'), route('/Preference')];
      expect(excludeReservedPageRoutes(routes).map((candidate) => candidate.path)).toEqual([
        '/clients',
      ]);
    });
  });
});
