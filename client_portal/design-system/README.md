# JiffyAI Design System

> Design system extracted from the **Tenants.fig** Figma file. JiffyAI is an AI-assisted
> platform for building and managing multi-tenant applications — primarily targeted at
> financial services (wealth management, onboarding, account servicing, data processing).

## Sources

- **Figma file**: `Tenants.fig` (attached to this project as a mounted VFS at `/Page-1/`)
- **Primary frames**: `App-Dashboard` (base + 79 variants), `Preferences`, `Tenant-Mgmt`,
  `Agent-*` flows, `Urban-Gold` / `Evergreen-Estate` / `Urban-Rose` theme variants,
  `Add-Partner-*`, `Authenticators`, `Problems-List`, `NewUI-*`.
- No codebase was attached. All design tokens were reverse-engineered from the .fig JSX
  pseudocode + METADATA.md usage counts.

## Product context

JiffyAI is a **low-code / AI app builder for regulated financial services**. From the
frames it's clear the platform lets a firm:

1. Create and configure **tenants** (clients — e.g. wealth managers, brokerages).
2. Spin up prebuilt **apps** per tenant: Account Onboarding, Account Servicing,
   Configuration Management, Data Processing, Workstation, Consumer Account Creation.
3. Choose **themes** per tenant (Urban Gold, Evergreen Estate, Urban Rose, etc.).
4. Wire in **Partners** — Salesforce, Redtail, Schwab, Hidden Levers, MoneyGuide.
5. Manage **Agents** and **Companions** — AI workflows embedded in the UI.
6. Configure **Preferences** per environment (Dev / QA / UAT / Prod).

The key product surface is the **App Dashboard** — a left-nav workspace with a
persistent dark header, an app-gallery body, and a bottom-docked **JIFFY search
bar** ("Search or ask JIFFY — type @ to use suggestions") that is the system's
AI entry point.

## Content fundamentals

### Voice & tone
- **Direct, operational, businesslike.** The audience is analysts and RIAs, not
  consumers. Copy is crisp, sentence-case, no exclamation points, no slang.
