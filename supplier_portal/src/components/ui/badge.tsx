import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

// JiffyAI DS badge (PHX-3941): soft-tinted pills (50 bg / 500 text / 200
// border), pill radius, weight 500, 13px (DS .jf-badge — size pinned as a
// rem literal, independent of the type-scale tokens). `destructive` = danger tint.
// NOTE: no `leading-*` override — DS .jf-badge sets no line-height, so it
// inherits text-sm's 1.4. That yields the DS's ~24.5px pill height; forcing
// leading-tight (1.25) shrinks it to ~22px (verified in DevTools). Leave it.
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-primary-200 [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-primary-50 text-primary border-primary-200",
        secondary:
          "bg-muted text-grayscale-600 border-border",
        success:
          "bg-success-50 text-success border-success-200",
        info:
          "bg-info-50 text-info border-info-200",
        warning:
          "bg-warning-50 text-warning border-warning-200",
        destructive:
          "bg-danger-50 text-danger border-danger-200",
        // Categorical tags (DS extended families). Use for category/tag
        // columns (e.g. a "Segment" value) where each value gets its own
        // hue — assign per value MANUALLY; never auto-map a category to a
        // semantic status variant (e.g. "High Net Worth" must not render as
        // `destructive`/Error).
        teal:
          "bg-teal-50 text-teal-700 border-teal-200",
        purple:
          "bg-purple-50 text-purple-700 border-purple-200",
        pink:
          "bg-pink-50 text-pink-700 border-pink-200",
        tan:
          "bg-tan-50 text-tan-700 border-tan-200",
        // Neutral aliases kept for existing `variant="outline"`/`"ghost"`.
        outline:
          "bg-card text-foreground border-border",
        ghost:
          "bg-transparent text-muted-foreground border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  config,
  style,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
    /** Optional customization slot — makes this instance admin-customizable. */
    config?: CfgSlot
  }) {
  const Comp = asChild ? Slot.Root : "span"
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  const resolvedVariant = (c.config?.variant as typeof variant) ?? variant

  return (
    <Comp
      data-slot="badge"
      data-variant={resolvedVariant}
      className={cn(badgeVariants({ variant: resolvedVariant }), c.className)}
      style={c.style}
      {...props}
    >
      {!asChild && c.config?.label ? c.config.label : children}
    </Comp>
  )
}

export { Badge, badgeVariants }
