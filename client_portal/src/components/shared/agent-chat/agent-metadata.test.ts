import { describe, it, expect, vi } from 'vitest';
import type { SkillEntry } from '@/types/skills.generated';
import { getAppConfig } from '@/config/api-config';
import {
  resolveSkill,
  defaultBuildPayload,
  buildAgentMetadata,
  WELCOME_GREETING,
  buildSessionScope,
  type AgentRequestContext,
  type BuildPayloadArgs,
} from './agent-metadata';

// Mock the module boundary (not a runtime spy). `buildAgentMetadata` reads the
// HOST app via getAppConfig(); unmocked it falls through to LOCAL_DEV_CONFIG,
// whose appName rotates PER WORKSPACE (e.g. 'jjtest2'), so a runtime spy on the
// namespace didn't reliably intercept the source's bound import. Mocking here
// keeps the real implementation by default (via importActual) and lets a single
// test override getAppConfig() — deterministic regardless of local-dev.ts.
vi.mock('@/config/api-config', async (importActual) => ({
  ...(await importActual<typeof import('@/config/api-config')>()),
  getAppConfig: vi.fn((await importActual<typeof import('@/config/api-config')>()).getAppConfig),
}));

const CONTEXT: AgentRequestContext = {
  appName: 'agenttest',
  appDefinition: 'agenttest__V0_0_1',
  tenant: 'acme',
  env: 'sandbox',
  userId: 'user-9',
};

const SKILL: SkillEntry = {
  appKey: 'exxondocviewer_x',
  appDefinition: 'exxondocviewer_x__V0_0_1',
  name: 'doc-extraction-agent',
  label: 'Doc Extraction Agent',
  description: 'Extracts fields from documents.',
  subType: 'agent',
  tags: [],
};

function args(overrides: Partial<BuildPayloadArgs> = {}): BuildPayloadArgs {
  return {
    text: 'hello',
    requestId: 'req-1',
    sessionId: 'sess-1',
    context: CONTEXT,
    ...overrides,
  };
}

