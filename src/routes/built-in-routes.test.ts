import { describe, expect, it } from 'vitest';
import {
  privateRoutesDeclarePreference,
  withDefaultPreferenceNav,
} from './built-in-routes';

describe('built-in route compatibility', { tags: ['routing', 'logic'] }, () => {
  it('detects the reserved route case-insensitively with an optional trailing slash', {
    tags: ['important'],
  }, () => {
    expect(
      privateRoutesDeclarePreference([{ path: '/clients' }, { path: '/Preference/' }]),
    ).toBe(true);
    expect(privateRoutesDeclarePreference([{ path: '/preferences' }])).toBe(false);
  });

  it('adds the default nav item only for an older app without the route', {
    tags: ['important'],
  }, () => {
    const clients = [{ path: '/clients', label: 'Clients', icon: 'icon_-Tb_users' }];
    expect(withDefaultPreferenceNav(clients, false).map((route) => route.path)).toEqual([
      '/clients',
      '/preference',
    ]);
    expect(withDefaultPreferenceNav(clients, true)).toBe(clients);

    const alreadyPresent = [
      ...clients,
      { path: '/preference', label: 'Preferences', icon: 'icon_-Tb_adjustments_horizontal' },
    ];
    expect(withDefaultPreferenceNav(alreadyPresent, false)).toBe(alreadyPresent);
  });
});
