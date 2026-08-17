/**
 * Chat window position — shared between the launcher (which hides the FAB while
 * docked) and the window (which renders the dock menu).
 *
 * 'float' is the default popover; 'left'/'right' pin a full-height side panel
 * and the app root reserves width for it (see the `.chat-docked--*` rules in
 * `src/index.css`). The choice is persisted so it sticks across opens.
 */

export type DockMode = 'float' | 'left' | 'right';

const DOCK_STORAGE_KEY = 'agent-chat-dock-mode';

export function readDockMode(fallback: DockMode = 'float'): DockMode {
  try {
    const saved = window.localStorage.getItem(DOCK_STORAGE_KEY);
    if (saved === 'left' || saved === 'right' || saved === 'float') return saved;
  } catch {
    // localStorage unavailable (private mode / quota) — use the fallback.
  }
  return fallback;
}

export function writeDockMode(mode: DockMode): void {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, mode);
  } catch {
    // Non-fatal — the mode just won't persist.
  }
}

export interface DockMenuItem {
  value: DockMode;
  label: string;
  /** Nucleo glyph class. */
  icon: string;
}

/**
 * Menu entries + the collapsed trigger glyph, from one source so they can't
 * drift apart.
 */
export const DOCK_MENU_ITEMS: DockMenuItem[] = [
  { value: 'float', label: 'Floating', icon: 'icon_-Tb_box_margin' },
  { value: 'left', label: 'Dock Left', icon: 'icon_-Tb_box_align_left' },
  { value: 'right', label: 'Dock Right', icon: 'icon_-Tb_box_align_right' },
];

export const DOCK_TRIGGER_ICON: Record<DockMode, string> = {
  float: 'icon_-Tb_box_margin',
  left: 'icon_-Tb_box_align_left',
  right: 'icon_-Tb_box_align_right',
};

// ── Docked-panel width ──────────────────────────────────────────────────────
// The width lives in a CSS variable on <html> so ONE value drives both the
// panel and the app-root reserve — they can't drift apart mid-drag.

const DOCK_WIDTH_VAR = '--agent-chat-dock-width';
const DOCK_WIDTH_KEY = 'agent-chat-dock-width';

export const DOCK_MIN_PX = 320; // 20rem
export const DOCK_MAX_PX = 768; // 48rem
export const DOCK_DEFAULT_PX = 400; // 25rem

/** Clamp a candidate width to the resizable range. */
export function clampDockWidth(px: number): number {
  return Math.max(DOCK_MIN_PX, Math.min(DOCK_MAX_PX, px));
}

/**
 * Width for a pointer position, given which edge the panel is pinned to.
 * Dragging the handle of a left-docked panel grows it rightward; a right-docked
 * panel grows leftward — hence the mirror.
 */
export function dockWidthFromPointer(
  clientX: number,
  mode: DockMode,
  viewportWidth: number,
): number {
  return clampDockWidth(mode === 'left' ? clientX : viewportWidth - clientX);
}

export function readDockWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(DOCK_WIDTH_KEY));
    if (saved >= DOCK_MIN_PX && saved <= DOCK_MAX_PX) return saved;
  } catch {
    // localStorage unavailable — use the default.
  }
  return DOCK_DEFAULT_PX;
}

export function writeDockWidth(px: number): void {
  try {
    window.localStorage.setItem(DOCK_WIDTH_KEY, String(px));
  } catch {
    // Non-fatal — the width just won't persist.
  }
}

/** Publish the width so the panel and the app-root reserve both track it. */
export function applyDockWidth(px: number): void {
  document.documentElement.style.setProperty(DOCK_WIDTH_VAR, `${px}px`);
}
