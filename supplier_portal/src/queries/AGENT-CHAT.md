# Agent chat — add a platform skill's chat to a page

Mount a **full chat with one of the platform's agents** (a "skill"): AppSync
WebSocket, streaming, live tool progress, chat history — in **one line**:

```tsx
import { AgentChat } from '@/components/shared/agent-chat';

<AgentChat skill="ETL-File-Format-Skill" />
```

**Read this whole file before wiring an agent.** The selection flow below is
mandatory: never wire an agent the user hasn't confirmed.

---

## 1. The flow (find → confirm → build) — DO NOT SKIP

When the user asks to add / wire / embed an agent (whether or not they name it):

1. **Find the available skills.** Read `src/types/catalogs/skills.catalog.md`
   (names + labels + descriptions, grouped by app). The same set is typed data in
   `src/types/skills.generated.ts` (`SKILLS`, `SkillName`, `SKILLS_BY_NAME`).

2. **If the user NAMED a skill and you find it** → **ask for confirmation and
   WAIT**:

   > "Is this the agent you meant? **Document Extraction Agent**
   > (`doc-extraction-agent`) — Reads an operating-procedure PDF and transcribes
   > it into the structured procedure_document contract."

3. **If the user named one you CAN'T find, or named none** → **list what's
   available and ask them to pick, then WAIT**. Show label + a one-line
   description, grouped by app. Never fuzzy-match silently onto a
   similar-sounding skill.

4. **Once the skill is confirmed, ask about welcome suggestions — BEFORE writing
   the page.** A separate follow-up question: propose 2–3 concrete prompts and
   **WAIT** (see §4b). Both answers are needed to write the page ONCE; asking
   after wiring forces a second edit of a file you just wrote.

5. **Also ask about file uploads — BEFORE writing the page.** One question:
   "Should this chat let users attach files?" and **WAIT** (see §5). On "yes",
   wire `accept` + `onUpload` with the default Drive settings.

6. **Only after ALL answers** → generate the page with
   `<AgentChat skill="<name>" welcome={{ examples }} … />` (omit `welcome`
   and/or the upload props for anything the user declined) and register the
   route.

> **Never auto-wire an agent without confirmation.** A wrong agent looks
> plausible and fails only at runtime, on the user's screen. Confirming costs one
> turn; guessing costs a debugging session. Same propose → confirm → act rule as
> `ENTITY.md` / `SAVED-QUERY.md`.

**If the catalog is empty**, the tenant's skills haven't been fetched yet (the
codegen runs at workspace cold-boot). Say so — don't invent a skill name.

---

## 2. The four things to get right

1. **`skill` takes the skill's `name`** — NOT its `label` or `appKey`.
   ✅ `skill="ETL-File-Format-Skill"`  ❌ `skill="ETL File Format Skill"`
   The `name` goes on the wire as `agent_name`; a label silently talks to a
   channel nobody answers, and the turn just hangs.

2. **Concurrent consumers are isolated.** Every `<AgentChat>` and
   `useAgentTask` hook owns its WebSocket, session subscription, handlers, and
   reconnect lifecycle. Multiple consumers may safely share a page; each event
   is routed by its transport-stamped agent/session channel, and unmounting one
   does not disconnect another.

3. **Don't rebuild it.** No hand-rolled WebSocket, message list, or agent
   envelope in page code. For a docked/side-panel layout pass `variant="inline"`
   — the component fills its parent.

4. **React to results with `onAction` / `onDone`** — never by parsing the message
   stream yourself.

> **An agent runs in ITS OWN app, not yours.** `<AgentChat>` sends the skill's
> `appKey`/`appDefinition` from the registry — NOT the app hosting the page.
> `doc-extraction-agent` lives in `exxondocviewer__V0_0_1`, `Agent-Builder` in
> `platform__V1_0_324`. This is automatic; you don't pass an app. It's called out
> because it's surprising, and sending the wrong one makes the backend resolve
> the wrong app.

---

## 3. Props

