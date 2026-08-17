import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * HelperMenu — headless bridge for the editor's app-tools menu.
 *
 * The helper menu UI now lives in the editor chat input (parent frame). This
 * component stays mounted in the app layout and listens for `jiffy:*` commands
 * posted from that editor:
 *   - `jiffy:navigate` `{ route }` → navigate the app router to a helper page
 *     (Getting Started / Showcase / Test Results / Error Boundary / Logs).
 *   - `jiffy:refetch` → re-run the bootstrap codegens via the workspace Vite's
 *     `/__jiffy/refetch` endpoint (entities, saved queries, enums, app config,
 *     roles) and full-reload the preview.
 *
 * It renders nothing.
 */
export function HelperMenu() {
  const navigate = useNavigate();
  const [refetchState, setRefetchState] = useState<'idle' | 'running' | 'error'>(
    'idle',
  );

  const triggerRefetch = useCallback(async () => {
    if (refetchState === 'running') return;
    setRefetchState('running');
    try {
      const res = await fetch('/__jiffy/refetch', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Success → the server sends a full-reload over the HMR socket; this
      // component unmounts with the page. Nothing more to do.
    } catch (err) {
      console.error('[helper-menu] refetch failed:', err);
      setRefetchState('error');
    }
  }, [refetchState]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only accept commands from the embedding editor (the parent frame).
      if (event.source !== window.parent) return;
      const data = event.data as { type?: string; route?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'jiffy:refetch') {
        void triggerRefetch();
      } else if (
        data.type === 'jiffy:navigate' &&
        typeof data.route === 'string'
      ) {
        navigate(data.route);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate, triggerRefetch]);

  return null;
}
