# Phoenix Design System

> **Category**: Wealth-tech operational software.
> Quiet luxury for advisors and analysts who live in the app all day.
> Phoenix Gold accent, near-black ink, soft neutrals, generous whitespace,
> data presented in tables and KPI tiles \u2014 not dashboards full of
> decorative chrome.

This document is the single source of truth for every visual decision in
generated pages. Before writing JSX, the agent reads it end-to-end and
matches each section to the request.

---

## 0. Visual reference — read the use-case sample first

`design-system/usecase/` holds one canonical, on-brand usage sample per
component, written with the real repo components (`@/components/ui/*`) +
Tailwind tokens + Nucleo icons — the same stack you author pages in. **Before
building a given component, open its sample below and match the look + usage
pattern.** The samples are reference only (not routed, not bundled).

Do NOT copy `--jf-*` tokens, `.jf-*` classes, or Tabler icons from any external
design-system bundle — those are foreign to this repo. The samples already
express everything in repo terms.

| When building… | Read this sample |
|---|---|
| Button | `usecase/button.tsx` |
| Badge / status / category tag | `usecase/badge.tsx` |
| Input / Select / Label (form field) | `usecase/input.tsx` |
| Card | `usecase/card.tsx` |
| Tabs | `usecase/tabs.tsx` |
| Checkbox / Radio / Switch | `usecase/controls.tsx` |
| DatePicker | `usecase/date-picker.tsx` |
| DataTable | `usecase/data-table.tsx` |
| Empty state | `usecase/empty-state.tsx` |

---

## 1. Visual theme & atmosphere

Phoenix is a working tool, not a marketing page. The screens an advisor
sees in the morning are the screens they're staring at in the evening,
so the surface stays calm: white canvas, dark ink, one warm gold accent
reserved for what the user is meant to do next. There is no second
accent, no hero gradient, no decorative shadow, no animated noise. If
something doesn't carry information or invite action, it doesn't render.

**Two operating modes in one system:**

- **Operational mode** \u2014 list pages, detail pages, dashboards. Dense.
  KPI tiles at the top, a `DataTable` below, a filter rail on the left.
  Everything inside an 8-pt grid, generous padding inside cards, tight
  padding between rows. The user is here to scan, sort, drill.
- **Form / wizard mode** \u2014 onboarding, editing, multi-step submission.
  Narrower max width, larger labels, more vertical breathing room. The
  user is here to make decisions.

**Stay-out list (a single one of these breaks the look):**

- Hero sections with full-bleed images.
- Neon / saturated brand colors beyond Phoenix Gold.
- Gradient text, gradient backgrounds, gradient buttons.
- Big drop shadows. Use elevation tokens sparingly; default is flat.
- Border-radius circus. The system uses one base radius and its scales.
- Emojis in product UI. Use an icon or nothing.
- Decorative animation. Transitions for state changes only.

---

## 2. Color palette & roles

All colors live in `src/index.css` as CSS variables and are reachable
through shadcn's Tailwind token classes (`bg-primary`, `text-foreground`,
etc.). **Never hard-code a hex value in JSX.** If you reach for a color
that isn't in the palette below, the design system is missing it \u2014
flag it instead of inventing one.

### Primary (Phoenix Gold)

The action color. Reserved for the single thing the user is meant to do
on the current screen (primary CTA, current step in a wizard, selected
row marker). Don't use it for decoration.

| Token | Hex (light) | Use |
|---|---|---|
| `--primary` | `#9E7B19` | Primary button fill, active states |
| `--primary-foreground` | `#FFFFFF` | Text on primary fill |
| `--primary-50` | `#F9F4E1` | Subtle selected-row tint, gold chip background |
| `--primary-200` | `#F1E2A9` | Hover / focus ring tint |
| `--primary-600` | `#8A6A15` | Primary button hover |
| `--primary-800` | `#5E460E` | Primary button active, gold text on light tints |

### Neutrals & text

Source of the calm canvas.