- **"You" (2nd person) is used for greetings and actions.** ("Let's get started,
  Alton.", "Here are all the apps you have either subscribed to…", "What would
  you like to do next?")
- **"Your" for possessive context.** ("Your Applications", "Creating Your App")
- **AI/agent framing** is warm but not cutesy. No emoji. The companion is called
  "JIFFY" in all caps inside prompts, "Jiffy" or "JiffyAI" in prose.
- **Progress language** is gerund + present: "Analyzing your inputs",
  "Designing an optimized layout", "Assembling components and logic",
  "Preparing screens".

### Casing
- Page titles: **Sentence case** ("My Workspace", "Your Applications",
  "Book of Business Summary").
- Section titles in tables: **Title Case** ("Tenant Admins", "Partners",
  "Announcements", "Service Requests").
- Buttons: **Title Case** ("Create App", "Add Preference", "Clear Filters").
- Labels / form fields: **Sentence case**.
- Badges/pills: **Title Case** ("Live", "Dev", "QA", "UAT", "Production").

### Copy patterns
- App cards use a bold **title** + one-sentence **description** ending in a period.
  Descriptions lead with a sensory adjective pair: "Effortless, secure
  onboarding…", "Fast, secure, and hassle-free account servicing…",
  "Powerful data processing — seamlessly transforming…".
- No emoji anywhere. No ALL CAPS SHOUTING. No ironic/playful microcopy.
- Numbers are compact ($120M, $8.5M, 3.2%, 120, 10) — never spelled out.
- The AI prompt always uses the same placeholder:
  **"Search or ask JIFFY (type @ to use suggestions)"**.

## Visual foundations

### Color — Phoenix Palette
The official color system is the **Phoenix Color Palette**: 10 families × 11
stops (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950). **500 is the
default** in every family. All tokens live in `colors_and_type.css` as
`--jf-<family>-<stop>` variables. Prefer the semantic aliases
(`--jf-primary-500`, `--jf-fg-1`, `--jf-line`, etc.) in components.

**Families:**
- **Primary · Gold** — `50 #F9F4E1` → `500 #9E7B19` (default) → `950 #2B2004`.
  Primary CTAs, active nav, brand wordmark accent.
- **Secondary · Grayscale** — `50 #FAFAFA` → `900 #1C1C1C` → `950 #000000`.
  Surfaces, borders, ink. Header/nav uses `gray-900`.
- **Success · Green** — default `#005928`. "Live" badges, confirmations.
- **Warning · Amber** — default `#D96A2B`. Warnings, at-risk states.
- **Danger · Red** — default `#8B1200`. Errors, destructive actions.
- **Info · Blue** — default `#075985`. Info toasts, links.
- **Teal, Purple, Pink, Tan** — extended palette for data viz, category tags,
  tenant theming. Same 50–950 structure.

**Semantic aliases:** `--jf-bg`, `--jf-surface`, `--jf-surface-muted`,
`--jf-surface-alt`, `--jf-line`, `--jf-line-strong`, `--jf-ink` (gray-900),
`--jf-fg-1` (gray-800), `--jf-fg-2` (gray-600), `--jf-fg-3` (gray-500),
`--jf-fg-4` (gray-400), `--jf-fg-inverse`.

Legacy `--jf-gold-*` / `--jf-green-*` aliases still resolve to the Phoenix
primary/success families for backwards compatibility with the existing UI kit —
prefer `--jf-primary-*` / `--jf-success-*` in new work.

Theme variants (per tenant — Urban Gold, Evergreen Estate, Urban Rose) shift
the HEADER hue by swapping the primary family; the content area stays neutral.

### Type
- **Single family**: **Source Sans 3** is the one and only JiffyAI brand font.
  It is used for everything — page titles, nav, buttons, badges, body copy,
  form inputs, stats, small print. No display/body pairing.
- **Weights in use**: 300 (light small print), 400 (body), 500 (field labels),
  600 (emphasis, buttons, small headings), 700 (titles, stats), 800 (hero titles).
- **Sizes in use** (Figma spec, px): 12, 13, 14, 15, 16, 17, 18, 21, 24, 28.
  Implemented as `rem` tokens (`text-*` in `index.css`) at a 16px base so text
  scales with the user's font preference — e.g. 15px → `0.9375rem`,
  18px → `1.125rem`. No fluid scale.
- **Headings** are Source Sans 3 Bold (700). Stats numbers are Source Sans 3
  SemiBold 28px. Page titles run 21–24px. Body default is 15–16px.
- The font is **bundled locally** under `fonts/` (full weight range 200–900 +
  italics as TTFs); the Google Fonts link is kept as a fallback.

### Layout, spacing, borders
- **4pt grid**. Most gaps are 8 / 12 / 16 / 24px. Section padding 24px.
- **Corner radii**: 6px (inputs), 8px (buttons, default cards), 12px (content
  cards, app tiles), 999px (pills, badges, the JIFFY search bar at the bottom).
- **Borders** are 1px solid `#E9E9EA` on cards, `#C9CACD` on form controls.
  Active/focus adds the gold `#9E7B19` at 1–2px.
- **Shadows**: very soft — `0 1px 2px rgba(0,0,0,0.04)` on default cards,
  `0 4px 12px rgba(0,0,0,0.08)` on popovers, `0 8px 24px rgba(0,0,0,0.25)`
  on modals. No large blurred gradients, no neon glows.
- **Dividers** are hairlines; cards tend to rely on border + shadow-xs rather
  than heavy elevation.

### Backgrounds & imagery
- Pages are flat white / off-white. **No gradients** behind content.
- Occasional **full-width dark band** (the header) and one cream band (step
  wizard sidebar).
- Real **partner logos** are used as-is (Salesforce, Schwab, Redtail…). No
  decorative SVG illustrations.
- Theme previews render as miniature screenshots, not abstract shapes.
- An inline **video player placeholder** sits in the left nav (`Y.ai` play
  tile) — a tutorial affordance.

### Motion & states
- Motion is minimal and utilitarian. Transitions are short (100–150ms) ease-in-out.
  Used for: button hover color, dropdown open, modal fade.
- Hover on cards: subtle shadow bump, no lift/scale.
- Hover on buttons: shade change (primary gold → slightly lighter gold).
- Press: tiny 0.5px translate-y, no scale.
- Active nav: solid gold pill background with black icon/label; the inactive
  nav item is transparent with dark ink.
- Focus: 2px gold-300 outline inset.
- No bouncy easings, no hero animations, no page transitions.

### Corner cases
- **Transparency / blur**: almost never. Modals use solid overlays at ~25% black.
- **Iconography**: Tabler Icons, 1.5–2px stroke, 18–24px. Always outline
  (never filled) except for `tb_alert-circle-filled` and `tb_circle-check-filled`
  used for state.
- **Data density**: moderately dense — tables are multi-column with
  cream-tinted header row (`#F9F4E1`).
- **Cards**: white, 12px radius, 1px border, xs shadow. Never use a colored
  left-border accent.
- **Protection gradients**: not used. Information is containerized with borders.

## Iconography

- **System**: [Tabler Icons](https://tabler.io/icons) — outline style, 1.5–2px stroke.
  Used everywhere (`Tb_*` prefix on 40+ icon components in the Figma source). We load
  Tabler via the CDN (`@tabler/icons-webfont` or `@tabler/icons-react`).
- **Brand logo**: the JiffyAI wordmark + "sparkle orbit" glyph (see `assets/`).
  Dark-background variant has gold "AI", light-background variant uses solid ink.
  Reconstructed as a clean SVG; swap in official artwork when available.
- **App icons** in the app gallery are abstract crest shapes (purple square,
  JF monogram) — tenant-configurable.
- **Emoji**: never used.
- **Unicode chars as icons**: never.
- **PNG icons**: partner logos (Salesforce, Schwab, Redtail, Hidden Levers,
  MoneyGuide) — use the vendor's own mark when rendering partners. Not bundled
  here; swap in real PNGs per tenant.

## Files in this folder

| Path | What |
|---|---|
| `DESIGN.md` | **The build contract** — the actionable, shadcn/Tailwind-accurate rules the agent follows (tokens as Tailwind classes, components, layout, do/don'ts). Read this for any UI work. |
| `README.md` | This file — Figma-source context, voice & tone, visual fundamentals. |
| `usecase/` | **Canonical on-brand usage samples**, one `.tsx` per component, built with the real repo components. Read the matching sample before building a component (see DESIGN.md §0). Reference only — not routed or bundled. |
| `assets/` | Brand logos (`jiffyai-logo-{dark,light}.svg`) + marks (`jiffyai-mark{,-dark}.svg`). |

> The concrete design **tokens** live in `src/index.css` (Tailwind v4 `@theme`),
> not a separate CSS file — reach them through Tailwind utilities
> (`bg-primary`, `bg-teal-500`, `shadow-xs`, …). The `--jf-*` variable names
> referenced below describe the Figma extraction; in this codebase the
> equivalent tokens are the `--color-*` / shadcn names in `src/index.css`.

## Caveats & substitutions

- **Source Sans 3** is the single JiffyAI brand font, bundled locally from
  `fonts/` (brand-provided TTFs, full weight range 200–900 + italics). The
  Google Fonts link is retained as a fallback.
- **Icons** use the Tabler CDN instead of bundled SVGs. If you need the system
  to work offline, run `npm i @tabler/icons` and vendor them locally.
- **Partner logos** are stylized text placeholders; swap the real vendor marks
  in when shipping.
- **JiffyAI logo** is an SVG reconstruction. Request the official lockup from
  brand before production use.
