import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Checkbox({
  className,
  config,
  style,
  disabled,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      disabled={c.config?.disabled ?? disabled}
      className={cn(
        "peer relative flex size-6 shrink-0 items-center justify-center rounded-[0.25rem] border-[1.5px] border-input bg-card transition-[background-color,border-color,box-shadow] duration-[120ms] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-primary-300 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:border-border data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground disabled:data-checked:bg-grayscale-300 disabled:data-checked:border-input aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        c.className
      )}
      style={c.style}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5 [&>svg]:stroke-[3]"
      >
        {/* Radix renders the indicator for both `checked` and the
            `indeterminate` state; show a dash for indeterminate, a tick
            otherwise — matches the design-system checkbox spec. */}
        {props.checked === "indeterminate" ? <MinusIcon /> : <CheckIcon />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
