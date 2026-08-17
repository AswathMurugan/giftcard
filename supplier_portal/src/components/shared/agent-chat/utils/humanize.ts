/**
 * Humanize helpers for agent `status` events — pure, node-testable.
 *
 * Backend agents emit raw step names like `model_start` and tool names like
 * `lookup-file-formats`. These maps turn them into user-facing labels; without
 * this the status line reads like backend internals.
 */

const TOOL_LABELS: Record<string, string> = {
  // File-format / file-spec tools
  'drive-download': 'Downloading file',
  file_info: 'Inspecting file',
  read_pdf_pages: 'Reading PDF',
  read_file: 'Reading file',
  extract_table: 'Extracting table',
  convert_to_text: 'Converting to text',
  search_file: 'Searching file',
  'lookup-file-formats': 'Looking up existing formats',
  'generate-record-type-columns': 'Generating columns',
  'assemble-file-format-definition': 'Assembling definition',
  // Pipeline tools
  'list-apps': 'Listing apps',
  'list-file-formats': 'Listing file formats',
  'list-pipelines': 'Listing pipelines',
  'get-pipeline': 'Loading pipeline',
  'create-pipeline': 'Creating pipeline',
  'update-pipeline': 'Updating pipeline',
  // Generic deepagent tools
  task: 'Running subagent',
  write_todos: 'Planning',
};

const STEP_LABELS: Record<string, string> = {
  model_start: 'Generating response',
  model_end: 'Processing response',
  llm_start: 'Generating response',
  llm_end: 'Processing response',
  agent_start: 'Starting agent',
  // Periodic liveness heartbeat emitted while streaming a long model turn, so
  // the status line shows real progress instead of "Thinking…" for minutes.
  generating: 'Still generating…',
};

const THINKING_LABEL = 'Thinking';

function titleCase(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Label for a tool name, falling back to a title-cased version of the slug. */
export function humanizeTool(name: string | undefined): string {
  if (!name) return THINKING_LABEL;
  return TOOL_LABELS[name] ?? titleCase(name);
}

/** Label for a `status` event's step/detail pair. */
export function humanizeStep(
  step: string | undefined,
  detail: string | undefined,
): string {
  if (step && STEP_LABELS[step]) return STEP_LABELS[step];
  if (detail) {
    // Strip middleware-style prefixes (e.g. PatchToolCallsMiddleware.before_agent).
    const trimmed = detail.includes('.') ? (detail.split('.').pop() ?? detail) : detail;
    if (/^[a-z_]+$/i.test(trimmed)) return titleCase(trimmed);
    return trimmed;
  }
  return THINKING_LABEL;
}

export interface ProgressTodo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ActiveTool {
  /** Internal id for stable list tracking. */
  id: string;
  /** Tool name as emitted by the backend (e.g. 'lookup-file-formats'). */
  name: string;
  /** Optional tool context (e.g. a filename). */
  ctx?: string;
}

/**
 * Aggregate the active-tools list into one status label. Groups by tool name,
 * appending contexts inline ("Reading file: foo.csv") and counts
 * ("Reading PDF (×3)") when several invocations share a name.
 */
export function aggregateActiveTools(tools: ActiveTool[]): string {
  if (tools.length === 0) return '';
  const groups = new Map<string, { count: number; ctxs: string[] }>();
  for (const t of tools) {
    const g = groups.get(t.name) ?? { count: 0, ctxs: [] };
    g.count += 1;
    if (t.ctx) g.ctxs.push(t.ctx);
    groups.set(t.name, g);
  }
  const parts: string[] = [];
  for (const [name, g] of groups.entries()) {
    const label = humanizeTool(name);
    if (g.ctxs.length > 0) parts.push(`${label}: ${g.ctxs.join(', ')}`);
    else if (g.count > 1) parts.push(`${label} (×${g.count})`);
    else parts.push(label);
  }
  return parts.join(' · ');
}