| Prop | Default | Notes |
|---|---|---|
| `skill` | — | **Required.** The skill `name`. |
| `title` | skill's label | Header title + FAB label. |
| `description` | skill's description | Welcome subtitle. |
| `iconName` | `icon_-Tb_sparkles` | A Nucleo glyph class (see `ICONS.md`). |
| `inputPlaceholder` | `Ask JIFFYAI` | |
| `welcome` | derived | `{ title?, subtitle?, examples? }`. `title` defaults to *"Hello! What can I help you with today?"*; `examples` render as clickable starter cards, omitted entirely when empty. **Confirm them with the user first — see §4b.** |
| `variant` | `'floating'` | `'floating'` = FAB + popover; `'inline'` = fills the parent. |
| `placement` | `'bottom-right'` | Floating only — which corner the FAB/popover sits in. |
| `defaultOpen` | `false` | |
| `sessionKey` | — | Keep the SAME conversation across navigation — see §3e. |
| `sessionId` | — | Continue a page-owned session; wins over `sessionKey`. See §3e. |
| `onSessionChange` | — | Receives the live session id so the page can persist it. |
| `resendInitialMessage` | `false` | Explicitly send the opening turn again when restored context changed. |
| `initialMessage` | — | Opening turn sent once per session when ready — the user lands on a started conversation. See §3d. |
| `hideInitialMessage` | `false` | Send `initialMessage` on the wire with **no bubble** (also re-hidden when the session is reopened). |
| `initialMessageReady` | `true` | Hold the opening turn until the page's own context has landed (data fetched, document uploaded). |
| `hotkey` | `true` | Cmd/Ctrl+J toggles, Esc closes. |
| `showToolSteps` | `true` | Show each answer's "Generated N steps" disclosure. Off for end-user-facing chats. |
| `accept` + `onUpload` | — | Enable the paperclip (both required). Off by default — **ask the user first, then wire with Drive defaults; see §5.** |
| `appearance` | app theme | Per-instance colours + icons — see §3b. |
| `parseResponse` | built-in parser | Override how THIS agent's reply becomes bubble text — see §3c. |
| `parseExtras` | — | Read the chips + action buttons THIS agent attaches to a turn — see §3d. |
| `onMessageAction` | sends the choice | An action button was clicked — see §3d. |
| `getExtraInputs` | — | Add extra fields to the payload `inputs` per turn — see §3c. |
| `onAction` | — | The agent saved something — see below. |
| `onDone` | — | `(text, raw)` of every completed turn — display text plus the RAW `done.output`. |

---

## 3b. Theming a chat (`appearance`)

By default the chat inherits the app's own design tokens — a global theme change
re-skins it automatically, and **that is the preferred route**. Use `appearance`
only when ONE chat needs to differ from the app.

```tsx
<AgentChat
  skill="<SkillName>"
  appearance={{
    colors: { accent: '#0F766E' },        // one colour themes every accented part
    icons: { launcher: 'icon_-Tb_robot' } // Nucleo classes — see ICONS.md
  }}
/>
```

**Colours** (all optional): `accent`, `onAccent`, `accentSoft`, `accentBorder`,
`surface`, `surfaceMuted`, `border`, `text`, `textMuted`. Setting `accent` alone
is valid — it fans across the whole accent ramp so the FAB, send button, active
dock item, suggestion pills, spinners and attachment icon-box all move together.
Omitted keys keep the app's token, so a partial appearance is fine.

**Icons** (all optional, Nucleo glyph classes): `launcher`, `newChat`, `history`,
`close`, `attach`, `send`, `file`. Look classes up in
`src/assets/fonts/nucleo/ICONS.md` — **never guess; a wrong class renders blank
with no error.**

Applied as CSS-variable overrides scoped to this chat's root, so the rest of the
app is untouched and two chats on one page can differ.

> **Structure is deliberately NOT themeable** — no layout, spacing, radius or
> type-scale props. The chat should stay recognisably the same component
> wherever it appears. If a design needs more than colours and icons, raise it
> rather than working around this.

---

## 3c. Per-agent overrides — response parsing & payload extras