| Token | Hex (light) | Use |
|---|---|---|
| `--background` | `#FFFFFF` | Page background |
| `--foreground` | `#1C1C1C` | Body text, headings |
| `--card` | `#FFFFFF` | Card surface (same as background \u2014 use border, not elevation) |
| `--secondary` | `#F4F4F5` | Secondary button fill, subtle surface |
| `--muted` | `#F4F4F5` | Disabled / placeholder surface |
| `--muted-foreground` | `#73767C` | Secondary text, helper copy, table metadata |
| `--accent` | `#F9F4E1` | Hover background on nav items, soft highlight |
| `--accent-foreground` | `#1C1C1C` | Text on accent surface |
| `--border` | `#E4E4E7` | Card edges, table dividers, input borders |
| `--input` | `#D4D4D8` | Input field border (stronger than `--border`) |
| `--ring` | `#F1E2A9` | Focus ring (matches primary-200 in light mode) |

### Semantic — renderer-aligned colour ramps

PHX-3863 added the full Phoenix renderer ramps to `src/index.css`.
Use them when you need a status hue (info / success / warning / danger
/ grayscale) instead of inventing one. Each family has shades
`50/100/200/300/400/500/600/700/800` plus `DEFAULT/dark/darkmode/light/bg`
variants and is reachable through Tailwind utility classes:
`bg-info-100`, `text-success-700`, `border-danger-500`, etc.

| Family | Use |
|---|---|
| `info-*` (blue, `#075985`) | Informational chips, neutral status, "in progress". |
| `success-*` (green, `#005928`) | Completed / approved / healthy state. |
| `warning-*` (orange, `#D96A2B`) | Attention-needed / soft caution; reserve red for actual errors. |
| `danger-*` (red, `#8B1200`) | Errors, validation failures, destructive confirmations. |
| `grayscale-*` (cool neutrals) | Same scale as `secondary-*`; use whichever name reads more clearly in your component. |
| `monochrome-*` (utility) | Dividers (`line`), placeholder text (`placeholder`), input chrome (`input`), off-blacks/whites for overlays. |

The shadcn semantic tokens above (`--primary`, `--destructive`, etc.)
are unchanged — they map to the same hex values as the corresponding
ramp `*-500` shade.

`--destructive` ↔ `danger-500`. Use `--destructive` for shadcn primitives
(Alert, Button variants); use the `danger-*` ramp when you need a
specific shade.

### Extended families (data-viz, category tags, tenant theming)

Beyond the status families, four extended families are available as full
`50-950` ramps for **chart series, category tags, and tenant theming**.
Reach them through Tailwind utilities (`bg-teal-500`, `text-purple-700`,
`border-pink-300`, `bg-tan-100`). They are **not** action colors -- never
use one for a primary CTA (that stays Phoenix Gold).

| Family | Default (`-500`) | Use |
|---|---|---|
| `teal-*` | `#2C8F86` | Chart series, "active/healthy" category tags |
| `purple-*` | `#7357AE` | Chart series, category tags, agent/companion accents |
| `pink-*` | `#C54A78` | Chart series, category tags |
| `tan-*` | `#A47E45` | Chart series, warm neutral category tags |

Each core family (`primary`, `grayscale`, `success`, `warning`, `danger`,
`info`) now also has `-900` / `-950` stops for deep text/fills.

### Charts

The 5 recharts series tokens map to **Phoenix brand families** (no more
generic green). Use in order; never mix with arbitrary hex. Pass via the
token (`style={{ stroke: 'var(--chart-1)' }}`).

| Token | Family (light) | Hex |
|---|---|---|
| `--chart-1` | Gold (primary) | `#9E7B19` |
| `--chart-2` | Teal | `#2C8F86` |
| `--chart-3` | Purple | `#7357AE` |
| `--chart-4` | Blue (info) | `#075985` |
| `--chart-5` | Pink | `#C54A78` |

Dark mode uses the lighter `-400` stop of each family for contrast. The
tokens reference the ramps, so tenant theming flows through automatically.

### Shadows (named tokens)

Flat surfaces are the default -- use **borders** for separation, shadows
only for floating layers. Named tokens (Tailwind utilities):

