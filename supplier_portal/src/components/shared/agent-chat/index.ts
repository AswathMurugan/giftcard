/**
 * Agent chat — a full AppSync-backed chat with a platform skill (agent) in one
 * line. Read `src/queries/AGENT-CHAT.md` before using it.
 *
 *   import { AgentChat } from '@/components/shared/agent-chat';
 *   <AgentChat skill="ETL-File-Format-Skill" />
 *
 * This barrel is the ONLY import surface — everything else here is internal.
 */
export { AgentChat } from './AgentChat';
export type { AgentChatProps } from './AgentChat';
/** Chips + action buttons a turn can carry (see AGENT-CHAT.md §3d). */
export type { MessageAction, MessageExtras, MessageExtrasContext } from './hooks/agent-chat-reducer';
/** Headless one-shot runs (no chat UI) — see AGENT-CHAT.md §3f. */
export { useAgentTask } from './hooks/use-agent-task';
export type {
  AgentTaskResult,
  AgentTaskRunOptions,
  UseAgentTaskResult,
} from './hooks/use-agent-task';
export type { PendingAttachment } from './AgentChatInput';
export type { AgentAction } from './utils/envelope';
export type { ExtraInputsContext } from './agent-metadata';
export type {
  AgentChatAppearance,
  AgentChatColors,
  AgentChatIcons,
} from './appearance';
