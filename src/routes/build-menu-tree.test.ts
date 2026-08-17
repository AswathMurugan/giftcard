import { describe, it, expect, vi } from 'vitest';
import { buildMenuTree } from './build-menu-tree';
import type { MenuConfigItem } from './nav-routes-context';
import { logger } from '@/utils/logger';

/** Minimal usable item factory (screen kind). */
function item(itemKey: string, extra: Partial<MenuConfigItem> = {}): MenuConfigItem {
  return { itemKey, appDefinitionKey: 'servicing_x', name: itemKey, screen: itemKey, ...extra };
}

describe('build-menu-tree', { tags: ['menu-config', 'logic'] }, () => {
  describe('flat + ordering', { tags: ['important'] }, () => {
    it('returns top-level nodes sorted by sortOrder (NULLS LAST, then position)', () => {
      const tree = buildMenuTree([
        item('c', { sortOrder: 2 }),
        item('a'), // no sortOrder → last
        item('b', { sortOrder: 1 }),
      ]);
      expect(tree.map((n) => n.itemKey)).toEqual(['b', 'c', 'a']);
      expect(tree.every((n) => n.children.length === 0)).toBe(true);
    });
  });

  describe('nesting (2 levels)', { tags: ['important'] }, () => {
    it('nests children under their parent, sorted by sortOrder', () => {
      const tree = buildMenuTree([
        item('parent'),
        item('c2', { parentKey: 'parent', sortOrder: 2 }),
        item('c1', { parentKey: 'parent', sortOrder: 1 }),
      ]);
      expect(tree).toHaveLength(1);
      expect(tree[0].itemKey).toBe('parent');
      expect(tree[0].children.map((c) => c.itemKey)).toEqual(['c1', 'c2']);
    });
  });

  describe('orphans + cycles', { tags: ['edge-case'] }, () => {
    it('drops an orphan (parentKey resolves to nothing) with warn', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      const tree = buildMenuTree([item('a'), item('b', { parentKey: 'ghost' })]);
      expect(tree.map((n) => n.itemKey)).toEqual(['a']);
      expect(warn).toHaveBeenCalledWith('menu-config:orphan', { itemKey: 'b' });
      warn.mockRestore();
    });

    it('drops a cycle with warn', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      const tree = buildMenuTree([
        item('x', { parentKey: 'y' }),
        item('y', { parentKey: 'x' }),
        item('ok'),
      ]);
      expect(tree.map((n) => n.itemKey)).toEqual(['ok']);
      expect(warn).toHaveBeenCalledWith('menu-config:cycle', { itemKey: 'x' });
      expect(warn).toHaveBeenCalledWith('menu-config:cycle', { itemKey: 'y' });
      warn.mockRestore();
    });

    it('drops a node whose ancestor is an orphan (propagates)', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      // b's parent a is itself an orphan (a.parent ghost) → both drop.
      const tree = buildMenuTree([
        item('a', { parentKey: 'ghost' }),
        item('b', { parentKey: 'a' }),
        item('ok'),
      ]);
      expect(tree.map((n) => n.itemKey)).toEqual(['ok']);
      warn.mockRestore();
    });
  });

  describe('duplicate keys', { tags: ['edge-case'] }, () => {
    it('keeps the first, warns on the duplicate', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      const tree = buildMenuTree([item('a', { name: 'First' }), item('a', { name: 'Second' })]);
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('First');
      expect(warn).toHaveBeenCalledWith('menu-config:duplicate-key', { itemKey: 'a' });
      warn.mockRestore();
    });
  });

  describe('depth clamp to 2 (pre-order flatten)', { tags: ['important'] }, () => {
    it('promotes depth-3+ nodes to depth-2 immediately after their parent', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => ({}) as never);
      // top → c1(depth2) → g1(depth3) → h1(depth4); c1 → g2(depth3); top → c2(depth2)
      const tree = buildMenuTree([
        item('top'),
        item('c1', { parentKey: 'top', sortOrder: 1 }),
        item('c2', { parentKey: 'top', sortOrder: 2 }),
        item('g1', { parentKey: 'c1', sortOrder: 1 }),
        item('g2', { parentKey: 'c1', sortOrder: 2 }),
        item('h1', { parentKey: 'g1', sortOrder: 1 }),
      ]);
      expect(tree).toHaveLength(1);
      // Pre-order under top: c1, g1, h1, g2, c2 — all flat depth-2 leaves.
      expect(tree[0].children.map((c) => c.itemKey)).toEqual(['c1', 'g1', 'h1', 'g2', 'c2']);
      expect(tree[0].children.every((c) => c.children.length === 0)).toBe(true);
      // One warn per clamped sub-tree root (the depth-3 nodes), not per node.
      const clampWarns = warn.mock.calls.filter((c) => c[0] === 'menu-config:depth-clamped');
      expect(clampWarns.map((c) => (c[1] as { itemKey: string }).itemKey).sort()).toEqual(['g1', 'g2']);
      warn.mockRestore();
    });
  });
});
