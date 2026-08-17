import * as React from "react"

import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}

function NativeSelect({
  className,
  size = "default",
  config,
  style,
  required,
  disabled,
  ...props
}: NativeSelectProps) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  // OR-merge: an admin config can ADD required, but the slot default (required:
  // false, materialized for every config-carrying instance in defaults.ts) must
  // NOT clobber a required prop passed by the page (?? did exactly that).
  const resolvedRequired = Boolean(c.config?.required || required)

  return (
    <div
      className={cn(
        "group/native-select relative w-full has-[select:disabled]:opacity-50",
        c.className
      )}
      style={c.style}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        required={resolvedRequired}
        aria-required={resolvedRequired}
        disabled={c.config?.disabled ?? disabled}
        className={cn(
          "w-full min-w-0 appearance-none rounded-[0.5rem] border border-input bg-card py-2.5 pr-9 pl-3 text-md font-semibold leading-[1.375rem] text-foreground transition-colors duration-150 outline-none select-none focus-visible:border-teal-200 focus-visible:bg-teal-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-grayscale-400 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=sm]:py-1.5 data-[size=sm]:text-sm",
          // Required fields square the LEFT corners (flat gold tab; right side
          // stays rounded) — the gold bar itself is the overlay below.
          resolvedRequired && "rounded-[0_0.5rem_0.5rem_0]"
        )}
        {...props}
      />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-[1.125rem] -translate-y-1/2 text-muted-foreground select-none" aria-hidden="true" data-slot="native-select-icon" />
      {/* Required marker: 3px gold bar overlaid on the field's left edge —
          painted above the select's border so it reaches the exact corners. */}
      {resolvedRequired && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-primary"
        />
      )}
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