| Utility | Value | Use |
|---|---|---|
| `shadow-xs` | `0 1px 2px rgba(0,0,0,.04)` | Default cards (with a 1px border) |
| `shadow-sm` | `0 1px 3px rgba(0,0,0,.08)` | Subtle raise (hover) |
| `shadow-md` | `0 4px 12px rgba(0,0,0,.08)` | Dropdowns, popovers, hover-cards |
| `shadow-lg` | `0 12px 32px rgba(0,0,0,.10)` | Larger floating panels |
| `shadow-pop` | `0 8px 24px rgba(0,0,0,.25)` | Modals / dialog overlays |

No gradients, no neon glows, no large blurred shadows.

### Sidebar tokens

Mirror the main palette but allow tweaking the rail without touching
the page surface. Use `bg-sidebar`, `text-sidebar-foreground`,
`hover:bg-sidebar-accent`, etc.

### Dark mode

Every token has a `.dark` override in `src/index.css`. Phoenix Gold
shifts brighter (`#BFA238`) to compensate for the dark canvas. **Never
duplicate this logic in JSX** \u2014 always use the token class and let CSS
swap.

---

## 3. Typography rules

Font: **Source Sans 3 Variable** (loaded globally via
`@import "@fontsource-variable/source-sans-3"` in `index.css`). Don't
import another font. Don't add a display font. Use weight to create
hierarchy, not face.

### Units — rem vs px (applies everywhere, not just type)

Size things in **`rem`** so they scale with the user's root font-size
preference (WCAG 1.4.4 Resize Text). Base is `1rem = 16px`. Use **`px`**
only for fixed hairline precision that must NOT scale.

| Property | Unit | Notes |
|---|---|---|
| Font sizes | **rem** | Use the `text-*` scale below — don't hard-code a bracket size |
| Icon sizes (Nucleo `<i>`, lucide) | **rem** | Sit next to text; must stay proportional (`text-[1.125rem]`) |
| Padding / margin / gap | **rem** | MUST use standard Tailwind tokens (`p-4`, `gap-2`) — never a bracket (`gap-[0.75rem]` ❌ → `gap-3`) |
| Heights/widths of text containers (inputs, rows, cards, max-w) | **rem** | Prevents clipping when text grows |
| Border-radius | **rem** | Matches the `--radius` token (already rem) |
| **Border / outline width** (1px, 1.5px) | **px** | Hairlines must stay crisp — never scale |
| **Box-shadow** offsets/blur | **px** | Cosmetic depth, not layout |

When you need an off-scale value, use a rem bracket (`h-[28.75rem]`), not a
px one — but for spacing (padding/margin/gap) brackets are never allowed:
stay on the token grid. Reach for a px bracket only for a
border/hairline/shadow.

### Scale (from `index.css`)

Sizes are `rem` (px equivalent at the 16px base shown for reference).

| Class | Size | Line height | Use |
|---|---|---|---|
| `text-xs` | 0.75rem (12px) | 1.4 | Table footnotes, badges, audit timestamps |
| `text-sm` | 0.875rem (14px) | 1.4 | Table cell body, helper copy, form descriptions |
| `text-base` | 1rem (16px) | 1.45 | **Default body** \u2014 buttons, labels, regular UI text |
| `text-md` | 1rem (16px) | 1.45 | Slightly larger body for primary content areas |
| `text-lg` | 1.0625rem (17px) | 1.3 | Card titles, section headers within a page |
| `text-xl` | 1.125rem (18px) | 1.3 | Page subtitles, modal titles |
| `text-2xl` | 1.3125rem (21px) | 1.25 | Page titles |
| `text-3xl` | 1.5rem (24px) | 1.2 | KPI tile values |
| `text-display` | 1.75rem (28px) | 1.15 | Reserved \u2014 use only for the largest KPI / hero number on the page |

**Components pin their own sizes** (per the design system's component
specs), independent of this scale: Button 15px (13px `sm`), Badge 13px,
sidebar nav items 15px, segmented controls 15px. The shadcn components
already carry these \u2014 don't override a component's text size; the scale
above is for page content (headings, body copy, helper text).

