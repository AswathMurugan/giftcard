"use client"

import * as React from "react"
import { format } from "date-fns"
import type { DateRange, Matcher } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/**
 * DatePicker — an input-styled trigger that opens the design-system
 * Calendar in a popover. Two modes:
 *   - single (default): `value` is a `Date`.
 *   - range: `value` is a `{ from, to }` DateRange.
 *
 * The trigger matches the Input field (8px radius, 16px, gold focus) and uses
 * the Nucleo calendar glyph. Drop it anywhere a date input is needed instead
 * of hand-wiring Popover + Calendar.
 */

type SingleProps = {
  mode?: "single"
  value?: Date
  onChange?: (date: Date | undefined) => void
}

type RangeProps = {
  mode: "range"
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
}

type DatePickerProps = (SingleProps | RangeProps) & {
  placeholder?: string
  /** date-fns format for the displayed value. Default `MMM d, yyyy`. */
  dateFormat?: string
  disabled?: boolean
  className?: string
  /** Number of months to show (2 = dual-month range). */
  numberOfMonths?: number
  id?: string
  /** Earliest selectable date (inclusive). Days before it are disabled and
   *  the calendar can't navigate past it. */
  minDate?: Date
  /** Latest selectable date (inclusive). Days after it are disabled and the
   *  calendar can't navigate past it — e.g. a birth date: `maxDate={new Date()}`. */
  maxDate?: Date
  /** Draws the gold required left-border marker (matches Input/Textarea). */
  required?: boolean
}

function formatSingle(d: Date | undefined, fmt: string) {
  return d ? format(d, fmt) : ""
}

function formatRange(r: DateRange | undefined, fmt: string) {
  if (!r?.from) return ""
  if (!r.to) return format(r.from, fmt)
  return `${format(r.from, fmt)} – ${format(r.to, fmt)}`
}

export function DatePicker(props: DatePickerProps) {
  const {
    placeholder = "Select date",
    dateFormat = "MMM d, yyyy",
    disabled,
    className,
    numberOfMonths,
    id,
    minDate,
    maxDate,
    required,
  } = props
  const [open, setOpen] = React.useState(false)

  // Constrain the selectable range: disable out-of-range days AND cap month /
  // year navigation to the bounds (so you can't page to a disabled month).
  const rangeBounds = React.useMemo(() => {
    const matchers: Matcher[] = []
    if (minDate) matchers.push({ before: minDate })
    if (maxDate) matchers.push({ after: maxDate })
    const from =
      props.mode === "range"
        ? (props.value as DateRange | undefined)?.from
        : (props.value as Date | undefined)
    return {
      ...(matchers.length ? { disabled: matchers } : {}),
      ...(minDate ? { startMonth: minDate } : {}),
      ...(maxDate ? { endMonth: maxDate } : {}),
      ...(from ?? maxDate ?? minDate ? { defaultMonth: from ?? maxDate ?? minDate } : {}),
    }
  }, [minDate, maxDate, props])

  const isRange = props.mode === "range"
  const label = isRange
    ? formatRange(props.value as DateRange | undefined, dateFormat)
    : formatSingle(props.value as Date | undefined, dateFormat)

  const singleOnChange = isRange
    ? undefined
    : (props as SingleProps).onChange
  const handleSelectSingle = React.useCallback(
    (d: Date | undefined) => {
      singleOnChange?.(d)
      setOpen(false)
    },
    [singleOnChange]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required}
        className={cn(
          // Mirrors the Input field spec (8px radius, 16px/600, teal focus).
          "flex w-full items-center justify-between gap-2 rounded-[0.5rem] border border-input bg-card px-3 py-2.5 text-md font-semibold leading-[1.375rem] text-foreground transition-colors duration-150 outline-none focus-visible:border-teal-200 focus-visible:bg-teal-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-grayscale-400",
          // Required fields square the LEFT corners (flat gold tab; right side
          // stays rounded) — the gold bar itself is the overlay child below.
          required && "relative rounded-[0_0.5rem_0.5rem_0]",
          className
        )}
      >
        {/* Required marker: 3px gold bar overlaid on the trigger's left edge —
            a child paints above the border, reaching the exact corners. */}
        {required && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-y-px -left-px w-[3px] bg-primary"
          />
        )}
        <span className={cn(!label && "font-normal text-muted-foreground")}>
          {label || placeholder}
        </span>
        <i aria-hidden="true" className="icon icon_-Tb_calendar text-[1.125rem] text-grayscale-500" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {isRange ? (
          <Calendar
            mode="range"
            numberOfMonths={numberOfMonths ?? 2}
            selected={props.value as DateRange | undefined}
            onSelect={
              (props as RangeProps).onChange as (r: DateRange | undefined) => void
            }
            autoFocus
            {...rangeBounds}
          />
        ) : (
          <Calendar
            mode="single"
            numberOfMonths={numberOfMonths ?? 1}
            selected={props.value as Date | undefined}
            onSelect={handleSelectSingle}
            autoFocus
            {...rangeBounds}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
