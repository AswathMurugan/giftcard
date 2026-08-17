/**
 * Agent metadata — built at RUNTIME from a skill, not hardcoded.
 *
 * The wire envelope is GENERIC: `agent_name` is the only agent-specific field
 * and it equals the skill's `name`. So ONE factory covers every skill the tenant
 * has — adding an agent needs no code at all.
 *
 * Pure (no React, no transport) so it's testable in the node vitest env.
 */

import { SKILLS_BY_NAME, type SkillEntry } from '@/types/skills.generated';
import { getAppConfig } from '@/config/api-config';
import { parseAgentOutput } from './utils/envelope';
import type { MessageExtras, MessageExtrasContext } from './hooks/agent-chat-reducer';

/**
 * Context every invocation carries.
 *
 * NOTE `appName`/`appDefinition` here are the CURRENT app's — a FALLBACK only.
 * The envelope sends the SKILL's own app (see `buildAgentMetadata`): an agent
 * lives in, and is routed at, the app that defines it — usually NOT the app
 * hosting the chat (`doc-extraction-agent` lives in `exxondocviewer`,
 * `Agent-Builder` in `platform`). Sending the host app's context makes the
 * backend resolve the wrong app.
 */
export interface AgentRequestContext {
  appName: string;
  appDefinition: string;
  tenant: string;
  userId: string;
  /**
   * Deployment env ('sandbox' | 'prod' | 'develop' …). Goes on the wire as
   * `env` — the backend scopes the session record by it, so an omitted value
   * means the turn runs but the session is never registered against the agent.
   */
  env: string;
}

export interface BuildPayloadArgs {
  text: string;
  requestId: string;
  sessionId: string;
  context: AgentRequestContext;
  /** Drive file ids, when the page enables attachments. */
  attachments?: { id: string; filename: string }[];
  /** First turn of a brand-new conversation. */
  newSession?: boolean;
  /** Extra `inputs` fields a page injects (e.g. edit-mode context). */
  extra?: Record<string, unknown>;
}

/**
 * Context passed to `getExtraInputs` so a page can decide WHAT to add and WHEN.
 * The extra fields it returns are merged into the invoke payload's `inputs`.
 */
export interface ExtraInputsContext {
  /** The user's message text for this turn. */
  text: string;
  /** Drive file ids attached to this turn (empty when none). */
  attachments: { id: string; filename: string }[];
  /** True on the first turn of a brand-new conversation. */
  isNewSession: boolean;
}

/** Design knobs a page may override. Everything defaults from the skill. */
export interface AgentChatDesign {
  title?: string;
  description?: string;
  iconName?: string;
  inputPlaceholder?: string;
  welcome?: { title?: string; subtitle?: string; examples?: string[] };

  /**
   * OVERRIDE how an agent's reply is turned into the text shown in the bubble.
   * Each agent's `done.output` shape can differ (a plain string, a
   * `{ response, record }` wrapper, …); the default handles the common shapes.
   * Supply this only for an agent whose shape the default doesn't cover, and
   * LAYER it — call the passed `defaultParse` for anything you don't handle:
   *
   *   parseResponse={(raw, defaultParse) =>
   *     (raw as any)?.output?.response ?? defaultParse(raw)}
   *
   * Returns the display string. This shapes only what's SHOWN — the raw
   * response is unaffected, and the transport is untouched.
   */
  parseResponse?: (raw: unknown, defaultParse: (raw: unknown) => string) => string;

  /**
   * OVERRIDE to read the chips + action buttons THIS agent attaches to a turn
   * off its raw `done.output` — the sibling of `parseResponse`, so a per-agent
   * output shape never lands in the transport:
   *
   *   parseExtras={(raw) => ({
   *     chips: (raw as any)?.record?.missing_fields,
   *     actions: (raw as any)?.record?.actions,
   *   })}
   *
   * Chips render as read-only pills under the reply, actions as buttons (see
   * `AgentChat.onMessageAction`). Omit it and a turn renders text only.
   */
  parseExtras?: (raw: unknown, ctx: MessageExtrasContext) => MessageExtras;

  /**
   * OVERRIDE to add extra fields to the invoke payload's `inputs` per turn —
   * e.g. a `schema` on the first message, an id when a file is attached. What's
   * added and when is entirely up to the callback (see {@link ExtraInputsContext}):
   *
   *   getExtraInputs={(ctx) => (ctx.isNewSession ? { schema } : {})}
   *
   * The returned object is merged OVER the default `inputs`, so the default
   * message/role/etc. stay intact. Payload-only: these fields ride the wire but
   * never appear in the chat bubble. The socket/channel/envelope are untouched.
   */
  getExtraInputs?: (ctx: ExtraInputsContext) => Record<string, unknown>;
}

export interface AgentWelcome {
  title: string;
  subtitle: string;
  examples: string[];
}

export interface AgentMetadata {
  /** The skill name — becomes `agent_name` on the wire and in the channel path. */
  agentId: string;
  /**
   * The app that DEFINES this agent (`SkillEntry.appKey`). This is what the
   * invocation + session registration must carry, NOT the host app. Empty for a
   * skill absent from the registry; callers then fall back to the current app.
   */
  appKey: string;
  /** The defining app's `app_definition` (e.g. `exxondocviewer__V0_0_1`). */
  appDefinition: string;
  displayTitle: string;
  description: string;
  iconName: string;
  inputPlaceholder: string;
  welcome: AgentWelcome;
  buildPayload: (args: BuildPayloadArgs) => Record<string, unknown>;
  parseResponse: (raw: unknown) => string;
  parseExtras?: (raw: unknown, ctx: MessageExtrasContext) => MessageExtras;
}

