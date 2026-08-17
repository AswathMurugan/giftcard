import { describe, it, expect } from 'vitest';
import {
  detectWriteOp,
  parseSavedQueryRef,
  extractPlaceholders,
  renderSavedQueryFile,
  type SavedQuery,
} from './fetch-saved-queries';

// The exact CTE insert saved query from the platform (PHX insert support).
const CTE_INSERT: SavedQuery = {
  name: 'insert_clients_cte',
  label: 'Insert Client (CTE)',
  description: '',
  type: 'common_table_expression',
  query:
    '[{"name":"do_insert","type":"dynamic","is_single_output":true,"query":{"client":{"insert":{"client_name":"$body.name","active":"$body. Active"}}}}]',
  attributes: [
    {
      name: 'body',
      type: 'object',
      attributeType: 'input',
      component_reference:
        'finplanbabutest_6a1b0db566bdca0e02566584.saved-queries.insert_clients_cte.bodyStructure',
    },
    {
      name: 'bodyStructure',
      type: 'object',
      attributeType: 'internal',
      attributes: [{ name: 'name', type: 'string', attributeType: 'internal' }],
    },
    {
      name: 'client',
      type: 'object',
      attributeType: 'output',
      component_reference:
        'finplanbabutest_6a1b0db566bdca0e02566584.saved-queries.insert_clients_cte.clientOutput',
    },
    {
      name: 'clientOutput',
      type: 'object',
      attributeType: 'internal',
      attributes: [
        { name: 'id', type: 'uuid', attributeType: 'internal' },
        { name: 'client_name', type: 'string', attributeType: 'internal' },
        { name: 'active', type: 'string', attributeType: 'internal' },
      ],
    },
  ],
  is_single_output: true,
  app_definition_key: 'finplanbabutest_6a1b0db566bdca0e02566584',
  target_app_definition_key: 'wealthdomain_69c65d7d64bd0f04506bab2b',
} as unknown as SavedQuery;

