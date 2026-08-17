import { describe, it, expect } from 'vitest';
import {
  asEnvelope,
  contentBlocksToText,
  asSaveReceipt,
  fallbackReceiptText,
  receiptMessage,
  extractAgentAction,
  extractTextContent,
  parseAgentOutput,
  type SaveReceipt,
} from './envelope';

const receipt: SaveReceipt = {
  kind: 'save_receipt',
  operation: 'create',
  artifact_type: 'file_format',
  name: 'acme_positions',
  id: 'ff-1',
  label: 'Acme Positions',
  message: 'Created file format **Acme Positions**.',
};

describe('envelope', { tags: ['agent-chat', 'logic'] }, () => {
  describe('asEnvelope', { tags: ['agent-chat', 'logic'] }, () => {
    it('passes an object through', { tags: ['smoke'] }, () => {
      const obj = { result: 'hi' };
      expect(asEnvelope(obj)).toBe(obj);
    });

    it('parses a JSON-encoded object string', { tags: ['important'] }, () => {
      expect(asEnvelope('{"result":"hi"}')).toEqual({ result: 'hi' });
    });

    it('returns null for non-objects and unparseable strings', { tags: ['edge-case'] }, () => {
      expect(asEnvelope(null)).toBeNull();
      expect(asEnvelope(undefined)).toBeNull();
      expect(asEnvelope(42)).toBeNull();
      expect(asEnvelope('not json at all')).toBeNull();
    });

    it('returns null for JSON scalars', { tags: ['edge-case'] }, () => {
      expect(asEnvelope('"just a string"')).toBeNull();
      expect(asEnvelope('123')).toBeNull();
      expect(asEnvelope('null')).toBeNull();
    });
  });

  describe('contentBlocksToText', { tags: ['agent-chat', 'logic'] }, () => {
    it('joins text blocks', { tags: ['smoke'] }, () => {
      expect(
        contentBlocksToText([
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ]),
      ).toBe('Hello world');
    });

    it('ignores non-text blocks', { tags: ['edge-case'] }, () => {
      expect(
        contentBlocksToText([
          { type: 'tool_use', name: 'x' },
          { type: 'text', text: 'kept' },
        ]),
      ).toBe('kept');
    });

    it('returns null for non-arrays', { tags: ['edge-case'] }, () => {
      expect(contentBlocksToText('text')).toBeNull();
      expect(contentBlocksToText({ type: 'text', text: 'x' })).toBeNull();
      expect(contentBlocksToText(null)).toBeNull();
    });

    it('returns null when no text block contributes anything', { tags: ['edge-case'] }, () => {
      expect(contentBlocksToText([])).toBeNull();
      expect(contentBlocksToText([{ type: 'tool_use' }])).toBeNull();
    });
  });

  describe('asSaveReceipt', { tags: ['agent-chat', 'logic'] }, () => {
    it('extracts a receipt nested under result', { tags: ['important'] }, () => {
      expect(asSaveReceipt({ result: receipt })).toEqual(receipt);
    });

    it('accepts a bare receipt', { tags: ['logic'] }, () => {
      expect(asSaveReceipt(receipt)).toEqual(receipt);
    });

    it('accepts a JSON-encoded receipt', { tags: ['logic'] }, () => {
      expect(asSaveReceipt(JSON.stringify({ result: receipt }))).toEqual(receipt);
    });

    it('returns null for non-receipts', { tags: ['edge-case'] }, () => {
      expect(asSaveReceipt({ result: 'plain answer' })).toBeNull();
      expect(asSaveReceipt({ result: { kind: 'something_else' } })).toBeNull();
      expect(asSaveReceipt(null)).toBeNull();
    });
  });

  describe('fallbackReceiptText', { tags: ['agent-chat', 'logic'] }, () => {
    it('uses Created / Updated per operation', { tags: ['important'] }, () => {
      expect(fallbackReceiptText({ kind: 'save_receipt', operation: 'create', name: 'x' })).toBe(
        'Created x.',
      );
      expect(fallbackReceiptText({ kind: 'save_receipt', operation: 'update', name: 'x' })).toBe(
        'Updated x.',
      );
    });

    it('humanizes artifact_type as the noun', { tags: ['logic'] }, () => {
      expect(
        fallbackReceiptText({
          kind: 'save_receipt',
          operation: 'create',
          artifact_type: 'file_format',
          name: 'acme',
        }),
      ).toBe('Created file format acme.');
    });

    it('prefers label over name', { tags: ['logic'] }, () => {
      expect(
        fallbackReceiptText({
          kind: 'save_receipt',
          operation: 'create',
          name: 'acme_positions',
          label: 'Acme Positions',
        }),
      ).toBe('Created Acme Positions.');
    });

    it('degrades to "item." with neither label nor name', { tags: ['edge-case'] }, () => {
      expect(fallbackReceiptText({ kind: 'save_receipt', operation: 'update' })).toBe(
        'Updated item.',
      );
      expect(
        fallbackReceiptText({
          kind: 'save_receipt',
          operation: 'create',
          artifact_type: 'pipeline',
        }),
      ).toBe('Created pipeline item.');
    });
  });

  describe('receiptMessage', { tags: ['agent-chat', 'logic'] }, () => {
    it('prefers the self-describing message', { tags: ['important'] }, () => {
      expect(receiptMessage(receipt)).toBe('Created file format **Acme Positions**.');
    });

    it('falls back when message is absent', { tags: ['edge-case'] }, () => {
      const noMessage: SaveReceipt = { ...receipt };
      delete noMessage.message;
      expect(receiptMessage(noMessage)).toBe('Created file format Acme Positions.');
    });

    it('falls back when message is an empty string', { tags: ['edge-case'] }, () => {
      expect(receiptMessage({ ...receipt, message: '' })).toBe(
        'Created file format Acme Positions.',
      );
    });
  });

  describe('extractAgentAction', { tags: ['agent-chat', 'logic'] }, () => {
    it('maps a receipt to an AgentAction', { tags: ['important'] }, () => {
      const raw = { result: receipt };
      expect(extractAgentAction(raw)).toEqual({
        operation: 'create',
        id: 'ff-1',
        name: 'acme_positions',
        label: 'Acme Positions',
        artifactType: 'file_format',
        raw,
      });
      expect(extractAgentAction(raw)?.raw).toBe(raw);
    });

    it('returns null when envelope.error is set', { tags: ['edge-case'] }, () => {
      expect(extractAgentAction({ error: 'boom', result: receipt })).toBeNull();
    });

    it('returns null when operation or id is missing', { tags: ['edge-case'] }, () => {
      expect(extractAgentAction({ result: { ...receipt, operation: undefined } })).toBeNull();
      expect(extractAgentAction({ result: { ...receipt, id: undefined } })).toBeNull();
    });

    it('returns null for a plain answer', { tags: ['edge-case'] }, () => {
      expect(extractAgentAction({ result: 'plain answer' })).toBeNull();
      expect(extractAgentAction('hello')).toBeNull();
    });
  });

  describe('extractTextContent', { tags: ['agent-chat', 'logic'] }, () => {
    it('prefers content blocks', { tags: ['important'] }, () => {
      expect(extractTextContent([{ type: 'text', text: 'from blocks' }])).toBe('from blocks');
    });

    it('unwraps { result: string }', { tags: ['logic'] }, () => {
      expect(extractTextContent({ result: 'the answer' })).toBe('the answer');
    });

    it('unwraps { error: string }', { tags: ['logic'] }, () => {
      expect(extractTextContent({ error: 'went wrong' })).toBe('went wrong');
    });

    it('passes plain text through', { tags: ['smoke'] }, () => {
      expect(extractTextContent('just text')).toBe('just text');
    });

    it('unwraps a JSON-encoded envelope string', { tags: ['logic'] }, () => {
      expect(extractTextContent('{"result":"the answer"}')).toBe('the answer');
      expect(extractTextContent('{"error":"went wrong"}')).toBe('went wrong');
    });

    it('falls back to String() for null/undefined/number', { tags: ['edge-case'] }, () => {
      expect(extractTextContent(null)).toBe('');
      expect(extractTextContent(undefined)).toBe('');
      expect(extractTextContent(42)).toBe('42');
    });
  });

  describe('parseAgentOutput', { tags: ['agent-chat', 'logic'] }, () => {
    it('renders a receipt via its message', { tags: ['important'] }, () => {
      expect(parseAgentOutput({ result: receipt })).toBe(
        'Created file format **Acme Positions**.',
      );
    });

    it('renders the fallback for a receipt with no message', { tags: ['logic'] }, () => {
      const noMessage: SaveReceipt = { ...receipt };
      delete noMessage.message;
      expect(parseAgentOutput({ result: noMessage })).toBe(
        'Created file format Acme Positions.',
      );
    });

    it('falls through to text for a non-receipt', { tags: ['logic'] }, () => {
      expect(parseAgentOutput({ result: 'plain answer' })).toBe('plain answer');
      expect(parseAgentOutput('hello')).toBe('hello');
    });
  });
});
