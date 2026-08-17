import * as React from "react"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Input({
  className,
  type,
  config,
  style,
  placeholder,
  required,
  disabled,
  ...props
}: React.ComponentProps<"input"> & {
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  // OR-merge: an admin config can ADD required, but the slot default (required:
  // false, materialized for every config-carrying instance in defaults.ts) must
  // NOT clobber a required prop passed by the page (?? did exactly that).
  const resolvedRequired = Boolean(c.config?.required || required)

  const inputEl = (
    <input
      type={type}
      data-slot="input"
      placeholder={c.config?.placeholder ?? placeholder}
      required={resolvedRequired}
      aria-required={resolvedRequired}
      disabled={c.config?.disabled ?? disabled}
      className={cn(
        "w-full min-w-0 rounded-[0.5rem] border border-input bg-card px-3 py-2.5 text-md font-semibold leading-[1.375rem] text-foreground transition-colors duration-150 outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-teal-200 focus-visible:bg-teal-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-grayscale-400 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-normal file:text-foreground",
        // Required fields square the LEFT corners (flat gold tab; right side
        // stays rounded) — the gold bar itself is the overlay below.
        resolvedRequired && "rounded-[0_0.5rem_0.5rem_0]",
        c.className
      )}
      style={c.style}
      {...props}
    />
  )

  if (!resolvedRequired) return inputEl

  // Required marker: a 3px gold bar OVERLAID on the field's left edge. It's a
  // sibling element (inputs can't host pseudo-elements) painted ABOVE the
  // input's border, so the bar reaches the exact top/bottom corners — a plain
  // border-left is always clipped by the 1px top/bottom border miters.
  return (
    <div data-slot="input-required-wrap" className="relative w-full">
      {inputEl}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-primary"
      />
    </div>
  )
}

export { Input }
