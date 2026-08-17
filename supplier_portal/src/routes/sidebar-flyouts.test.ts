import { describe, it, expect } from 'vitest';
import { leadingFlyouts, flyoutsAfter, type SidebarFlyout } from './sidebar-flyouts';

const fly = (id: string, afterPath?: string): SidebarFlyout => ({
  id,
  icon: 'icon_-Tb_briefcase',
  label: id,
  content: null,
  ...(afterPath ? { afterPath } : {}),
});

describe('sidebar-flyouts ordering', { tags: ['layout', 'logic'] }, () => {
  it('leadingFlyouts keeps only entries without afterPath (default first position)', { tags: ['smoke'] }, () => {
    const flyouts = [fly('a'), fly('b', '/dash'), fly('c')];
    expect(leadingFlyouts(flyouts).map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('flyoutsAfter anchors entries to their nav item path', { tags: ['important'] }, () => {
    const flyouts = [fly('a'), fly('b', '/dash'), fly('c', '/other'), fly('d', '/dash')];
    expect(flyoutsAfter(flyouts, '/dash').map((f) => f.id)).toEqual(['b', 'd']);
    expect(flyoutsAfter(flyouts, '/other').map((f) => f.id)).toEqual(['c']);
    expect(flyoutsAfter(flyouts, '/missing')).toEqual([]);
  });

  it('every flyout renders exactly once across positions', { tags: ['edge-case'] }, () => {
    const flyouts = [fly('a'), fly('b', '/x'), fly('c', '/y')];
    const paths = ['/x', '/y', '/z'];
    const rendered = [
      ...leadingFlyouts(flyouts),
      ...paths.flatMap((p) => flyoutsAfter(flyouts, p)),
    ];
    expect(rendered.map((f) => f.id).sort()).toEqual(['a', 'b', 'c']);
  });
});