const DEFAULT_ICON = 'icon_-Tb_sparkles';

export const WELCOME_GREETING = 'Hello! What can I help you with today?';
const INPUT_PLACEHOLDER = 'Ask JIFFYAI';

/**
 * Resolve a skill name against the codegen'd registry.
 *
 * Falls back to a synthetic entry rather than failing: the registry is baked at
 * cold-boot, so a skill created since the last codegen (or an empty `never`
 * stub) must still work — the wire only needs the name.
 */
export function resolveSkill(input: string | SkillEntry): SkillEntry {
  if (typeof input !== 'string') return input;
  const known = SKILLS_BY_NAME[input];
  if (known) return known;
  return {
    appKey: '',
    appDefinition: '',
    name: input,
    label: input,
    description: '',
    subType: '',
    tags: [],
  };
}

/**
 * The generic invocation envelope. Identical for every skill — this is what
 * makes per-agent definitions unnecessary.
 *
 *   top level: agent_name, session_id, tenant, user_id, app_name,
 *              app_definition, request_id, new_session?
 *   inputs:    message, role: 'user', optional_data, file_ids?
 */
export function defaultBuildPayload({
  text,
  requestId,
  sessionId,
  context,
  attachments = [],
  newSession = false,
  extra,
}: BuildPayloadArgs): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    message: text,
    role: 'user',
    optional_data: `Current date and time: ${new Date().toISOString()}`,
    ...extra,
  };
  if (attachments.length > 0) {
    inputs.file_ids = attachments.map((a) => ({ id: a.id, filename: a.filename }));
  }

  const payload: Record<string, unknown> = {
    session_id: sessionId,
    inputs,
    request_id: requestId,
    // `env` is required — every platform agent sends it, and the backend scopes
    // the session record by it. Omitting it lets the turn run but leaves the
    // session unregistered against the agent.
    env: context.env,
    app_name: context.appName,
    app_definition: context.appDefinition,
    tenant: context.tenant,
    user_id: context.userId,
  };
  if (newSession) payload.new_session = true;
  return payload;
}

/**
 * Scope for the session REST calls (list / load / rename / delete).
 *
 * Resolves to the AGENT's own app — the same app the invoke payload sends —
 * because sessions are stored against the app that DEFINES the agent. Scoping
 * by the host app queries the wrong bucket: an empty list, and rename/delete
 * that can't resolve the session.
 *
 * Falls back to the caller's context for a skill absent from the registry
 * (a synthetic entry has empty app fields), matching `buildAgentMetadata`.
 */
export function buildSessionScope(
  metadata: Pick<AgentMetadata, 'appKey' | 'appDefinition'>,
  context: AgentRequestContext,
): { appName: string; appDefinition: string; userId: string } {
  return {
    appName: metadata.appKey || context.appName,
    appDefinition: metadata.appDefinition || context.appDefinition,
    userId: context.userId,
  };
}

/** Build metadata for a skill, applying any page-supplied design overrides. */
export function buildAgentMetadata(
  input: string | SkillEntry,
  overrides: AgentChatDesign = {},
): AgentMetadata {
  const skill = resolveSkill(input);
  const title = overrides.title ?? skill.label ?? skill.name;
  const description = overrides.description ?? skill.description ?? '';

  // Every agentframework path — the invoke payload, `initSession`, and the
  // session REST scope — reads the two fields below, so setting them here
  // routes all of them consistently.
  //
  // We send the CURRENT (host) app, not the app that defines the skill. The
  // agent is addressed by `agent_name`; the app fields scope the SESSION, which
  // belongs to the app the user is chatting from. Sending the skill's own app
  // instead splits sessions across apps and scopes the history REST calls to a
  // bucket the current app can't read back.
  const hostApp = getAppConfig();
  const appKey = hostApp.appName;
  const appDefinition = hostApp.appDefinition;

  return {
    agentId: skill.name,
    appKey,
    appDefinition,
    displayTitle: title,
    description,
    iconName: overrides.iconName ?? DEFAULT_ICON,
    inputPlaceholder: overrides.inputPlaceholder ?? INPUT_PLACEHOLDER,
    welcome: {
      title: overrides.welcome?.title ?? WELCOME_GREETING,
      subtitle: overrides.welcome?.subtitle ?? '',
      examples: overrides.welcome?.examples ?? [],
    },
    buildPayload: (args) => {
      // Fold any page-supplied extra `inputs` in through the same `extra`
      // channel the default already merges (defaultBuildPayload → inputs).
      // The page's fields win over both the caller's `extra` and the defaults.
      const pageExtra = overrides.getExtraInputs?.({
        text: args.text,
        attachments: args.attachments ?? [],
        isNewSession: args.newSession ?? false,
      });
      const base = defaultBuildPayload(
        pageExtra ? { ...args, extra: { ...args.extra, ...pageExtra } } : args,
      );
      return {
        ...base,
        agent_name: skill.name,
        // Host app — see the note above `hostApp`. The `|| base.*` keeps a
        // value on the wire if app config hasn't resolved yet.
        app_name: appKey || base.app_name,
        app_definition: appDefinition || base.app_definition,
      };
    },
    // Layer a page override over the default: it receives the raw output plus
    // `parseAgentOutput` so it can delegate anything it doesn't special-case.
    parseResponse: overrides.parseResponse
      ? (raw) => overrides.parseResponse!(raw, parseAgentOutput)
      : parseAgentOutput,
    // No default: an agent that sends no extras renders exactly as before.
    parseExtras: overrides.parseExtras,
  };
}
