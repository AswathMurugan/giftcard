"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Switch({
  className,
  size = "default",
  config,
  style,
  disabled,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      disabled={c.config?.disabled ?? disabled}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-[background-color] duration-150 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-primary-300 focus-visible:outline-offset-2 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[1.375rem] data-[size=default]:w-[2.5rem] data-[size=sm]:h-[1rem] data-[size=sm]:w-[1.75rem] data-checked:bg-primary data-unchecked:bg-grayscale-300 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        c.className
      )}
      style={c.style}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-card shadow-[0_1px_2px_rgba(0,0,0,0.15)] ring-0 transition-transform duration-150 group-data-[size=default]/switch:size-[1.125rem] group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[1.125rem] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0.5 group-data-[size=sm]/switch:data-unchecked:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
