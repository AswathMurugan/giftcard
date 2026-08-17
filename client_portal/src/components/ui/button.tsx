import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

// Aligned to the JiffyAI Design System button spec (PHX-3941): 8px radius,
// font-weight 600, full Default/Hover/Focused/Pressed/Disabled states per
// variant, and the DS variant set (Primary/Secondary/Tertiary/Ghost). The
// design system has NO destructive or link button — for a destructive action
// use the `default` button with destructive copy, or the Alert/Badge
// `destructive` variants (those components keep it).
//
// Variant → DS mapping:
//   default   → Primary    (filled gold)
//   secondary → Secondary  (gold outline)
//   outline   → Tertiary   (neutral outline)  ← alias of `tertiary`
//   tertiary  → Tertiary   (neutral outline)
//   ghost     → Ghost      (text/icon, gold)
//
// Pressed state is keyed off `active:` (DS `is-pressed`); Focused off
// `focus-visible:` with the 3px primary-200 halo (DS `is-focus`).
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-[0.5rem] border border-transparent text-[0.9375rem] font-bold leading-none whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 outline-none select-none active:translate-y-[0.5px] disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary — filled gold.
        default:
          "bg-primary text-primary-foreground border-primary hover:bg-primary-600 hover:border-primary-600 focus-visible:shadow-[0_0_0_3px_var(--primary-200)] active:bg-primary-800 active:border-primary-800 disabled:bg-primary-200 disabled:border-primary-200 disabled:text-primary-foreground",
        // Secondary — gold outline.
        secondary:
          "border-[1.5px] border-primary bg-card text-primary font-bold hover:bg-primary-50 hover:border-primary-600 hover:text-primary-600 focus-visible:shadow-[0_0_0_3px_var(--primary-200)] active:border-primary-800 active:text-primary-800 disabled:border-primary-200 disabled:text-primary-200",
        // Tertiary — neutral outline.
        tertiary:
          "border-[1.5px] border-border bg-card text-foreground hover:border-grayscale-700 focus-visible:shadow-[0_0_0_3px_var(--primary-200)] focus-visible:border-grayscale-700 active:border-grayscale-900 disabled:bg-grayscale-100 disabled:border-grayscale-200 disabled:text-grayscale-300",
        // Alias of Tertiary (kept for existing `variant="outline"` usages).
        outline:
          "border-[1.5px] border-border bg-card text-foreground hover:border-grayscale-700 focus-visible:shadow-[0_0_0_3px_var(--primary-200)] focus-visible:border-grayscale-700 active:border-grayscale-900 disabled:bg-grayscale-100 disabled:border-grayscale-200 disabled:text-grayscale-300",
        // Ghost — text/icon, gold.
        ghost:
          "bg-transparent text-primary hover:text-primary-600 focus-visible:shadow-[0_0_0_3px_var(--primary-200)] active:text-primary-800 disabled:text-primary-200",
      },
      size: {
        default: "px-4 py-2",
        sm: "gap-1.5 px-3 py-1.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-4",
        // Icon-only buttons carry a larger glyph than label buttons (DS:
        // btn--icon 20px, btn--icon-lg 22px); override the 16px base.
        icon: "p-2 [&_svg:not([class*='size-'])]:size-5",
        // `icon-sm` is retained (used by sheet/dialog/sidebar close buttons);
        // not in the DS sheet but a useful tighter icon button.
        "icon-sm": "p-1.5 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "p-2.5 [&_svg:not([class*='size-'])]:size-[1.375rem]",
      },
    },
    compoundVariants: [
      // Ghost is a tight text/icon button — DS pads it to 0.25rem (0.375rem at icon-lg),
      // overriding the per-size padding. Done via compoundVariant so we don't
      // need an `!important`.
      { variant: "ghost", size: "default", class: "p-1" },
      { variant: "ghost", size: "sm", class: "p-1" },
      { variant: "ghost", size: "icon", class: "p-1" },
      { variant: "ghost", size: "icon-sm", class: "p-1" },
      { variant: "ghost", size: "icon-lg", class: "p-1.5" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  config,
  style,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Optional customization slot — makes this instance admin-customizable. */
    config?: CfgSlot
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  return (
    <Comp
      data-slot="button"
      data-variant={(c.config?.variant as typeof variant) ?? variant}
      data-size={size}
      disabled={c.config?.disabled ?? disabled}
      className={cn(
        buttonVariants({
          variant: (c.config?.variant as typeof variant) ?? variant,
          size,
          className: c.className,
        })
      )}
      style={c.style}
      {...props}
    >
      {/* A label override only applies to plain buttons; with asChild the
          caller controls the single child element. */}
      {!asChild && c.config?.label ? c.config.label : children}
    </Comp>
  )
}

export { Button, buttonVariants }
