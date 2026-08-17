import { describe, it, expect } from 'vitest';
import {
  clampDockWidth,
  dockWidthFromPointer,
  DOCK_MIN_PX,
  DOCK_MAX_PX,
  DOCK_DEFAULT_PX,
  DOCK_MENU_ITEMS,
  DOCK_TRIGGER_ICON,
} from './dock-mode';

describe('clampDockWidth', { tags: ['agent-chat', 'logic'] }, () => {
  it('passes an in-range width through', () => {
    expect(clampDockWidth(500)).toBe(500);
  });

  it('clamps below the minimum', { tags: ['edge-case'] }, () => {
    expect(clampDockWidth(0)).toBe(DOCK_MIN_PX);
    expect(clampDockWidth(-200)).toBe(DOCK_MIN_PX);
  });

  it('clamps above the maximum', { tags: ['edge-case'] }, () => {
    expect(clampDockWidth(5000)).toBe(DOCK_MAX_PX);
  });

  it('keeps the bounds themselves', () => {
    expect(clampDockWidth(DOCK_MIN_PX)).toBe(DOCK_MIN_PX);
    expect(clampDockWidth(DOCK_MAX_PX)).toBe(DOCK_MAX_PX);
  });
});

describe('dockWidthFromPointer', { tags: ['agent-chat', 'important'] }, () => {
  const VIEWPORT = 1600;

  it('a left-docked panel grows rightward with the pointer', () => {
    // Handle on the panel's right edge: width IS the pointer x.
    expect(dockWidthFromPointer(500, 'left', VIEWPORT)).toBe(500);
  });

  it('a right-docked panel grows leftward — the mirror', () => {
    // Handle on the panel's left edge: width is the distance to the right edge.
    expect(dockWidthFromPointer(1100, 'right', VIEWPORT)).toBe(500);
  });

  it('clamps a drag past the minimum', { tags: ['edge-case'] }, () => {
    expect(dockWidthFromPointer(10, 'left', VIEWPORT)).toBe(DOCK_MIN_PX);
    // Dragging a right-docked panel toward its own edge shrinks it to the min.
    expect(dockWidthFromPointer(VIEWPORT - 10, 'right', VIEWPORT)).toBe(DOCK_MIN_PX);
  });

  it('clamps a drag past the maximum', { tags: ['edge-case'] }, () => {
    expect(dockWidthFromPointer(VIEWPORT - 10, 'left', VIEWPORT)).toBe(DOCK_MAX_PX);
    expect(dockWidthFromPointer(10, 'right', VIEWPORT)).toBe(DOCK_MAX_PX);
  });

  it('handles a pointer dragged outside the viewport', { tags: ['edge-case'] }, () => {
    expect(dockWidthFromPointer(-50, 'left', VIEWPORT)).toBe(DOCK_MIN_PX);
    expect(dockWidthFromPointer(VIEWPORT + 50, 'left', VIEWPORT)).toBe(DOCK_MAX_PX);
  });
});

describe('dock constants', { tags: ['agent-chat', 'smoke'] }, () => {
  it('has a sane, ordered range with the default inside it', () => {
    expect(DOCK_MIN_PX).toBeLessThan(DOCK_MAX_PX);
    expect(DOCK_DEFAULT_PX).toBeGreaterThanOrEqual(DOCK_MIN_PX);
    expect(DOCK_DEFAULT_PX).toBeLessThanOrEqual(DOCK_MAX_PX);
  });

  it('offers the three window positions', () => {
    expect(DOCK_MENU_ITEMS.map((i) => i.value)).toEqual(['float', 'left', 'right']);
  });

  it('has a trigger glyph for every mode, matching the menu', () => {
    for (const item of DOCK_MENU_ITEMS) {
      expect(DOCK_TRIGGER_ICON[item.value]).toBe(item.icon);
    }
  });
});
