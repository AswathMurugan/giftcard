import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Label({
  className,
  config,
  style,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & {
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-md leading-6 font-normal text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        c.className
      )}
      style={c.style}
      {...props}
    >
      {c.config?.label ? c.config.label : children}
    </LabelPrimitive.Root>
  )
}

export { Label }