### Weight conventions

- `font-normal` (400) \u2014 body text, form / field labels, idle nav / tab / menu labels, secondary meta
- `font-medium` (500) \u2014 badge / chip text ONLY (DS `.jf-badge` is 500)
- `font-semibold` (600) \u2014 card titles, table column headers, page titles, emphasized values, dialog / section titles
- `font-bold` (700) \u2014 buttons, KPI tile values, hero numbers

Weight **500 is reserved for badges** \u2014 everywhere else the system jumps
400 to 600; map emphasis to 600 and plain text to 400.

Don't go lower than 400 or higher than 700. Don't apply `italic` to UI
text \u2014 reserve for inline citations / quoted strings only.

### Tracking & rhythm

- Default tracking everywhere. Don't tighten with `tracking-tight`
  except on `text-3xl` / `text-display` numbers.
- One blank line of `mt-4` / `mt-6` / `mt-8` between content blocks.
- Never stack two heading levels with no body between them.

---

## 4. Component stylings

All primitive components live at `src/components/ui/` (shadcn). Compose
those, don't fork them. Project-wide custom components live at
`src/components/shared/`.

### Buttons

Default to shadcn `<Button>`. The design system defines **four** button
variants -- there is **no** `destructive` or `link` button. (For a
destructive action, use a `default`/`secondary` button with clear copy and
a confirm dialog; the `Alert` and `Badge` components keep their own
`destructive` variant.)

| Variant | When | Visual |
|---|---|---|
| `default` (Primary) | The single most important action on the screen. One per screen. | Phoenix Gold fill, white text |
| `secondary` (Secondary) | The next action alongside the primary (e.g. Cancel). | White fill, **gold** 1.5px outline + gold text |
| `tertiary` / `outline` (Tertiary) | Toolbar / many-row actions; neutral choices. | White fill, neutral 1.5px border, ink text |
| `ghost` (Ghost) | Toolbar icon buttons, inline text actions, sidebar nav. | Transparent, gold text, no border |

Every variant carries the full state set: **Default - Hover - Focused
(3px gold halo) - Pressed (darker gold/ink) - Disabled** (muted). 8px
radius, weight 700, **15px** label (13px on `size="sm"`) \u2014 the Button
component pins these; don't override its text size or weight.

Size:

- `default` for page CTAs
- `sm` for table row actions and dense toolbars
- `icon` / `icon-sm` / `icon-lg` for icon-only buttons (always pair with `aria-label`)

Icon placement: `<Plus className="h-4 w-4 mr-2" /> New client` \u2014 icon
on the left, 16 px, 8 px gap. Right-side icons only for "go forward"
affordances (`<span>Continue <ChevronRight className="h-4 w-4 ml-2" /></span>`).

### Cards

`<Card>` with `<CardHeader>` + `<CardContent>` (+ optional `<CardFooter>`).
**8px radius**, 1px gray-200 border, resting `shadow-xs` (`0 1px 2px`). On
hover it lifts to `0 4px 16px` — that's the only elevation; the border does
not change. Use **borders, not shadows**, for separation otherwise.

Card title: `text-md font-semibold` (16px). Card description:
`text-[0.875rem] text-grayscale-600` (14px).

### Badges / chips

Soft-tinted **pills** for status, tags, and counts -- always
`rounded-full`. Each variant is a `50` tint + `500` text + `200` border
(weight 500, **13px** \u2014 pinned by the Badge component). There is **no**
`link` badge.

| Variant | Use | Tint |
|---|---|---|
| `default` | Brand tag / count | Gold (`primary-50/primary/200`) |
| `secondary` | Subdued / neutral tag | Muted gray |
| `success` | Live / active / healthy | Green |
| `info` | Informational / in-progress | Blue |
| `warning` | At-risk / attention | Amber |
| `destructive` | Failed / blocked / overdue | Red (danger) |

Use the **semantic variant** rather than a custom `className` -- e.g.
`<Badge variant="success">Live</Badge>`, `<Badge variant="warning">QA</Badge>`.
Reserve `default` (gold) for brand/env tags. Don't invent badge colors
outside these tints.

