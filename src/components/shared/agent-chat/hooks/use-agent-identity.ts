/**
 * Who + where a turn is sent as — shared by the chat UI and the headless task
 * runner, so both address the agent identically.
 */
import { useEffect, useMemo, useState } from 'react';
import { getAppConfig } from '@/config/api-config';
import { getAuthService } from '@/config/auth-service-manager';
import type { AgentRequestContext } from '@/components/shared/agent-chat/agent-metadata';

/**
 * Current user id for the wire envelope + session scope.
 *
 * `getSession()` is async (the same path `UserMenu` uses), so this resolves
 * after first paint; the transport is gated on it, since an empty `user_id`
 * would scope the session to the wrong bucket. Prefers `jiffy_user_id` (the
 * platform's own id), falling back to the Cognito username.
 */
export function useUserId(): string {
  const [userId, setUserId] = useState('');
  useEffect(() => {
    let cancelled = false;
    void getAuthService()
      .getSession()
      .then((session) => {
        if (cancelled || !session?.user) return;
        setUserId(session.user.jiffy_user_id || session.user.username || '');
      })
      .catch(() => {
        // Signed out / no session — the caller stays gated.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return userId;
}

/** App + tenant + user context for an agent request. */
export function useAgentRequestContext(): AgentRequestContext {
  const userId = useUserId();
  return useMemo<AgentRequestContext>(() => {
    const app = getAppConfig();
    return {
      appName: app.appName,
      appDefinition: app.appDefinition,
      tenant: app.tenant,
      env: app.env,
      userId,
    };
  }, [userId]);
}
