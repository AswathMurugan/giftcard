import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

const toggleVariants = cva(
  // DS segmented selected state (.jf-seg__btn.is-selected): cream gold-50
  // fill, gold-300 border, weight 600 ink — not the shadcn gray.
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg border border-transparent text-sm font-normal whitespace-nowrap transition-all outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-primary-200 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:border-primary-300 aria-pressed:bg-primary-50 aria-pressed:font-semibold aria-pressed:text-foreground data-[state=on]:border-primary-300 data-[state=on]:bg-primary-50 data-[state=on]:font-semibold data-[state=on]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-input bg-transparent hover:bg-accent",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),0.75rem)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  config,
  style,
  disabled,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    /** Optional customization slot — makes this instance admin-customizable. */
    config?: CfgSlot
  }) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  const resolvedVariant = (c.config?.variant as typeof variant) ?? variant

  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      disabled={c.config?.disabled ?? disabled}
      className={cn(toggleVariants({ variant: resolvedVariant, size, className: c.className }))}
      style={c.style}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
