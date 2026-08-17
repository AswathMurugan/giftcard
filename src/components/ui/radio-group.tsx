import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function RadioGroup({
  className,
  config,
  style,
  disabled,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root> & {
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      disabled={c.config?.disabled ?? disabled}
      className={cn("grid w-full gap-2", c.className)}
      style={c.style}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-6 shrink-0 rounded-full border-[1.5px] border-input bg-card outline-none transition-[background-color,border-color,box-shadow] duration-[120ms] after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-primary-300 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:border-border data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground disabled:data-checked:bg-grayscale-300 disabled:data-checked:border-input aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-6 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
