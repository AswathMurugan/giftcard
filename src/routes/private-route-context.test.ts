import { describe, expect, it } from 'vitest';
import type { PrivateRouteDeclaration } from './PrivateRoute';
import { buildPrivateRouteContext } from './private-route-context';

function route(
  path: string,
  overrides: Partial<PrivateRouteDeclaration> = {},
): PrivateRouteDeclaration {
  return {
    path,
    element: null,
    label: 'Page',
    icon: 'icon_-Tb_file',
    description: undefined,
    layout: 'default',
    contentPadding: 'default',
    hideFromNav: false,
    hideFromHelper: false,
    permission: undefined,
    preload: undefined,
    ...overrides,
  };
}

describe('private route context', { tags: ['routing', 'logic'] }, () => {
  it('preserves visible nav and validates hidden local slugs', { tags: ['important'] }, () => {
    const context = buildPrivateRouteContext(
      [route('/clients'), route('/clients/:id', { hideFromNav: true })],
      ['preference'],
    );

    expect(context.navItems.map((item) => item.path)).toEqual(['/clients']);
    expect(context.allRouteSlugs).toEqual(
      new Set(['preference', 'clients', 'clients/:id']),
    );
    expect(context.contentPaddingRoutes).toHaveLength(2);
  });

  it('excludes blank and external routes from local slug validation', {
    tags: ['edge-case'],
  }, () => {
    const context = buildPrivateRouteContext([
      route('/blank', { layout: 'blank' }),
      route('__external__/app/page', {
        external: { appKey: 'app', screen: 'page' },
      }),
    ]);

    expect(context.allRouteSlugs).toEqual(new Set());
    expect(context.contentPaddingRoutes).toEqual([]);
  });
});