### Alerts

`<Alert variant>` uses the same soft-tint system as badges (50 bg / 200
border / 500 text): `default` (neutral card), `success`, `info`,
`warning`, `destructive`. Pick the semantic variant; don't hand-color.

### Progress

`<Progress>` is an 8px gray-200 track with a gold fill. Don't restyle the
height or colors.

### Inputs & forms

Always `<Label>` + `<Input>` pair. Label is `Label` (16px, weight 400,
ink) above the input, 4px gap (`mb-1.5`). **Required marker: a `*` after
the label (`text-destructive`) PLUS a 3px gold (`primary`) bar overlaid
on the field's left edge (squared left corners — a flat gold tab; right
side stays rounded)**. The gold bar is baked into the field primitives
and applied automatically whenever the control has `required` — so pass
`required` to the control AND add the `*` to the label. Helper / error
text:
`text-xs text-muted-foreground` below the input (`mt-1.5`); error swaps to
`text-destructive`.

All text controls share one spec baked into the primitives (the agent
gets it by default -- don't re-style):

- **Radius 8px**, 1px border, **16px / weight 600** value text, `10px 12px`
  padding. Focus: **teal fill + teal border** (`bg-teal-50` +
  `border-teal-200`) — the one place teal appears on a control (a soft,
  low-emphasis "active field" tint, distinct from the gold CTA accent).
  A `required` field additionally shows a 3px gold bar overlaid on the
  field's left edge (squared left corners; painted above the border so it
  runs flush corner-to-corner), kept through focus.
- `Input`, `Textarea`, `Select` (trigger), `NativeSelect` are all the same
  full-size field -- don't shrink them. (`NativeSelect` and `Select` accept
  `size="sm"` for dense toolbars only.)
- **Checkbox / Radio**: 24px, 1.5px border, gold when checked, gold-300
  focus ring. Checkbox supports an **indeterminate** state
  (`checked="indeterminate"` → dash).
- **Slider**: 8px track, 20px white thumb with a 2px gold border, gold
  fill.

Use these as-is; reach for custom classes only when the user asks for a
deviation.

### DataTable

Use the wrapper at `@/components/ui/data-table`. **Never `<table>` raw**;
the wrapper handles theming, pagination, virtualization, AG-Grid module
registration. Column widths default to auto; set explicit `width` only
for ID / status / actions columns. Right-align numbers, left-align text.
DS look: **gold header** (primary-50 bg, ink 16px/600, primary-100 bottom
border), gold table-wrap border (primary-200, 10px radius), **no zebra
stripes** — rows separate by hover (gray-50) and a gray-100 row border.
**Loading:** pass your query's `isLoading` (the `useSavedQueryTable` spread
already includes it). On the first load the table shows a shimmer skeleton;
once the grid mounts, later fetches use AG Grid's own overlay.
**Sizing:** the table sizes via its `minHeight` prop (default `'32rem'` ≈ 10
rows) — drop it in directly, **don't** wrap it in a fixed-pixel height or
compute a height from the row count. The grid renders at that height and the
page scrolls as one (see "the layout `<main>` owns the scroll" below). To make
a specific table taller/shorter, set the prop — don't wrap it.

```tsx
// Default height (32rem):
<DataTable {...tableProps} columnDefs={cols} />

// Taller table (number = px, or a string like '40rem' / '60vh'):
<DataTable {...tableProps} columnDefs={cols} minHeight={640} />
```

### Navigation

`<Sidebar>` (shadcn) with `bg-sidebar`. Nav item: 8px radius, 15px text,
idle icon gray-500. Active = `bg-sidebar-accent` (primary-50) +
`font-semibold` (600) + **gold icon** (primary-500). No border on nav
items — use the background swap.

### Tabs

`<Tabs>` are **flat**, not segmented pills. Two variants on `<TabsList variant>`:

