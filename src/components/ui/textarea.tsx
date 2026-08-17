import * as React from "react"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Textarea({
  className,
  config,
  style,
  placeholder,
  required,
  disabled,
  ...props
}: React.ComponentProps<"textarea"> & {
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  // OR-merge: an admin config can ADD required, but the slot default (required:
  // false, materialized for every config-carrying instance in defaults.ts) must
  // NOT clobber a required prop passed by the page (?? did exactly that).
  const resolvedRequired = Boolean(c.config?.required || required)

  const textareaEl = (
    <textarea
      data-slot="textarea"
      placeholder={c.config?.placeholder ?? placeholder}
      required={resolvedRequired}
      aria-required={resolvedRequired}
      disabled={c.config?.disabled ?? disabled}
      className={cn(
        "flex field-sizing-content min-h-24 w-full resize-y rounded-[0.5rem] border border-input bg-card px-3 py-2.5 text-md font-semibold leading-[1.375rem] text-foreground transition-colors duration-150 outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-teal-200 focus-visible:bg-teal-50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-grayscale-400 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        // Required fields square the LEFT corners (flat gold tab; right side
        // stays rounded) — the gold bar itself is the overlay below.
        resolvedRequired && "rounded-[0_0.5rem_0.5rem_0]",
        c.className
      )}
      style={c.style}
      {...props}
    />
  )

  if (!resolvedRequired) return textareaEl

  // Required marker: a 3px gold bar OVERLAID on the field's left edge — a
  // sibling painted above the border so it reaches the exact corners (see
  // input.tsx). Textareas can't host pseudo-elements either.
  return (
    <div data-slot="textarea-required-wrap" className="relative w-full">
      {textareaEl}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-primary"
      />
    </div>
  )
}

export { Textarea }