`<AgentChat>` ships with a **default** response parser and a **default** AppSync
payload — every chat gets them for free, and the connection/transport is fixed
starter code you never touch. The two props below are **overrides**, added only
when a *specific* agent needs them. Add them on the user's request (the same
edit-on-request flow as `appearance`), not speculatively.

### `parseResponse` — when an agent's output shape isn't a plain string

Each agent's `done.output` can differ. The default handles the common shapes (a
string, `{ result }`, content blocks). When an agent wraps its text — e.g.
`{ response, record }` — the bubble would show `[object Object]`. Override it,
and **layer on the default** by calling the passed `defaultParse`:

```tsx
<AgentChat
  skill="onboarding-form-fill-agent-drive"
  parseResponse={(raw, defaultParse) =>
    (raw as { response?: string })?.response ?? defaultParse(raw)}
/>
```

Return the string to display. This shapes only what's *shown* — the full raw
response still reaches `onAction`, so a field like `record` stays available for a
backend reaction.

### `getExtraInputs` — when a payload needs an extra field, conditionally

Adds fields to the invoke payload's `inputs` per turn. What to add and *when* is
up to the callback (`ctx` carries `text`, `attachments`, `isNewSession`):

```tsx
<AgentChat
  skill="X"
  getExtraInputs={(ctx) => (ctx.isNewSession ? { schema } : {})}
/>
```

The returned object is merged **over** the default `inputs`, so `message`/`role`/
etc. stay intact. These fields ride the wire but **never appear in the chat
bubble** (the bubble renders the typed text, not the payload). The socket,
channel, and envelope framing are untouched — the override only shapes the
payload object.

> **These are the only logic overrides for the WIRE.** Everything else about it —
> connecting, subscribing, the channel path, reconnect, the envelope structure —
> is starter-owned and not editable, because it's the same for every agent.

---

## 3d. Rich turns — chips, action buttons, and an opening message

A turn can carry more than prose: **chips** (read-only pills naming what the
agent is talking about) and **actions** (buttons offering the next step). Both
are optional and default-off — a chat that sets neither renders exactly as before.

```tsx
import { AgentChat, type MessageAction } from '@/components/shared/agent-chat';

// Describe THIS agent's output shape in the page — never `any` (lint bans it).
interface FormFillOutput {
  record?: { missing_fields?: string[]; actions?: MessageAction[] };
}

<AgentChat
  skill="onboarding-form-fill-agent-drive"
  // The agent's own output shape stays in the PAGE, like parseResponse:
  parseExtras={(raw) => ({
    chips: (raw as FormFillOutput).record?.missing_fields,     // → pills
    actions: (raw as FormFillOutput).record?.actions,          // → buttons
  })}
  onMessageAction={(action, api) => {
    if (action.id === 'open_wizard') navigate('/wizard');   // handled locally
    else api.send(action.send ?? action.label);             // back to the agent
  }}
  // Start the conversation without making the user type — and without a bubble:
  initialMessage="hi"
  hideInitialMessage
  initialMessageReady={contextLoaded}
/>
```

`MessageAction` is `{ id, label, send? }`. Omit `onMessageAction` and a click
sends `send ?? label` as the next turn.

`parseExtras` gets a second argument, `ctx`, whose `ctx.isFirstReply` is true
only on the OPENING answer — take it when the page wants to decorate that one
turn (chips it already knows, say) without repeating them every turn. Leave it
off the signature when you don't use it.

Chips clamp to **3 rows**; a longer set collapses behind a `+N` chevron that
expands and collapses in place, so a long gap list can't push the conversation
off screen.

---

## 3e. Session continuity — `sessionKey`

The chat unsubscribes when it unmounts (a route change sends
`{"type":"unsubscribe"}`), and a fresh mount mints a NEW session id. Without a
key, navigating away and back means: the thread is gone, an in-flight turn's
reply is lost, and an `initialMessage` fires a SECOND time (another agent call).

```tsx
<AgentChat skill="…" sessionKey={`onboarding-summary:${ids.join(',')}`} />
```

