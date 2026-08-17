/**
 * Parsing of the agent response envelope — pure, node-testable.
 *
 * Backend agents return either a structured envelope `{ result, error, … }` or
 * a JSON-encoded string of the same. These helpers normalize both and produce
 * user-facing text.
 *
 * The save receipt is an agent-AGNOSTIC contract (every save/update tool emits
 * the same shape), so one parser serves every skill — no per-agent code.
 */

/** Structured result an agent emits on `done` when it saved something. */
export interface AgentAction {
  /** 'create' | 'update' | … — verbatim from the receipt. */
  operation: string;
  id: string;
  /** Machine name of the saved artifact. */
  name?: string;
  /** Human label, when the agent supplies one. */
  label?: string;
  /** Stable noun, e.g. 'file-format' | 'pipeline'. */
  artifactType?: string;
  /** The full envelope, for anything this interface doesn't model. */
  raw: unknown;
}

/**
 * Self-describing save receipt: `{ result: { kind: 'save_receipt', operation,
 * artifact_type?, name, id, label, message? } }`. `message` is ready-to-render
 * markdown; older receipts omit it — hence `fallbackReceiptText`.
 */
export interface SaveReceipt {
  kind: 'save_receipt';
  operation?: string;
  artifact_type?: string;
  name?: string;
  id?: string;
  label?: string;
  message?: string;
}

/** Coerce an object, or a JSON-encoded string of one, into a plain object. */
export function asEnvelope(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON
    }
  }
  return null;
}

/**
 * Unwrap a Bedrock-style content-block array — `[{ type: 'text', text }]` —
 * into plain text. The streaming path returns `done.data.output` in this shape
 * instead of a string; without this it stringifies to "[object Object]".
 */
export function contentBlocksToText(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const text = raw
    .map((block) =>
      block &&
      typeof block === 'object' &&
      (block as Record<string, unknown>).type === 'text'
        ? String((block as Record<string, unknown>).text ?? '')
        : '',
    )
    .join('');
  return text || null;
}

/**
 * Extract a save receipt from a live `done.output` or a persisted history entry
 * — an envelope (`{ result }`), a bare receipt, or a JSON string of either.
 */
export function asSaveReceipt(raw: unknown): SaveReceipt | null {
  const envelope = asEnvelope(raw);
  if (!envelope) return null;
  const candidate: unknown = envelope.result ?? envelope;
  if (!candidate || typeof candidate !== 'object') return null;
  if ((candidate as { kind?: unknown }).kind !== 'save_receipt') return null;
  return candidate as SaveReceipt;
}

/** Generic receipt text for receipts carrying no `message`. */
export function fallbackReceiptText(receipt: SaveReceipt): string {
  const verb = receipt.operation === 'update' ? 'Updated' : 'Created';
  const noun = receipt.artifact_type ? `${receipt.artifact_type.replace(/_/g, ' ')} ` : '';
  const name = receipt.label || receipt.name;
  return name ? `${verb} ${noun}${name}.` : `${verb} ${noun}item.`;
}

/**
 * Ready-to-render text for a save receipt: its own self-describing `message`
 * when present, else the generic fallback. One rule for every agent, on both
 * the live `done` path and reopened history.
 */
export function receiptMessage(receipt: SaveReceipt): string {
  return typeof receipt.message === 'string' && receipt.message
    ? receipt.message
    : fallbackReceiptText(receipt);
}

/**
 * Map a `done` payload to an {@link AgentAction} the page can react to.
 *
 * Returns null when there's nothing actionable: no envelope, `envelope.error`
 * set, no receipt, or a receipt missing `operation`/`id` (e.g. a clarifying
 * question whose `result` is a plain string).
 */
export function extractAgentAction(raw: unknown): AgentAction | null {
  const envelope = asEnvelope(raw);
  if (!envelope || envelope.error) return null;

  const receipt = asSaveReceipt(raw);
  if (!receipt) return null;

  const { operation, id } = receipt;
  if (!operation || !id) return null;

  return {
    operation,
    id,
    name: receipt.name,
    label: receipt.label,
    artifactType: receipt.artifact_type,
    raw,
  };
}

/**
 * User-facing text for a NON-receipt response — Q&A answers, streamed content
 * blocks, `{ result: string }` envelopes, or error strings.
 */
export function extractTextContent(raw: unknown): string {
  const blocks = contentBlocksToText(raw);
  if (blocks !== null) return blocks;

  if (typeof raw === 'string') {
    const envelope = asEnvelope(raw);
    if (!envelope) return raw;
    if (typeof envelope.result === 'string') return envelope.result;
    if (typeof envelope.error === 'string') return envelope.error;
    return raw;
  }

  const envelope = asEnvelope(raw);
  if (envelope) {
    if (typeof envelope.result === 'string') return envelope.result;
    if (typeof envelope.error === 'string') return envelope.error;
  }
  return String(raw ?? '');
}

/**
 * The single parse rule for a `done` payload: a receipt renders its own
 * message, anything else falls through to text extraction. Keeps the live
 * bubble and reopened history identical.
 */
export function parseAgentOutput(raw: unknown): string {
  const receipt = asSaveReceipt(raw);
  return receipt ? receiptMessage(receipt) : extractTextContent(raw);
}