describe('agent-metadata', { tags: ['agent-chat', 'logic'] }, () => {
  describe('resolveSkill', { tags: ['agent-chat', 'logic'] }, () => {
    it('passes a SkillEntry through unchanged', { tags: ['smoke'] }, () => {
      expect(resolveSkill(SKILL)).toBe(SKILL);
    });

    it('synthesizes an entry for an unknown name instead of throwing', { tags: ['edge-case'] }, () => {
      const s = resolveSkill('never-seen-agent');
      expect(s.name).toBe('never-seen-agent');
      expect(s.label).toBe('never-seen-agent');
      expect(s.description).toBe('');
      expect(s.appKey).toBe('');
      expect(s.appDefinition).toBe('');
    });
  });

  describe('defaultBuildPayload', { tags: ['agent-chat', 'logic'] }, () => {
    it('builds the generic envelope', { tags: ['important'] }, () => {
      const p = defaultBuildPayload(args());
      expect(p.session_id).toBe('sess-1');
      expect(p.request_id).toBe('req-1');
      expect(p.app_name).toBe('agenttest');
      expect(p.app_definition).toBe('agenttest__V0_0_1');
      expect(p.tenant).toBe('acme');
      expect(p.user_id).toBe('user-9');
    });

    it(
      'sends `env` — the backend scopes the session record by it, so dropping ' +
        'it lets the turn run but leaves the session unregistered',
      { tags: ['important'] },
      () => {
        expect(defaultBuildPayload(args()).env).toBe('sandbox');
      },
    );

    describe('buildSessionScope', { tags: ['important'] }, () => {
      it('mirrors the app fields the metadata carries', () => {
        // buildAgentMetadata now stamps the HOST app, so in practice these are
        // the host's. The scope's job is only to pass them through unchanged —
        // it must match whatever the invoke payload sent.
        const scope = buildSessionScope(
          { appKey: 'agenttest', appDefinition: 'agenttest__V0_0_1' },
          CONTEXT,
        );
        expect(scope.appName).toBe('agenttest');
        expect(scope.appDefinition).toBe('agenttest__V0_0_1');
        expect(scope.userId).toBe('user-9');
      });

      it(
        'matches the invoke payload — a mismatch queries the wrong bucket',
        { tags: ['important'] },
        () => {
          // The invariant that matters: whatever the REST scope sends, the
          // invoke payload must send the same app, or history reads a bucket
          // the sends never wrote to.
          const m = buildAgentMetadata(SKILL);
          const scope = buildSessionScope(m, CONTEXT);
          const payload = m.buildPayload(args());
          expect(scope.appName).toBe(payload.app_name);
          expect(scope.appDefinition).toBe(payload.app_definition);
        },
      );

      it('falls back to the caller context when metadata has no app', { tags: ['edge-case'] }, () => {
        const scope = buildSessionScope({ appKey: '', appDefinition: '' }, CONTEXT);
        expect(scope.appName).toBe('agenttest');
        expect(scope.appDefinition).toBe('agenttest__V0_0_1');
      });
    });

    it('sets inputs.message and role user', { tags: ['important'] }, () => {
      const inputs = defaultBuildPayload(args()).inputs as Record<string, unknown>;
      expect(inputs.message).toBe('hello');
      expect(inputs.role).toBe('user');
    });

    it('stamps an ISO date into optional_data', { tags: ['logic'] }, () => {
      const inputs = defaultBuildPayload(args()).inputs as Record<string, unknown>;
      expect(inputs.optional_data).toMatch(/^Current date and time: \d{4}-\d{2}-\d{2}T/);
    });

    it('omits new_session unless newSession is true', { tags: ['edge-case'] }, () => {
      expect(defaultBuildPayload(args())).not.toHaveProperty('new_session');
      expect(defaultBuildPayload(args({ newSession: true })).new_session).toBe(true);
    });

    it('omits file_ids when there are no attachments', { tags: ['edge-case'] }, () => {
      const inputs = defaultBuildPayload(args()).inputs as Record<string, unknown>;
      expect(inputs).not.toHaveProperty('file_ids');
      const empty = defaultBuildPayload(args({ attachments: [] })).inputs as Record<
        string,
        unknown
      >;
      expect(empty).not.toHaveProperty('file_ids');
    });

    it('maps attachments to id + filename', { tags: ['logic'] }, () => {
      const inputs = defaultBuildPayload(
        args({ attachments: [{ id: 'f1', filename: 'a.pdf' }] }),
      ).inputs as Record<string, unknown>;
      expect(inputs.file_ids).toEqual([{ id: 'f1', filename: 'a.pdf' }]);
    });

    it('merges extra into inputs without clobbering message/role', { tags: ['important'] }, () => {
      const inputs = defaultBuildPayload(
        args({ extra: { mode: 'edit', screen: 'clients' } }),
      ).inputs as Record<string, unknown>;
      expect(inputs.mode).toBe('edit');
      expect(inputs.screen).toBe('clients');
      expect(inputs.message).toBe('hello');
      expect(inputs.role).toBe('user');
    });
  });

  describe('buildAgentMetadata', { tags: ['agent-chat', 'logic'] }, () => {
    it('uses the skill name as agentId', { tags: ['important'] }, () => {
      expect(buildAgentMetadata(SKILL).agentId).toBe('doc-extraction-agent');
    });

    it('derives displayTitle and description from the skill', { tags: ['logic'] }, () => {
      const m = buildAgentMetadata(SKILL);
      expect(m.displayTitle).toBe('Doc Extraction Agent');
      expect(m.description).toBe('Extracts fields from documents.');
    });

    it(
      "stamps the HOST app, never the skill's own app — the session belongs to " +
        'the app the user is chatting from',
      { tags: ['important'] },
      () => {
        const m = buildAgentMetadata(SKILL);
        expect(m.appKey).not.toBe('exxondocviewer_x');
        expect(m.appDefinition).not.toBe('exxondocviewer_x__V0_0_1');
      },
    );

    it('defaults welcome + placeholder to the generic greeting, NOT the skill label', {
      tags: ['important'],
    }, () => {
      const m = buildAgentMetadata(SKILL);
      expect(WELCOME_GREETING).toBe('Hello! What can I help you with today?');
      expect(m.welcome.title).toBe(WELCOME_GREETING);
      expect(m.welcome.title).not.toBe(SKILL.label);
      expect(m.welcome.subtitle).toBe('');
      expect(m.welcome.examples).toEqual([]);
      expect(m.inputPlaceholder).toBe('Ask JIFFYAI');
    });

    it('uses the default icon', { tags: ['logic'] }, () => {
      expect(buildAgentMetadata(SKILL).iconName).toBe('icon_-Tb_sparkles');
    });

    it('lets overrides win', { tags: ['important'] }, () => {
      const m = buildAgentMetadata(SKILL, {
        title: 'My Agent',
        iconName: 'icon_-Tb_robot',
        inputPlaceholder: 'Ask anything',
        welcome: { title: 'Hi there', subtitle: 'sub', examples: ['do a thing'] },
      });
      expect(m.displayTitle).toBe('My Agent');
      expect(m.iconName).toBe('icon_-Tb_robot');
      expect(m.inputPlaceholder).toBe('Ask anything');
      expect(m.welcome).toEqual({
        title: 'Hi there',
        subtitle: 'sub',
        examples: ['do a thing'],
      });
    });

    it('stamps agent_name = skill name on the payload', { tags: ['important'] }, () => {
      expect(buildAgentMetadata(SKILL).buildPayload(args()).agent_name).toBe(
        'doc-extraction-agent',
      );
    });

    describe('parseResponse override', { tags: ['important'] }, () => {
      it('defaults to the built-in parser when no override is given', () => {
        // Bare string output → shown verbatim (the default behaviour).
        expect(buildAgentMetadata(SKILL).parseResponse('hello')).toBe('hello');
      });

      it('lets an override read an agent-specific field, layering on the default', () => {
        // The onboarding-shape case: output is { response, record }; show response.
        const m = buildAgentMetadata(SKILL, {
          parseResponse: (raw, def) =>
            (raw as { response?: string })?.response ?? def(raw),
        });
        expect(m.parseResponse({ response: 'Hi Josh', record: null })).toBe('Hi Josh');
      });

      it('falls through to the default for shapes the override does not handle', () => {
        const m = buildAgentMetadata(SKILL, {
          parseResponse: (raw, def) =>
            (raw as { response?: string })?.response ?? def(raw),
        });
        // No `response` key → the override delegates; default shows the string.
        expect(m.parseResponse('plain text')).toBe('plain text');
      });
    });

    describe('getExtraInputs override', { tags: ['important'] }, () => {
      it('adds nothing to inputs when no override is given', () => {
        const inputs = buildAgentMetadata(SKILL).buildPayload(args()).inputs as Record<
          string,
          unknown
        >;
        expect(inputs.schema).toBeUndefined();
      });

      it('merges returned fields into the payload inputs (schema on first message)', () => {
        const m = buildAgentMetadata(SKILL, {
          getExtraInputs: (ctx) => (ctx.isNewSession ? { schema: { a: 1 } } : {}),
        });
        const first = m.buildPayload(args({ newSession: true })).inputs as Record<
          string,
          unknown
        >;
        expect(first.schema).toEqual({ a: 1 });
        // The default inputs are intact — the override layers, not replaces.
        expect(first.message).toBeDefined();
        expect(first.role).toBe('user');
      });

      it('respects the condition — omitted on later turns', { tags: ['edge-case'] }, () => {
        const m = buildAgentMetadata(SKILL, {
          getExtraInputs: (ctx) => (ctx.isNewSession ? { schema: { a: 1 } } : {}),
        });
        const later = m.buildPayload(args({ newSession: false })).inputs as Record<
          string,
          unknown
        >;
        expect(later.schema).toBeUndefined();
      });

      it('the extra field rides inputs, NOT the top level (invisible to the bubble)', () => {
        const m = buildAgentMetadata(SKILL, {
          getExtraInputs: () => ({ schema: 'x' }),
        });
        const p = m.buildPayload(args());
        expect((p.inputs as Record<string, unknown>).schema).toBe('x');
        expect(p.schema).toBeUndefined(); // never a top-level payload key
      });
    });

    it(
      'sends the HOST app, not the skill app — sessions are scoped to the ' +
        'chatting app (regression)',
      { tags: ['important'] },
      () => {
        const p = buildAgentMetadata(SKILL).buildPayload(args());
        expect(p.app_name).not.toBe('exxondocviewer_x');
        expect(p.app_definition).not.toBe('exxondocviewer_x__V0_0_1');
        // The agent is still addressed by name — only the APP scope differs.
        expect(p.agent_name).toBe(SKILL.name);
        // context still supplies tenant + user
        expect(p.tenant).toBe('acme');
        expect(p.user_id).toBe('user-9');
      },
    );

    it(
      'keeps the context app on the wire when the host app config is unresolved',
      { tags: ['edge-case'] },
      () => {
        // buildAgentMetadata stamps the HOST app from getAppConfig(); when that
        // hasn't resolved yet (empty), the `|| base.*` guard keeps the caller
        // context's app on the wire. Force the empty state so the assertion is
        // workspace-independent — getAppConfig() otherwise falls back to
        // LOCAL_DEV_CONFIG.appName, which rotates per workspace (e.g. 'jjtest2').
        // mockReturnValueOnce so ONLY this call sees the empty config; every
        // later test keeps the real implementation the mock defaults to.
        vi.mocked(getAppConfig).mockReturnValueOnce({
          appName: '',
          appDefinition: '',
          appDefinitionKey: '',
          tenant: '',
          env: '',
          relatedApplications: [],
        } as ReturnType<typeof getAppConfig>);
        const p = buildAgentMetadata('unknown-agent').buildPayload(args());
        expect(p.app_name).toBe('agenttest');
        expect(p.app_definition).toBe('agenttest__V0_0_1');
        expect(p.agent_name).toBe('unknown-agent');
      },
    );

    it('parseResponse renders a save receipt', { tags: ['logic'] }, () => {
      const m = buildAgentMetadata(SKILL);
      expect(
        m.parseResponse({
          result: {
            kind: 'save_receipt',
            operation: 'update',
            artifact_type: 'file_format',
            label: 'Acme Positions',
            id: 'ff-1',
          },
        }),
      ).toBe('Updated file format Acme Positions.');
      expect(m.parseResponse({ result: 'plain answer' })).toBe('plain answer');
    });
  });
});