| Variant | When | Active look |
|---|---|---|
| `underline` (**default**) | Switching sections inside a page / card. | Gold text, weight 700, 2px gold underline |
| `header` | Folder tabs at the top of a page that sit above a white content panel. | White panel bg, gold text, weight 700 (set `<TabsContent variant="header">` so the panel renders) |
| `pill` | Segmented toggle (non-DS extension) -- avoid unless explicitly asked. | Raised white pill |

Tabs are 16px, weight 400, ink text; hover -> gold. Don't restyle them or
add a container around `underline` tabs.

```tsx
<Tabs defaultValue="overview">
  <TabsList>{/* underline by default */}
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="activity">Activity</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">...</TabsContent>
</Tabs>
```

### Date & time

Three primitives, all pre-styled to the DS. Don't hand-roll a calendar or
spin up a third-party widget.

| Component | Use | Notes |
|---|---|---|
| `Calendar` | Inline month grid (a panel, a card). | 32px circle days; today = gray-200 circle; selected/range endpoints = solid gold circle, white text; range fill = **solid gold bar with white numerals** (not a pale tint). `mode="single"` or `mode="range"`. |
| `DatePicker` | A date **field** (input-styled trigger + popover Calendar). | `mode="single"` (default, `value: Date`) or `mode="range"` (`value: DateRange`, dual-month). Mirrors the Input field (8px radius, gold focus). Prefer this over composing Popover + Calendar yourself. |
| `TimePicker` | Pick an hour/minute. | Stepper columns with round chevron buttons. `hour12` adds an AM/PM column; emits 24-hour `"HH:mm"` either way. `minuteStep` defaults to 1. |

```tsx
<DatePicker value={date} onChange={setDate} placeholder="Pick a date" />
<DatePicker mode="range" value={range} onChange={setRange} />
<TimePicker value={time} onChange={setTime} hour12 minuteStep={5} />
```

### Toggle / segmented

For a row of **mutually-exclusive** choices use `<SegmentedControl>`
(`@/components/ui/segmented-control`) — the DS `.jf-seg` component. Selected
state is the DS cream-gold pill: `bg-primary-50` fill, `border-primary-300`,
weight 600 — never a gray fill. One selection reads as gold, the rest stay
neutral. Sizes sm/md/lg = 13/15/17px (component-pinned). Never hand-roll a
pill radio row from buttons + borders.

Yes/No questions: `<SegmentedControl options={['Yes','No']}>` or an inline
`RadioGroup` pair — either is DS-legal; pick one per app and stay consistent.

`<Toggle>` / `<ToggleGroup>` remain for press-toggle buttons and
multi-select segment rows (`type="multiple"`), with the same cream-gold
selected treatment.

### Icons

**Nucleo is the platform icon system and the default.** It's vendored
into the starter (font + CSS, no React wrapper). Render a glyph with an
`<i>` and the Tabler-named class:

```tsx
<i className="icon icon_-Tb_search text-[1.125rem]" aria-hidden="true" />
<i className="icon icon_-Tb_calendar text-[1.25rem]" aria-hidden="true" />
```

- **Picking a glyph (do this in order):**
  1. Look it up in **`src/assets/fonts/nucleo/ICONS.md`** — a curated
     friendly-name -> class catalog (~457 verified icons).
  2. Not listed? Confirm the exact class by grepping — **never guess, a
     wrong class renders blank with no error:**
     ```sh
     grep -oE "icon_-Tb_<keyword>[a-z0-9_]*" src/assets/fonts/nucleo/nucleo.css | sort -u
     ```
  3. Only if grep finds nothing suitable, fall back to `lucide-react`.
- Base class `icon` sets the Nucleo font; the `icon_-Tb_<name>` class
  picks the glyph. **Always set a size** with `text-[Nrem]` (rem, so the
  icon scales with text — never a `px` bracket).
- **Size up vs. an SVG.** A Nucleo glyph only fills ~80% of its em box
  (side-bearings), so it reads smaller than a lucide SVG at the same size.
  Use **`text-[1.125rem]` (18px) inline / next to body text**,
  **`text-[1.25rem]` (20px) in buttons, alerts, and "icon in a circle"
  tiles** (e.g. a glyph inside a `size-8` accent circle on a KPI card).
  Don't go below `1.125rem` (18px) for a standalone icon — it looks
  undersized.