With a key the session id is remembered for the tab (`sessionStorage`) and the
next mount re-adopts it and reloads its history. The opening turn is skipped when
the thread already has messages **or** when a per-session sent marker proves it
was published but backend history has not checkpointed it yet. The marker is
written immediately before publish and is keyed by the actual live session id,
not `sessionKey`, so a genuinely new session still gets its own opening turn.
Use ONE key per flow **plus its context** — two different batches must not share
a conversation. If tab storage is blocked, in-memory copies of the session id
and marker still protect route remounts in the current page load, but cannot
survive a full reload.

**Own the id yourself for real continuity.** A tab's memory dies with the tab.
When the conversation belongs to a RECORD (a case, a draft, an application),
store the id on that record and hand it back:

```tsx
<AgentChat
  sessionId={draft.agentSessionId}                  // wins over sessionKey
  onSessionChange={(id) => saveToDraft(id)}         // persist it
  resendInitialMessage={dataChangedSinceLastTurn}   // context moved on → talk again
/>
```

`sessionId` must be known at MOUNT (gate the chat on your record being loaded).
`resendInitialMessage` is the escape hatch from "a restored thread is left
alone": pass it when the page can prove its context changed (e.g. a fingerprint
of the data you send no longer matches the one you stored with the last turn),
and the opening turn goes out again with the new data. This explicit override
bypasses both restored history and the per-session sent marker.

**The opening turn is a real turn** — same payload, same `getExtraInputs`
(`isNewSession` is true for it), same session record. `hideInitialMessage` only
controls rendering: the bubble is skipped live AND when the session is reopened
(`mapSessionMessages` re-hides a leading user turn matching the text). It fires
once per session, only when `sessionStatus === 'ready'` and `initialMessageReady`
is true — so gate it on your data rather than sending against an empty context.

---

## 3f. No chat at all — `useAgentTask`

Sometimes the agent is a **feature of a screen**, not a conversation: "read this
uploaded ID and fill the form". Mounting `<AgentChat>` there puts a panel and a
launcher on a screen that never needed them.

```tsx
import { useAgentTask } from '@/components/shared/agent-chat';

const extract = useAgentTask('onboarding-form-fill-agent-drive');

const onDocumentUploaded = async (file: { id: string; filename: string }) => {
  const { raw } = await extract.run('Extract the client details.', {
    attachments: [file],           // Drive ids — the agent reads BY id
    extra: { schema },             // same `inputs` channel as getExtraInputs
  });
  applyToForm(parseMyAgentOutput(raw));
};

<Button disabled={extract.isRunning}>{extract.isRunning ? 'Reading…' : 'Continue'}</Button>
```

One turn, headless: same transport, envelope and session semantics, no UI. `run`
resolves with `{ raw, text }` (raw = the agent's `done.output`, so a page parses
its own shape), rejects on transport error, on a 3-minute timeout, or if the
component unmounts — an awaited promise always settles. Calls made before the
socket is ready are queued, so there is nothing to poll. One run at a time per
hook; a second `run` while one is in flight rejects. The hook is lazy: it opens
no socket until the first `run`, then keeps that isolated session available for
later runs until unmount.

It is safe to use a visible chat and one or more task runners together:

```tsx
const extract = useAgentTask('doc-extraction-agent');

return <AgentChat skill="support-agent" />;
```

Each consumer has a different session channel. A task's `done` can settle only
that task, and unmounting the chat cannot tear down the task's connection (or
vice versa) — at the cost of one WebSocket each, so mount only the runners a
screen actually uses (see §8).

**Which one?** The user is meant to talk to it → `<AgentChat>`. The user uploads
something and the page does the rest → `useAgentTask`.

---

## 4. Reacting to what the agent did

On a save, agents return a **save receipt**. `onAction` hands it to you already
parsed — the same shape for every agent, so there's no per-agent code:

```tsx
const qc = useQueryClient();

<AgentChat
  skill="ETL-File-Format-Skill"
  onAction={(a) => {
    // a: { operation, id, name?, label?, artifactType?, raw }
    if (a.operation === 'create' || a.operation === 'update') {
      qc.invalidateQueries({ queryKey: ['file-formats'] });
    }
  }}
/>
```

