/**
 * Map a loaded checkpoint (REST) into the chat's display messages.
 *
 * A REOPENED session must read exactly like the live one, so this runs the same
 * page overrides the live `done` path runs: `parseResponse` (this agent's reply
 * shape) and `parseExtras` (its chips + action buttons). Without them a restored
 * thread showed a raw JSON block where the prose had been, and lost its pills
 * and buttons.
 */
import type { SessionMessage } from '@/services/session-api';
import type {
  ChatMessage,
  MessageExtras,
  MessageExtrasContext,
} from '@/components/shared/agent-chat/hooks/agent-chat-reducer';
import { asSaveReceipt, receiptMessage } from './envelope';

export interface MapSessionOptions {
  /**
   * A page's opening turn (`AgentChat.initialMessage` + `hideInitialMessage`):
   * the backend stored it like any other turn, so a reopened session would show
   * the bubble the live view deliberately hid. A FIRST user entry matching this
   * text is marked hidden again.
   */
  hiddenFirstMessage?: string;
  /** The agent's resolved reply parser (default + any page override). */
  parseResponse?: (raw: unknown) => string;
  /** The page's chips/actions reader — applied to structured entries only. */
  parseExtras?: (raw: unknown, ctx: MessageExtrasContext) => MessageExtras;
}

/**
 * Render a `dict` history entry. A save receipt becomes its ready-to-render
 * `message` — the same string the live `done` path shows — so a reopened
 * session isn't missing the assistant turn (save tools send no LLM text) and
 * doesn't leak raw JSON. Any other dict is fenced as JSON so its structured
 * payload stays visible.
 */
function renderDictContent(data: SessionMessage['data']): string {
  const receipt = asSaveReceipt(data);
  if (receipt) return receiptMessage(receipt);
  return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

/** Map a whole checkpoint history into display bubbles. */
export function mapSessionMessages(
  sessionId: string,
  loaded: SessionMessage[],
  options: MapSessionOptions = {},
): ChatMessage[] {
  const { hiddenFirstMessage, parseResponse, parseExtras } = options;
  const hiddenText = hiddenFirstMessage?.trim();
  let seenAssistant = false;

  return loaded.map((m, i) => {
    const role = m.role === 'ai' ? ('assistant' as const) : ('user' as const);
    const structured = m.type === 'dict';
    // The agent's own reply shape wins for structured entries, exactly as live;
    // a plain string entry is already display text.
    const content = structured
      ? (parseResponse?.(m.data) ?? renderDictContent(m.data))
      : String(m.data ?? '');

    const isFirstReply = role === 'assistant' && !seenAssistant;
    if (role === 'assistant') seenAssistant = true;

    const extras: MessageExtras = structured && role === 'assistant' && parseExtras
      ? (parseExtras(m.data, { isFirstReply }) ?? {})
      : {};

    return {
      id: `${sessionId}-${i}`,
      role,
      content,
      timestamp: i,
      chips: extras.chips?.length ? extras.chips : undefined,
      actions: extras.actions?.length ? extras.actions : undefined,
      hidden: i === 0 && role === 'user' && !!hiddenText && content.trim() === hiddenText
        ? true
        : undefined,
    };
  });
}