- Decorative icons get `aria-hidden="true"`; icon-only buttons still need
  an `aria-label` on the button.
- **Lucide (`lucide-react`) is the fallback** — use a named Lucide
  component only when the glyph you need isn't in Nucleo. Don't mix both
  for the same role on a screen.
- **Sidebar / nav icons are Nucleo.** A route's `icon` is a Nucleo glyph
  class string (`icon: 'icon_-Tb_home'`), rendered at 1.25rem (20px),
  grayscale-500 when inactive and Primary-500 when active; the nav label
  is 0.9375rem (15px, semibold when active). Never pass a lucide component
  as a route icon.
- Never use emojis.

---

## 5. Layout principles

### Spacing system (4-pt grid)

Tailwind's default scale lands on the 4-pt grid out of the box:

- `1` = 4 px (rare; inline icons)
- `2` = 8 px (tight pairs)
- `3` = 12 px (related items in a row)
- `4` = 16 px (default gap inside a card)
- `6` = 24 px (default gap between cards)
- `8` = 32 px (between major page sections)
- `12` = 48 px (above page title block, below page footer)

Never use `5`, `7`, `9`, `11` \u2014 those break the rhythm.

### Container & grid

Dashboards and list pages are **full-width by default** — NO max-width and
NO `mx-auto` on the page root. They fill the content area and get the
layout's 24px edges on all sides. Forms and wizards use `max-w-3xl` (narrow,
readable). **Do NOT add your own outer `p-*` / `px-*` to the page root** —
the layout `<main>` already provides 24px (`p-6`) padding on all sides;
adding more doubles the edges.

Only add `max-w-7xl mx-auto` (or similar) when a page *explicitly* wants a
centered, capped reading column — be aware it produces large left/right
margins on wide screens (the content centers within the cap), which is NOT
the same as the default 24px edges. Default list/dashboard pages omit it.

**The layout `<main>` owns the scroll — the page is plain content.** The page
renders inside `DefaultLayout`'s scrollable `<main>` (`100vh − topbar`). Make
the page root a normal-flow `flex flex-col gap-*` container that simply grows;
`<main>` scrolls it. NEVER give the page root a viewport height
(`h-svh`/`min-h-svh`/`h-screen`), a `sticky top-0` page header, or a nested
`overflow-y-auto` wrapper — those double-count the viewport and produce a
trailing empty band plus a second scrollbar.