The agent saves server-side and returns a receipt; the page reacts by
**refetching or navigating**. Never patch a definition client-side from a chat
response. `onDone(output)` is the escape hatch when you just want the text.

---

## 4b. Welcome suggestions — propose, confirm, then add

The welcome screen can show 2–3 clickable starter prompts ("Things you could
ask"). They are **not** returned by the skills API — there is no field to derive
them from — so they must be authored and confirmed with the user.

**Ask this AFTER the skill is confirmed but BEFORE writing the page** (§1
step 4) — as a separate follow-up question, not bundled into the skill
confirmation. Both answers land before any file is written, so the page is
generated once with its prompts already in place:

> "Want starter prompts on the welcome screen? Here's what I'd suggest for
> **SQL Data Pipeline Companion**:
> 1. Create a pipeline that merges Schwab raw security records into the canonical security entity
> 2. Write a pipeline that truncates the staging table then inserts deduped rows from the raw feed
> 3. Build a pipeline that updates account balances based on the latest position file
>
> Use these, give me your own, or say skip."

Then **WAIT**. Three outcomes:

| User says | Do |
|---|---|
| Accepts | Add them via `welcome={{ examples: [...] }}` |
| Gives their own | Use theirs verbatim — don't "improve" the wording |
| Skips | Omit `welcome` entirely; the block doesn't render |

**Derive the suggestions from the skill's own `description`** in
`skills.catalog.md`. That is the only per-skill source available, and it works
for tenant-specific skills as well as platform ones.

### Make them concrete — this is the whole point

A suggestion must be a **complete prompt the user could send verbatim**. Vague
ones take up space and teach nothing:

| ✅ Good | ❌ Bad |
|---|---|
| "Write a pipeline that truncates the staging table then inserts deduped rows from the raw feed" | "Ask me about pipelines" |
| "Add a date_of_birth field to the customer entity" | "Help with entities" |
| "Create a fixed-width file spec for bank statements" | "Get started" |

Name real operations, real entities, real artifacts. If the skill's description
is too thin to write three concrete prompts, propose fewer — two good ones beat
three filler ones.

```tsx
<AgentChat
  skill="SQL-Data-Pipeline-Skill"
  welcome={{
    examples: [
      'Create a pipeline that merges Schwab raw security records into the canonical security entity',
      'Write a pipeline that truncates the staging table then inserts deduped rows from the raw feed',
      'Build a pipeline that updates account balances based on the latest position file',
    ],
  }}
/>
```

`examples` is `string[]` — plain text, no icons. Clicking one sends it as the
user's message. Omit `welcome` (or pass an empty array) and the section is not
rendered at all.

---

## 5. Attachments — ask first, then wire with defaults

Attachments are **off by default**. When wiring an agent (after the skill and
welcome-suggestions questions), **ask one more question and WAIT:**

> "Should this chat let users attach files?"

- **No** → omit `accept`/`onUpload`; the paperclip never appears. Done.
- **Yes** → wire it with the **default Drive settings** below — no further
  questions needed.

### The default wiring (scope `APPS`)

```tsx
import { useDriveFiles } from '@/hooks';

const { upload } = useDriveFiles();

<AgentChat
  skill="<SkillName>"
  accept={['.csv', '.pdf', '.txt', '.xlsx', '.xls', '.json', '.tsv']}
  onUpload={async (file) => {
    // scope 'APPS' → the current app's Drive bucket; appName auto-fills,
    // classification defaults to INTERNAL. This covers most agents.
    const res = await upload(file, { scope: 'APPS' });
    return { id: res.file_id, filename: file.name };
  }}
/>
```

- **`accept`** — the 7-type core every file-accepting platform agent uses. It
  only filters the picker; don't ask about it. Add `.sql`/`.md` if the user
  specifically wants them.
- **`scope: 'APPS'`** is the default — the file lands in the current app's
  bucket. `appName` fills in automatically, `classification` defaults to
  `INTERNAL`. No `serviceName` needed.

### The one exception — warehouse agents

Two agents (ETL file-format, SQL data-pipeline) read/write **platform warehouse**
samples, not app files. If the user says their agent works with warehouse data,
swap the upload to:

```tsx
const res = await upload(file, { scope: 'PLATFORM', serviceName: 'warehouse' });
```

Everything else keeps the `APPS` default above. If unsure, `APPS` is the safe
choice — a wrong `scope` is a hard **400** at upload time, so only use
`PLATFORM` when the user confirms warehouse data.

> AppSync caps a published event at **240 KB**. Attachments travel as Drive
> **file ids**, not bytes, so this only matters if large context is ever inlined.

---

## 6. Full example

```tsx
import { AgentChat } from '@/components/shared/agent-chat';

export function OperationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Operations</h1>
      {/* …page content… */}
      <AgentChat skill="ETL-File-Format-Skill" />
    </div>
  );
}
```

Then one entry in `src/PrivateApp.tsx`:

```tsx
PrivateRoute({ path: '/operations', label: 'Operations', icon: 'icon_-Tb_settings', element: <OperationsPage /> }),
```

---

## 7. Window position (dock)

The header's position menu offers **Floating**, **Dock left**, and **Dock right**.
The choice persists in localStorage, so it sticks across opens.

Docked, the chat becomes a full-height side rail and the app root reserves width
for it (the component toggles a `chat-docked--left` / `--right` class on
`<body>`; the matching rules live in `src/index.css`), so page content sits
*beside* the panel rather than under it. Below `60rem` viewport width there
isn't room for both, so the panel overlays instead. The floating bubble hides
while docked — the panel's own close button takes over.

**A docked panel is drag-resizable.** Drag the handle on its inner edge to set a
width between **320px and 768px** (default 400px); the width persists in
localStorage alongside the dock mode. One CSS variable
(`--agent-chat-dock-width`) drives both the panel and the app-root reserve, so
they stay in lockstep mid-drag — the drag writes to that variable directly
rather than to React state, which keeps the message thread from re-rendering on
every pixel of movement.

This is automatic; there's no prop to set. `variant="inline"` has no dock menu,
since an inline chat is already positioned by its parent.

---

## 7b. Chat history

The header's clock icon swaps the message thread for the history view (a
side-nav swap, not a floating menu — the live thread keeps running underneath,
and the back arrow returns to it). It offers search, date grouping
(Today / Yesterday / Last 7 days / Older), and per-row rename + delete on hover.

