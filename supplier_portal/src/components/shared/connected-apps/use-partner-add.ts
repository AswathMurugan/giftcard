import { useEffect, useRef, useCallback } from 'react';
import {
  processPartnerCallback,
  savePreferences,
  setDefaultConfig,
} from '@/services/partner-modules-api';
import { CONNECTED_APPS_TEXT } from './types';
import type { ConnectedAccount, ConnectedPartner } from './types';

export interface UsePartnerAddOptions {
  onRefresh: () => Promise<void> | void;
  onPendingAccount: (
    partner: ConnectedPartner,
    account: ConnectedAccount,
  ) => void;
}

export interface UsePartnerAddResult {
  handleAdd: (partner: ConnectedPartner) => Promise<void>;
}

/**
 * Drives the "Add account" OAuth flow: opens the partner's authorization URL
 * in a popup, waits for the popup to postMessage its callback payload, then
 * processes it server-side and persists display preferences.
 */
export function usePartnerAdd({
  onRefresh,
  onPendingAccount,
}: UsePartnerAddOptions): UsePartnerAddResult {
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(
    null,
  );
  const onRefreshRef = useRef(onRefresh);
  const onPendingAccountRef = useRef(onPendingAccount);

  // Synced after commit rather than during render — see the note in
  // use-chat-sessions.ts. Both refs are read only from the `message` event
  // handler, which runs well after commit.
  useEffect(() => {
    onRefreshRef.current = onRefresh;
    onPendingAccountRef.current = onPendingAccount;
  });

  useEffect(() => {
    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener('message', messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
    };
  }, []);

  const handleAdd = useCallback(
    async (partner: ConnectedPartner): Promise<void> => {
      const { defaultConfig } = partner;
      if (!defaultConfig) return;

      const { parameters, authenticatorName } = defaultConfig;
      const newConfigId = crypto.randomUUID();
      const prefix = `${authenticatorName}:`;
      let authUrl: string | undefined;
      const queryParams = new URLSearchParams();

      for (const [key, value] of Object.entries(parameters ?? {})) {
        let effectiveKey: string;
        if (key.startsWith(prefix)) {
          effectiveKey = key.slice(prefix.length);
        } else if (!key.includes(':')) {
          effectiveKey = key;
        } else {
          continue;
        }

        if (effectiveKey === 'user_authorization_url') {
          authUrl = value;
        } else if (value) {
          queryParams.append(effectiveKey, value);
        }
      }

      if (!authUrl) return;

      const url = queryParams.toString()
        ? `${authUrl}?${queryParams.toString()}`
        : authUrl;

      const popup = window.open(url, '_blank', 'width=600,height=700');

      if (messageHandlerRef.current) {
        window.removeEventListener('message', messageHandlerRef.current);
      }

      function messageHandler(event: MessageEvent): void {
        if (event.source !== popup) {
          return;
        }

        if (
          !event.data ||
          typeof event.data !== 'object' ||
          Array.isArray(event.data)
        ) {
          return;
        }

        window.removeEventListener('message', messageHandler);
        messageHandlerRef.current = null;

        const callbackData = event.data as Record<string, unknown>;

        const placeholder: ConnectedAccount = {
          id: newConfigId,
          configId: newConfigId,
          name: CONNECTED_APPS_TEXT.defaultAccountName(
            partner.name,
            partner.accounts.length + 1,
          ),
          status: 'saving',
        };
        onPendingAccountRef.current(partner, placeholder);

        processPartnerCallback(
          partner.id,
          authenticatorName,
          newConfigId,
          partner.app_definition,
          callbackData,
        )
          .then(async (response) => {
            const existingCount = partner.accounts.length;
            const displayLabel =
              typeof response?.name === 'string'
                ? response.name
                : CONNECTED_APPS_TEXT.defaultAccountName(
                    partner.name,
                    existingCount + 1,
                  );
            const description =
              typeof response?.description === 'string'
                ? response.description
                : CONNECTED_APPS_TEXT.defaultAccountDescription(partner.name);

            const prefs: {
              name: string;
              value: string;
              description: string;
            }[] = [
              {
                name: `${partner.id}:${newConfigId}:displayLabel`,
                value: displayLabel,
                description: `Display label for ${partner.name}`,
              },
              {
                name: `${partner.id}:${newConfigId}:description`,
                value: description,
                description: `Description for ${partner.name}`,
              },
            ];

            if (existingCount === 0) {
              setDefaultConfig(partner.id, newConfigId).catch(() => {});
            }

            savePreferences(
              prefs,
              partner.app_definition,
              partner.app_definition_key,
            ).catch(() => {});
          })
          .catch(() => {})
          .finally(() => {
            onRefreshRef.current();
          });
      }

      messageHandlerRef.current = messageHandler;
      window.addEventListener('message', messageHandler);
    },
    [],
  );

  return { handleAdd };
}