KPI tile rows: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`.

Filter rail + main content: `grid grid-cols-[16.25rem_1fr] gap-6` on
desktop; collapse the rail into a popover on mobile.

### Whitespace philosophy

When in doubt, add space. The starter ships with generous padding by
design \u2014 if a card feels claustrophobic, the problem is too many
elements inside, not too little padding. Cut elements before cutting
space.

### Border radius scale

From `index.css`:

| Class | Use |
|---|---|
| `rounded-sm` | Small chips, sub-elements inside a card |
| `rounded-md` | **Default** \u2014 buttons, inputs, small cards |
| `rounded-lg` | Cards, modals, larger surfaces |
| `rounded-xl` / `rounded-2xl` | Hero / feature surfaces (rare in Phoenix) |
| `rounded-full` | Avatars, pills, badge, icon-only buttons |

---

## 6. Depth & elevation

Phoenix is mostly flat. Use borders and color contrast for separation
before reaching for a shadow.

Allowed elevation tokens:

| Where | Class |
|---|---|
| Resting card | none (border-only) |
| Dropdown / popover | `shadow-md` (shadcn default) |
| Modal / dialog | `shadow-lg` (shadcn default) |
| Toast | `shadow-lg` |
| Sticky table header on scroll | `shadow-sm` after the user scrolls past it |

**Never** apply shadows to buttons, inputs, badges, KPI tiles, or list
rows. **Never** use `shadow-xl` or `shadow-2xl` \u2014 the system has no
surface that needs that much weight.

---

## 7. Do's and don'ts

### Do

- Use exactly one primary action per screen.
- Use Phoenix Gold (`bg-primary`) only for primary actions, active
  states, and the gold-tinted selected-row marker.
- Use `text-muted-foreground` for everything secondary \u2014 helper text,
  metadata, table sub-rows.
- Right-align currency, AUM, percentages, counts.
- Render dates as "Jan 12, 2025" (medium format) in tables;
  "January 12, 2025" in detail pages.
- Format money with `Intl.NumberFormat` and a fixed currency code from
  the entity \u2014 never hard-code `$`.
- Pair every icon-only button with `aria-label`.
- Compose shadcn components rather than authoring new primitives.
- Read `src/components/ui/<component>/index.ts` to discover what's
  available before importing.

### Don't

- Don't hard-code colors, font names, or px sizes for shadcn-managed
  spacing/type. Use token classes; size in `rem` (px only for
  borders/hairlines/shadows — see §3 Units).
- Don't introduce a secondary brand color. Phoenix has one accent.
- Don't add gradients or saturated backgrounds. The canvas is white,
  surfaces are white or `--secondary`.
- Don't use emojis in product UI. Use an icon or no icon.
- Don't put more than one primary button in a button row. Subsequent
  actions are `outline` or `secondary`.
- Don't author a custom `<Table>` element. Always use the `DataTable`
  wrapper from `@/components/ui/data-table`.
- Don't apply `italic` or `uppercase` for emphasis. Use weight (`font-semibold`)
  or color (`text-foreground` vs `text-muted-foreground`) instead.
- Don't ship hero illustrations, mascots, decorative imagery,
  Lottie animations, or shimmer skeletons. Use `Skeleton` from
  shadcn for loading. **One sanctioned exception:** the empty-state
  illustration in `EmptyState` (`@/components/ui/empty-state`, per
  `patterns/empty-state.html`) — use it for "no data yet" surfaces
  (lists, grids, panels, modals). Only the focal icon changes per
  surface. The lighter icon-tile `Empty` (`@/components/ui/empty`)
  remains available for dense/inline spots where the illustration is
  too heavy.
- Don't override `--radius` per component. Use the scale.
- Don't deviate from the 4-pt spacing grid.

---

## 8. Voice & tone

JiffyAI is operational software for analysts and RIAs, not a consumer app.
Copy is crisp and businesslike.

- **Direct, businesslike, sentence-case.** No exclamation points, no slang,
  no emoji, no ALL-CAPS shouting, no ironic/playful microcopy.
- **"You" / "Your"** for greetings and possessive context ("Your
  Applications", "What would you like to do next?").
- **AI framing is warm, not cutesy.** The companion is "JIFFY" in all caps
  inside prompts, "Jiffy"/"JiffyAI" in prose.
- **Progress language** is gerund + present ("Analyzing your inputs",
  "Preparing screens").
- **Numbers stay compact** ($120M, $8.5M, 3.2%, 120) -- never spelled out.

### Casing

| Element | Case | Example |
|---|---|---|
| Page titles | Sentence case | "My Workspace", "Book of Business Summary" |
| Table section titles | Title Case | "Tenant Admins", "Service Requests" |
| Buttons | Title Case | "Create App", "Add Preference", "Clear Filters" |
| Form labels | Sentence case | "Account number", "Primary email" |
| Badges / pills | Title Case | "Live", "Dev", "QA", "Production" |

---

## Agent prompt guide

When you generate any page or component:

1. **Read this file first.** Match the requested page type to operational
   vs form mode (section 1).
2. **Pick from the palette.** If the screen needs a color the palette
   doesn't carry, flag it in chat \u2014 don't invent.
3. **Pick from the type scale.** Match the right size class to the
   semantic role (section 3 table).
4. **Compose shadcn primitives** (`src/components/ui/index.ts` for the
   list). Don't fork or restyle them.
5. **Stay on the 4-pt grid.** Use only `1, 2, 3, 4, 6, 8, 12` from
   Tailwind's spacing scale.
6. **Run the don'ts list** before emitting. If you broke any, fix.
