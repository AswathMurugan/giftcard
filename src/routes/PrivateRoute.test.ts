import { describe, expect, it } from 'vitest';
import { PrivateRoute } from './PrivateRoute';
import { getRegisteredPrivateRoutes } from './private-route-registry';

describe('PrivateRoute registry', { tags: ['routing', 'logic'] }, () => {
  it('retains normalized declarations for compatibility layouts', {
    tags: ['important'],
  }, () => {
    const path = '/registry-test-route';
    PrivateRoute({
      path,
      label: 'Registry test',
      icon: 'icon_-Tb_route',
      element: null,
    });

    expect(getRegisteredPrivateRoutes().find((route) => route.path === path)).toMatchObject({
      path,
      label: 'Registry test',
      hideFromNav: false,
      layout: 'default',
    });
  });
});