describe('fetch-saved-queries write support', { tags: ['saved-query', 'logic'] }, () => {
  describe('detectWriteOp', { tags: ['important'] }, () => {
    it('detects insert inside a CTE array body', { tags: ['smoke'] }, () => {
      expect(detectWriteOp(CTE_INSERT.query)).toBe('insert');
    });

    it('detects a write on the plain object (dynamic) form', () => {
      expect(detectWriteOp('{"client":{"update":{"x":"$y"}}}')).toBe('update');
      expect(detectWriteOp('{"client":{"delete":{}}}')).toBe('delete');
    });

    it('detects across multiple CTE sub-queries (first write wins)', () => {
      const q =
        '[{"name":"a","query":{"client":{"select":{"id":true}}}},' +
        '{"name":"b","query":{"client":{"insert":{"n":"$body.n"}}}}]';
      expect(detectWriteOp(q)).toBe('insert');
    });

    it('returns null for reads and malformed input', { tags: ['edge-case'] }, () => {
      expect(detectWriteOp('{"client":{"select":{"id":true}}}')).toBeNull();
      expect(detectWriteOp('[{"name":"a","query":{"client":{"select":{}}}}]')).toBeNull();
      expect(detectWriteOp(undefined)).toBeNull();
      expect(detectWriteOp('not json')).toBeNull();
    });
  });

  describe('parseSavedQueryRef', { tags: ['logic'] }, () => {
    it('resolves the plural `saved-queries` segment', { tags: ['important'] }, () => {
      expect(
        parseSavedQueryRef(
          'app_x.saved-queries.insert_clients_cte.bodyStructure',
          'insert_clients_cte',
        ),
      ).toBe('bodyStructure');
    });

    it('still resolves the singular `saved-query` segment', () => {
      expect(
        parseSavedQueryRef('app_x.saved-query.q.respStruct', 'q'),
      ).toBe('respStruct');
    });

    it('returns null when the query name does not match', { tags: ['edge-case'] }, () => {
      expect(
        parseSavedQueryRef('app_x.saved-queries.other.bodyStructure', 'q'),
      ).toBeNull();
      expect(parseSavedQueryRef(undefined, 'q')).toBeNull();
      expect(parseSavedQueryRef('app_x.entity.client', 'q')).toBeNull();
    });
  });

  describe('extractPlaceholders', { tags: ['logic'] }, () => {
    it('recovers $body.<field> placeholders as flat field names', () => {
      // `$body.name` → `name`. (`$body. Active` has a stray space after the
      // dot in this fixture, so it degrades to the `body` token — a data
      // quirk; clean `$body.active` would yield `active`.)
      expect(extractPlaceholders(CTE_INSERT.query).sort()).toEqual([
        'body',
        'name',
      ]);
    });

    it('strips the $body. prefix for a clean field placeholder', () => {
      expect(
        extractPlaceholders('{"client":{"insert":{"a":"$body.active"}}}'),
      ).toEqual(['active']);
    });
  });

  describe('renderSavedQueryFile (CTE insert)', { tags: ['important', 'smoke'] }, () => {
    const out = renderSavedQueryFile(CTE_INSERT, new Set(), new Set());

    it('types the input as FLAT fields from $body.<field> placeholders', () => {
      // `$body.name` → flat `name: string` (not a nested `{ body: {...} }`).
      // The `body` object attribute only signals the body TRANSPORT.
      expect(out.source).toMatch(/export interface InsertClientsCteInput \{/);
      expect(out.source).toMatch(/\bname:\s*string;/);
      expect(out.source).not.toMatch(/body:\s*\{/);
    });

    it('types the output from the client output attribute graph', () => {
      expect(out.source).toMatch(/client_name\??:\s*string/);
      expect(out.source).toMatch(/active\??:\s*string/);
      // Not the hard-coded `{ id: string }`-only fallback.
      expect(out.outputNames).toContain('client');
    });

    it('classifies it as an insert write', () => {
      expect(out.operation).toBe('insert');
    });

    it('emits a flat-body POST execute wrapper (not URL params)', () => {
      expect(out.source).toContain("apiManager.post('data'");
      // writes pass `input` as the body, not a params querystring.
      expect(out.source).not.toContain('new URLSearchParams()');
    });

    it('posts to /execute, not /execute/single (writes are not single-reads)', () => {
      expect(out.source).toContain('/saved-queries/insert_clients_cte/execute');
      expect(out.source).not.toContain('/execute/single');
    });
  });

  // Regression: a plain `dynamic` write with $body.* placeholders (no `body`
  // object attribute) MUST send a flat JSON body — not URL query params.
  // PHX update_client / insert_client were wrongly sent as ?id=…&client_name=…
  describe('plain dynamic write (update_client shape)', { tags: ['important', 'smoke'] }, () => {
    const UPDATE_CLIENT: SavedQuery = {
      name: 'update_client',
      label: 'Update Client',
      description: 'WRITE (update).',
      type: 'dynamic',
      query:
        '{"client":{"update":{"client_name":"$body.client_name","rating":"$body.rating"},"filter":"id == $body.id"}}',
      app_definition_key: 'wealthdomain_x',
    } as unknown as SavedQuery;

    const out = renderSavedQueryFile(UPDATE_CLIENT, new Set(), new Set());

    it('is detected as an update write', () => {
      expect(out.operation).toBe('update');
    });

    it('posts the input as a flat JSON body, never URL params', () => {
      expect(out.source).toContain(
        "apiManager.post('data', \"/saved-queries/update_client/execute\", input, headers)",
      );
      expect(out.source).not.toContain('new URLSearchParams()');
      expect(out.source).not.toContain('?${qs}');
    });

    it('types inputs flat from $body.<field> (id, client_name, rating)', () => {
      expect(out.source).toMatch(/\bid:\s*string;/);
      expect(out.source).toMatch(/\bclient_name:\s*string;/);
      expect(out.source).toMatch(/\brating:\s*string;/);
    });
  });

  // A single-output READ must POST to /execute (NOT /execute/single, which
  // 404s for some apps) and unwrap the first row.
  describe('single-output read (client_kpis shape)', { tags: ['important', 'smoke'] }, () => {
    const CLIENT_KPIS: SavedQuery = {
      name: 'client_kpis',
      label: 'Client KPIs',
      description: 'Single-output KPI read.',
      type: 'dynamic',
      query: '{"client":{"aggregate":{"count":{"id":"count"}}}}',
      is_single_output: true,
      app_definition_key: 'finplanbabutest_x',
    } as unknown as SavedQuery;

    const out = renderSavedQueryFile(CLIENT_KPIS, new Set(), new Set());

    it('posts to /execute, NOT /execute/single', () => {
      expect(out.source).toContain('/saved-queries/client_kpis/execute');
      expect(out.source).not.toContain('/execute/single');
    });

    it('unwraps the first row from a list-shaped response', () => {
      // The generated wrapper handles array / {data:[...]} / {<key>:[...]}.
      expect(out.source).toContain('Array.isArray(data)');
      expect(out.source).toMatch(/data\[0\]/);
    });

    it('still maps a 404 to null', () => {
      expect(out.source).toContain('if (status === 404) return null;');
    });
  });

  // Regression (cross-app entity import path): an output `object` attribute
  // whose component_reference is `{appKey}.entity.<name>` must import the
  // entity from its per-app folder via the `@/` alias — NOT a bare, wrong-depth
  // `../entities/<name>` (which resolved to a non-existent
  // `saved-queries/entities/<name>` and broke tsc after merge).
  describe('cross-app entity ref import path', { tags: ['important', 'smoke'] }, () => {
    const APEX_CLIENT_INFO: SavedQuery = {
      name: 'apex_get_client_info_by_id',
      label: 'Apex Get Client Info',
      description: 'Reads a wealthdomain client_member from a finplan-owned query.',
      type: 'dynamic',
      query: '{"client_member":{"select":{"id":true}}}',
      is_single_output: true,
      app_definition_key: 'finplanbabutest_6a1b0db566bdca0e02566584',
      target_app_definition_key: 'wealthdomain_69c65d7d64bd0f04506bab2b',
      attributes: [
        {
          name: 'member',
          type: 'object',
          attributeType: 'output',
          component_reference:
            'wealthdomain_69c65d7d64bd0f04506bab2b.entity.client_member',
        },
      ],
    } as unknown as SavedQuery;

    const out = renderSavedQueryFile(
      APEX_CLIENT_INFO,
      new Set(),
      new Set(['client_member']),
      new Map([
        ['client_member', new Set(['wealthdomain_69c65d7d64bd0f04506bab2b'])],
      ]),
    );

    it('imports the entity from its per-app folder via the @/ alias', () => {
      expect(out.source).toContain(
        "import type { ClientMember } from '@/types/entities/wealthdomain_69c65d7d64bd0f04506bab2b/client_member';",
      );
    });

    it('never emits the broken bare `../entities/<name>` path', { tags: ['edge-case'] }, () => {
      expect(out.source).not.toContain("from '../entities/client_member'");
    });
  });
});