Grouping is by **calendar day, not elapsed hours**, so a chat from 11pm
yesterday reads as "Yesterday" rather than "Today". That logic is pure and
tested in `utils/session-groups.ts`.

Automatic whenever the sessions API is reachable; there's no prop to set.

---

## 8. Known limits

- **No live streaming bubble.** The progress card (status + tool steps +
  completion) covers the turn; the final answer lands when it completes.
- **One WebSocket per mounted surface.** Every `<AgentChat>` and every
  `useAgentTask` owns its own transport — that isolation is what lets them
  coexist (§3f), but a screen with a chat plus two task hooks holds three
  AppSync connections. So: one chat per screen unless a second is genuinely
  a different agent the user talks to, and one `useAgentTask` per job rather
  than one per button. A floating chat costs nothing until first opened, and
  a task hook costs nothing until its first `run`.

Agent replies render as **markdown** (`react-markdown` + `remark-gfm`), so
tables, lists, code blocks, links and task lists all display properly — a wide
table scrolls horizontally inside the panel rather than wrapping into tall rows.
Styling lives in `markdown-body.css`. The USER's own text is shown verbatim, not
parsed, so a message containing `*` or `|` isn't mangled.

---

## 9. Local dev

Deployed sessions need **no configuration** — the WebSocket endpoint arrives on
the tenant auth config and the user's Cognito token authenticates it.

On **localhost only**, AppSync is authenticated with an API key, so set it in
`codegen-starter/.env`:

```
VITE_APPSYNC_API_KEY=da2-…
```

Without it the chat reports that it can't connect (by design). This never
affects a deployed app.
