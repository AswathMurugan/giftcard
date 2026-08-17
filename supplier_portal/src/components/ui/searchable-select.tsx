"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { ChevronDownIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"
import {
  normalizeOptions,
  type OptionObject,
  type SearchableSelectOption,
} from "./searchable-select-utils"

/**
 * SearchableSelect — a single-select dropdown WITH a search box (PHX-style
 * "Funding Bank" picker). Looks like the `Select` (bordered trigger, gold
 * open-state border, chevron, inset gold-tinted selected row) but its popup
 * has a search input that filters the options.
 *
 * Use this instead of `Select` when the option list is long enough that search
 * helps (banks, accounts, clients, countries, advisors…). For a short fixed
 * list, keep `Select`. For multi-select chips or custom item rendering, drop to
 * the lower-level `Combobox` primitives in `@/components/ui/combobox`.
 *
 * Drop-in, `Select`-like API:
 *   <SearchableSelect
 *     value={bank}
 *     onValueChange={setBank}
 *     options={['Chase Bank', 'Bank of America', …]}   // or {label,value}[]
 *     placeholder="Select a bank"
 *     searchPlaceholder="Search banks"
 *   />
 */

// Option helpers live in ./searchable-select-utils so this file only exports
// components (react-refresh). Re-export the public option type for consumers
// that import it from '@/components/ui/searchable-select'.
export type { SearchableSelectOption } from "./searchable-select-utils"

export interface SearchableSelectProps {
  /** The selectable options (strings or {label,value} objects). */
  options: readonly SearchableSelectOption[]
  /** Selected value (controlled). */
  value?: string | null
  /** Called with the newly selected value (or "" when cleared). */
  onValueChange?: (value: string) => void
  /** Trigger text shown when nothing is selected. */
  placeholder?: string
  /** Placeholder for the in-popup search input. */
  searchPlaceholder?: string
  /** Message shown when the search matches no options. */
  emptyText?: string
  disabled?: boolean
  className?: string
  id?: string
  /** Native form field name (renders a hidden input for non-RHF forms). */
  name?: string
  "aria-invalid"?: boolean
  /** Draws the gold required left-border marker (matches Input/Textarea). */
  required?: boolean
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
  /**
   * Portal the popup into this element instead of `document.body`. REQUIRED when
   * the control lives inside a modal Radix Dialog: Radix sets
   * `pointer-events: none` on `body` siblings while open, so a body-portalled
   * popup can't be scrolled/clicked. Pass the dialog content node (or a ref to
   * it) to render the popup inside the modal's pointer-events + focus scope.
   */
  portalContainer?: HTMLElement | null | React.RefObject<HTMLElement | null>
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  disabled,
  className,
  id,
  name,
  required,
  config,
  portalContainer,
  ...props
}: SearchableSelectProps) {
  const c = useCustomization(config, className)
  const items = React.useMemo(() => normalizeOptions(options), [options])
  const selected = React.useMemo(
    () => items.find((o) => o.value === value) ?? null,
    [items, value],
  )

  if (c.hidden) return null

  return (
    <ComboboxPrimitive.Root
      items={items}
      value={selected}
      name={name}
      disabled={c.config?.disabled ?? disabled}
      onValueChange={(v) =>
        onValueChange?.(v && typeof v === "object" ? (v as OptionObject).value : "")
      }
      isItemEqualToValue={(a: OptionObject, b: OptionObject) =>
        a?.value === b?.value
      }
      itemToStringLabel={(item: OptionObject) => item?.label ?? ""}
      itemToStringValue={(item: OptionObject) => item?.value ?? ""}
    >
      <ComboboxPrimitive.Trigger
        data-slot="searchable-select-trigger"
        id={id}
        aria-invalid={props["aria-invalid"]}
        aria-required={required}
        className={cn(
          // Mirrors the Select trigger (select.tsx): bordered card, teal fill +
          // border on open + focus, chevron flips up on open.
          "group flex w-full items-center justify-between gap-2 rounded-[0.5rem] border border-input bg-card px-3 py-2.5 text-md font-semibold leading-[1.375rem] text-foreground whitespace-nowrap transition-colors duration-150 outline-none select-none",
          "focus-visible:border-teal-200 focus-visible:bg-teal-50",
          "data-[popup-open]:border-teal-200 data-[popup-open]:bg-teal-50",
          "data-[placeholder]:font-normal data-[placeholder]:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-grayscale-400",
          "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          // Required fields square the LEFT corners (flat gold tab; right side
          // stays rounded) — the gold bar itself is the overlay child below.
          required && "relative rounded-[0_0.5rem_0.5rem_0]",
          c.className,
        )}
      >
        {/* Required marker: 3px gold bar overlaid on the trigger's left edge —
            a child paints above the border, reaching the exact corners. */}
        {required && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-y-px -left-px w-[3px] bg-primary"
          />
        )}
        <span className="line-clamp-1 text-left">
          <ComboboxPrimitive.Value>
            {(val: OptionObject | null) => (val ? val.label : placeholder)}
          </ComboboxPrimitive.Value>
        </span>
        <ChevronDownIcon className="pointer-events-none size-[1.125rem] shrink-0 text-grayscale-600 transition-transform duration-150 group-data-[popup-open]:rotate-180" />
      </ComboboxPrimitive.Trigger>

      <ComboboxPrimitive.Portal container={portalContainer ?? undefined}>
        <ComboboxPrimitive.Positioner
          side="bottom"
          sideOffset={6}
          align="start"
          className="isolate z-50"
        >
          <ComboboxPrimitive.Popup
            data-slot="searchable-select-content"
            // `group/ss-content`: Base UI stamps `data-empty` on the popup when the
            // filtered list is empty — the Empty block below keys off it so its
            // padding doesn't render as a permanent blank band while options exist.
            className="group/ss-content flex max-h-[min(22.5rem,var(--available-height))] w-(--anchor-width) min-w-(--anchor-width) flex-col overflow-hidden rounded-[0.5rem] border border-border bg-card p-2 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.08),0_2px_6px_rgba(0,0,0,0.04)] duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            {/* Search box — left magnifier + filtering input. */}
            <div className="mb-1.5 flex h-10 shrink-0 items-center gap-2 rounded-lg border border-input px-3 transition-colors focus-within:border-primary focus-within:outline focus-within:outline-[1.5px] focus-within:outline-primary">
              <SearchIcon className="size-[1.125rem] shrink-0 text-muted-foreground" />
              <ComboboxPrimitive.Input
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-md text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
              />
            </div>

            {/* Base UI keeps this element MOUNTED with null children while matches
                exist — without `hidden` its py-6 renders as a permanent blank band
                above the options. Reveal only when the popup is `data-empty`. */}
            <ComboboxPrimitive.Empty className="hidden px-3 py-6 text-center text-sm text-muted-foreground group-data-empty/ss-content:block">
              {emptyText}
            </ComboboxPrimitive.Empty>

            <ComboboxPrimitive.List className="-mx-1 flex flex-col overflow-y-auto px-1">
              {(item: OptionObject) => (
                <ComboboxPrimitive.Item
                  key={item.value}
                  value={item}
                  disabled={item.disabled}
                  className={cn(
                    // Mirrors the Select item: rounded inset pill, gold-tinted
                    // highlight for selected + keyboard/pointer focus.
                    "relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-md leading-[1.375rem] outline-hidden select-none transition-colors duration-150",
                    "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                    "data-selected:bg-accent data-selected:font-semibold",
                    "data-disabled:pointer-events-none data-disabled:opacity-50",
                  )}
                >
                  {item.label}
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
