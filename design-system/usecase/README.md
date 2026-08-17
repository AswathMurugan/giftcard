# Use-case samples

Canonical, on-brand usage samples for the design system, written with the
**real** repo components (`@/components/ui/*`) + Tailwind token classes + Nucleo
icons — the exact stack you author production pages in.

**Read the sample for a component before you build that component.** Match the
look and the usage pattern shown here. These files are reference only: they are
not routed, not bundled, and not imported by app code.

Do **not** copy `--jf-*` tokens, `.jf-*` classes, or Tabler icons from the
upstream design-system bundle — those are foreign to this repo. Everything you
need is already expressed here in repo terms.

| Component | Sample | What it demonstrates |
|---|---|---|
| Button | `button.tsx` | One primary action; variant set; 18px Nucleo button icons |
| Badge | `badge.tsx` | Status variants + per-value categorical tags (manual colour map) |
| Input / Select / Label | `input.tsx` | Form field: label + control, enum-driven Select |
| Card | `card.tsx` | Flat bordered container; header/content/footer slots |
| Tabs | `tabs.tsx` | Flat underline tabs (DS default) |
| Checkbox / Radio / Switch | `controls.tsx` | Selection controls + associated labels |
| DatePicker | `date-picker.tsx` | Single + range date fields |
| DataTable | `data-table.tsx` | Gold header, 18px title, column defs, status badges, opt-in row actions (⋮ View/Edit/Delete) |
| Empty state | `empty-state.tsx` | Icon-only empty state (no illustration, no shadow) |

Typecheck these samples with `npx tsc -p design-system/usecase/tsconfig.json --noEmit`.
