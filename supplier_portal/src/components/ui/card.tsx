import * as React from "react"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Card({
  className,
  size = "default",
  config,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-3 overflow-hidden rounded-[0.5rem] border border-border bg-card p-4 text-sm text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[box-shadow] duration-150 ease-in-out hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:p-0 has-[>img:first-child]:has-data-[slot=card-header]:pb-0 data-[size=sm]:gap-2 data-[size=sm]:p-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-[0.5rem] *:[img:last-child]:rounded-b-[0.5rem]",
        c.className
      )}
      style={c.style}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      // No own horizontal padding — inherits the Card root's p-4 (p-3 for
      // size=sm). Its own px-4 doubled the inset to 32px.
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-[0.5rem] has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-md leading-[1.25rem] font-semibold text-foreground group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[0.875rem] leading-[1.45] text-grayscale-600", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      // No own padding — inherits the Card root's p-4 (or p-3 for size=sm).
      // Adding px-4 here doubled the horizontal inset to 32px.
      className={cn(className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-[0.5rem] border-t border-border p-4 group-data-[size=sm]/card:p-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
