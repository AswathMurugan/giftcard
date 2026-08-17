"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCustomization } from "@/config/customization/use-customization"
import type { Slot as CfgSlot } from "@/config/customization/types"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  config,
  style,
  disabled,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Optional customization slot — makes this instance admin-customizable. */
  config?: CfgSlot
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  const c = useCustomization(config, className, style)
  if (c.hidden) return null

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      disabled={c.config?.disabled ?? disabled}
      className={cn(
        "group/slider relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        c.className
      )}
      style={c.style}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-grayscale-200 data-horizontal:h-2 data-horizontal:w-full data-vertical:h-full data-vertical:w-2"
      >
        {/* DS: fill lightens to primary-400 on hover/focus of the root. */}
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full group-hover/slider:bg-primary-400 group-focus-within/slider:bg-primary"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          // DS thumb: 20px, 2px gold border, soft 6px primary-100 halo on
          // hover/focus/active; border lightens to primary-400 on hover.
          className="relative block size-5 shrink-0 rounded-full border-2 border-primary bg-card ring-primary-100 transition-[color,box-shadow,border-color] select-none after:absolute after:-inset-2 hover:border-primary-400 hover:ring-[6px] focus-visible:ring-[6px] focus-visible:outline-hidden active:ring-[6px] disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
