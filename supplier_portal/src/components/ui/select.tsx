"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Select({
  onValueChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  // Radix fires `onValueChange("")` to "reset" a controlled Select whenever its
  // `value` doesn't match any currently-mounted <SelectItem>. That happens on
  // prefilled forms whose options load async (e.g. a country dropdown backed by
  // a saved query): the value is set before the items exist, so Radix clears it
  // and the prefilled value is lost. Swallow that spurious empty event — an
  // empty string is never a real user selection (Radix reserves it for the
  // placeholder state), so callers never need it.
  const handleValueChange = React.useCallback(
    (value: string) => {
      if (value === "") return
      onValueChange?.(value)
    },
    [onValueChange],
  )
  return (
    <SelectPrimitive.Root
      data-slot="select"
      onValueChange={handleValueChange}
      {...props}
    />
  )
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  className,
  lookupValue,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value> & {
  /**
   * Fallback label shown while the matching option hasn't mounted yet —
   * e.g. when a prefilled value is set but the `<SelectItem>` options are
   * still loading from an async query. Pass the known display label (the
   * value you'd show for the current `value`, like a country's name).
   *
   * It is ONLY a bridge: Radix leaves the value node empty during the
   * async gap, so this renders then; once the real option mounts (or the
   * user picks one), Radix portals the option's own text in and that wins.
   * Omit it for fully-static option lists.
   */
  lookupValue?: string
}) {
  // `peer` + `peer-empty:` lets the fallback show ONLY when the Radix value
  // node is empty (value set, no option mounted) — not when it shows the
  // placeholder (no value) or the real selected option's text.
  return (
    <>
      <SelectPrimitive.Value
        data-slot="select-value"
        className={cn("peer", className)}
        {...props}
      />
      {lookupValue ? (
        <span
          data-slot="select-value-fallback"
          aria-hidden
          className="hidden line-clamp-1 items-center gap-2 peer-empty:flex"
        >
          {lookupValue}
        </span>
      ) : null}
    </>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  config,
  style,
  disabled,
  required,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
  /** Draws the gold required left-border marker (matches Input/Textarea). */
  required?: boolean
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  // OR-merge: an admin config can ADD required, but the slot default (required:
  // false, materialized for every config-carrying instance in defaults.ts) must
  // NOT clobber a required prop passed by the page (?? did exactly that).
  const resolvedRequired = Boolean(c.config?.required || required)

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      aria-required={resolvedRequired}
      disabled={c.config?.disabled ?? disabled}
      className={cn(
        "group flex w-full items-center justify-between gap-2 rounded-[0.5rem] border border-input bg-card px-3 py-2.5 text-md font-semibold leading-[1.375rem] text-foreground whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:border-teal-200 focus-visible:bg-teal-50 data-[state=open]:border-teal-200 data-[state=open]:bg-teal-50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-grayscale-400 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:font-normal data-placeholder:text-muted-foreground data-[size=sm]:py-1.5 data-[size=sm]:text-sm *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.125rem]",
        // Required fields square the LEFT corners (flat gold tab; right side
        // stays rounded) — the gold bar itself is the overlay child below.
        resolvedRequired && "relative rounded-[0_0.5rem_0.5rem_0]",
        c.className
      )}
      style={c.style}
      {...props}
    >
      {/* Required marker: 3px gold bar overlaid on the trigger's left edge.
          A child paints ABOVE the border, so the bar reaches the exact corners
          (-1px offsets compensate for positioning against the padding box). */}
      {resolvedRequired && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-y-px -left-px w-[3px] bg-primary"
        />
      )}
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-[1.125rem] text-grayscale-600 transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        className={cn("relative z-50 max-h-[17.5rem] min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[0.5rem] border border-border bg-card p-2 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.08),0_2px_6px_rgba(0,0,0,0.04)] duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", position ==="popper"&&"w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width) data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1", className )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full",
            position === "popper" && ""
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // Hover (unselected items): neutral grayscale-100. Selected value:
        // primary shade (accent = primary-50) + bold, NO tick mark. The hover is
        // scoped to `data-[state=unchecked]` so the selected item keeps its
        // primary shade even while highlighted (no state collision).
        "relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-md leading-[1.375rem] outline-hidden select-none transition-colors duration-150 data-[state=unchecked]:focus:bg-grayscale-100 data-[state=checked]:bg-accent data-[state=checked]:font-semibold data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
