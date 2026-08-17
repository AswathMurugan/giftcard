"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

// Aligned to the JiffyAI Design System tab spec (PHX-3941). The DS uses FLAT
// tabs, not segmented pills — two styles:
//   underline (default) → flat row, active = gold text + 2px gold underline.
//   header              → folder tabs in a gray-100 bar; active = white bg.
// `pill` keeps the shadcn segmented look as a non-DS extension.
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit text-muted-foreground group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        // Underline tabs — DS default. Flat, bottom-aligned, gap-6.
        underline: "items-end gap-6 bg-transparent",
        // Header / folder tabs — sit in a gray bar above a white panel.
        header: "items-end gap-1 bg-grayscale-100 pl-6 pr-4",
        // Segmented pill (shadcn original) — kept as a non-DS extension.
        pill: "items-center justify-center rounded-lg bg-muted p-[0.1875rem] group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit",
      },
    },
    defaultVariants: {
      variant: "underline",
    },
  }
)

function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Base — DS: 16px, weight 400, ink text, gold hover; gold focus ring
        // for a11y (the DS preview omits it but we keep it).
        "relative inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap text-md font-normal text-foreground transition-[color,background-color,border-color,font-weight] duration-150 outline-none hover:text-primary-600 focus-visible:ring-[3px] focus-visible:ring-primary-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.125rem]",

        // ── Underline (default) ──────────────────────────────────────────
        "group-data-[variant=underline]/tabs-list:rounded-none group-data-[variant=underline]/tabs-list:border-b-2 group-data-[variant=underline]/tabs-list:border-transparent group-data-[variant=underline]/tabs-list:px-0 group-data-[variant=underline]/tabs-list:pt-0 group-data-[variant=underline]/tabs-list:pb-2 group-data-[variant=underline]/tabs-list:data-active:border-primary group-data-[variant=underline]/tabs-list:data-active:font-bold group-data-[variant=underline]/tabs-list:data-active:text-primary",

        // ── Header / folder ──────────────────────────────────────────────
        "group-data-[variant=header]/tabs-list:px-[1.125rem] group-data-[variant=header]/tabs-list:py-[0.8125rem] group-data-[variant=header]/tabs-list:leading-none group-data-[variant=header]/tabs-list:data-active:bg-card group-data-[variant=header]/tabs-list:data-active:font-bold group-data-[variant=header]/tabs-list:data-active:text-primary",

        // ── Pill (shadcn segmented, non-DS) ──────────────────────────────
        "group-data-[variant=pill]/tabs-list:h-[calc(100%-1px)] group-data-[variant=pill]/tabs-list:flex-1 group-data-[variant=pill]/tabs-list:rounded-md group-data-[variant=pill]/tabs-list:px-1.5 group-data-[variant=pill]/tabs-list:py-0.5 group-data-[variant=pill]/tabs-list:text-sm group-data-[variant=pill]/tabs-list:font-normal group-data-[variant=pill]/tabs-list:text-foreground/60 group-data-[variant=pill]/tabs-list:hover:text-foreground group-data-[variant=pill]/tabs-list:data-active:bg-background group-data-[variant=pill]/tabs-list:data-active:text-foreground group-data-[variant=pill]/tabs-list:data-active:shadow-sm group-data-vertical/tabs:group-data-[variant=pill]/tabs-list:w-full group-data-vertical/tabs:group-data-[variant=pill]/tabs-list:justify-start",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content> &
  Pick<VariantProps<typeof tabsListVariants>, "variant">) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "flex-1 text-md outline-none",
        // Header tabs merge into a white content panel below the gray bar.
        variant === "header" && "bg-card p-[1.375rem]",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
