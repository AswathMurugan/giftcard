/**
 * Per-instance theming for `<AgentChat>`.
 *
 * The component styles itself with design tokens (`bg-primary`, `bg-muted`,
 * `text-foreground`, …). Rather than thread a colour through 20+ class names,
 * an appearance is applied as CSS-variable overrides SCOPED TO THE CHAT ROOT —
 * every existing token class then resolves against them automatically, and the
 * rest of the app is untouched.
 *
 * Structure, spacing and type scale are deliberately NOT themeable: the chat
 * should stay recognisably the same component wherever it is used.
 */

/** Icon glyphs (Nucleo classes). Each falls back to the default when omitted. */
export interface AgentChatIcons {
  /** Floating action button + header identity. Default: 'icon_-Tb_sparkles'. */
  launcher?: string;
  /** Starts a new conversation. Default: 'icon_-Tb_message_plus'. */
  newChat?: string;
  /** Opens the history panel. Default: 'icon_-Tb_history'. */
  history?: string;
  /** Closes a docked panel. Default: 'icon_-Tb_x'. */
  close?: string;
  /** Attach-a-file button. Default: 'icon_-Tb_paperclip'. */
  attach?: string;
  /** Send button. Default: 'icon_-Tb_arrow_up'. */
  send?: string;
  /** File attachment card. Default: 'icon_-Tb_file'. */
  file?: string;
}

/**
 * Colour overrides. Any CSS colour is accepted; omitted keys keep the app's
 * own token, so `{ accent: '#0F766E' }` is a complete, valid appearance.
 */
export interface AgentChatColors {
  /**
   * The single accent. Drives the FAB, send button, active dock item,
   * suggestion pills, spinners, and the attachment icon box.
   */
  accent?: string;
  /** Text/icon colour ON the accent (e.g. the send arrow). */
  onAccent?: string;
  /** Soft accent wash — active rows, suggestion hover, icon-box fill. */
  accentSoft?: string;
  /** Accent used for borders (suggestion pills, icon box, focus ring). */
  accentBorder?: string;

  /** Panel background. */
  surface?: string;
  /** Secondary fill — the user's message bubble, hover rows. */
  surfaceMuted?: string;
  /** Hairline borders. */
  border?: string;
  /** Primary text. */
  text?: string;
  /** Secondary text — subtitles, timestamps, status line. */
  textMuted?: string;
}

export interface AgentChatAppearance {
  colors?: AgentChatColors;
  icons?: AgentChatIcons;
}

export const DEFAULT_ICONS: Required<AgentChatIcons> = {
  launcher: 'icon_-Tb_sparkles',
  newChat: 'icon_-Tb_message_plus',
  history: 'icon_-Tb_history',
  close: 'icon_-Tb_x',
  attach: 'icon_-Tb_paperclip',
  send: 'icon_-Tb_arrow_up',
  file: 'icon_-Tb_file',
};

/** Merge a partial icon set over the defaults. */
export function resolveIcons(icons?: AgentChatIcons): Required<AgentChatIcons> {
  return { ...DEFAULT_ICONS, ...icons };
}

/**
 * Map an appearance to the CSS variables the token classes read.
 *
 * Returns a plain style object for the chat's root element. Only keys the
 * caller set are emitted, so unspecified colours inherit the app theme.
 *
 * `accent` fans out across the numbered primary ramp (50–700) because the
 * component uses several steps; without that, setting `accent` alone would
 * recolour some parts and leave others on the app's gold.
 */
export function appearanceStyle(
  appearance?: AgentChatAppearance,
): Record<string, string> {
  const c = appearance?.colors;
  if (!c) return {};
  const style: Record<string, string> = {};

  const set = (name: string, value?: string) => {
    if (value) style[name] = value;
  };

  // Accent ramp. `accentSoft`/`accentBorder` fall back to `accent` so a
  // one-colour appearance still themes every accented part coherently.
  const soft = c.accentSoft ?? c.accent;
  const line = c.accentBorder ?? c.accent;
  set('--primary', c.accent);
  set('--color-primary', c.accent);
  set('--color-primary-500', c.accent);
  set('--color-primary-600', c.accent);
  set('--color-primary-700', c.accent);
  set('--primary-foreground', c.onAccent);
  set('--color-primary-50', soft);
  set('--color-primary-100', soft);
  set('--color-primary-200', line);
  set('--color-primary-300', line);
  set('--color-primary-400', line);

  // Surfaces + text.
  set('--background', c.surface);
  set('--muted', c.surfaceMuted);
  set('--border', c.border);
  set('--input', c.border);
  set('--foreground', c.text);
  set('--muted-foreground', c.textMuted);

  return style;
}
