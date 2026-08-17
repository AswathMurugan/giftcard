import type { UserInfo } from '@/services/auth-service';

export interface CurrentUser {
  /** Display name (falls back to email, then username). */
  name: string;
  email?: string;
  subtitle?: string;
}

function profileString(
  profile: Record<string, unknown> | null | undefined,
  key: string
): string {
  const value = profile?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Resolve the platform user profile, retaining session values as fallbacks. */
export function resolveCurrentUser(
  sessionUser: UserInfo,
  profile?: Record<string, unknown> | null
): CurrentUser {
  const firstName = profileString(profile, 'first_name');
  const lastName = profileString(profile, 'last_name');
  const profileName = [firstName, lastName].filter(Boolean).join(' ');
  const sessionName = sessionUser.attributes?.name?.trim() || '';
  const email =
    profileString(profile, 'email') || sessionUser.email?.trim() || '';
  const name =
    profileName || sessionName || email || sessionUser.username.trim();
  const subtitle = profileString(profile, 'org_name');

  return {
    name,
    ...(email && { email }),
    ...(subtitle && { subtitle }),
  };
}

/** Up-to-two-letter initials from a name or email, for the avatar. */
export function userInitials(user: CurrentUser): string {
  const source = (user.name || user.email || '').trim();
  if (!source) return '?';
  const handle = source.includes('@') ? source.split('@')[0] : source;
  const parts = handle.split(/[\s._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : handle.slice(0, 2);
  return letters.toUpperCase();
}
