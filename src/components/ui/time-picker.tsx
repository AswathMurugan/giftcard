"use client"

import { useCallback } from "react"

import { cn } from "@/lib/utils"

/**
 * TimePicker — the design-system stepper: hour / minute columns with up/down
 * Nucleo chevrons and a value chip, plus an AM/PM column in 12-hour mode.
 *
 * Controlled via `value` ("HH:mm", 24-hour) + `onChange`. The 12h/24h prop
 * only changes the display + whether the AM/PM column shows; the emitted
 * value is always 24-hour "HH:mm" so it round-trips with `<input type=time>`
 * and the backend.
 */

export interface TimeParts {
  hour: number // 0–23
  minute: number // 0–59
}

/** Parse "HH:mm" → parts; tolerant of bad input (falls back to 00:00). */
export function parseTime(value: string | undefined): TimeParts {
  if (!value) return { hour: 0, minute: 0 }
  const [h, m] = value.split(":")
  const hour = Math.min(23, Math.max(0, Number(h) || 0))
  const minute = Math.min(59, Math.max(0, Number(m) || 0))
  return { hour, minute }
}

/** Parts → "HH:mm" (zero-padded). */
export function formatTime({ hour, minute }: TimeParts): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(hour)}:${p(minute)}`
}

/** Wrap a number into [0, mod). */
export function wrap(n: number, mod: number): number {
  return ((n % mod) + mod) % mod
}

/** 24h hour → 12h display {h12 (1–12), meridiem}. */
export function to12h(hour: number): { h12: number; meridiem: "AM" | "PM" } {
  const meridiem = hour < 12 ? "AM" : "PM"
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return { h12, meridiem }
}

/** 12h {h12, meridiem} → 24h hour. */
export function from12h(h12: number, meridiem: "AM" | "PM"): number {
  const base = h12 % 12 // 12 → 0
  return meridiem === "PM" ? base + 12 : base
}

export interface TimePickerProps {
  /** 24-hour "HH:mm". */
  value?: string
  onChange?: (value: string) => void
  /** 12-hour display with AM/PM column. Default false (24h). */
  hour12?: boolean
  /** Minute step for the steppers. Default 1. */
  minuteStep?: number
  disabled?: boolean
  className?: string
}

function StepCol({
  display,
  onUp,
  onDown,
  disabled,
  label,
}: {
  display: string
  onUp: () => void
  onDown: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled}
        onClick={onUp}
        className="grid size-[1.875rem] place-content-center rounded-full border-[1.5px] border-input bg-card text-grayscale-600 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      >
        <i aria-hidden="true" className="icon icon_-Tb_chevron_up text-[1.125rem]" />
      </button>
      <div className="grid h-9 min-w-11 place-content-center rounded-md border border-border bg-card px-2.5 text-md font-semibold text-foreground tabular-nums">
        {display}
      </div>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled}
        onClick={onDown}
        className="grid size-[1.875rem] place-content-center rounded-full border-[1.5px] border-input bg-card text-grayscale-600 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      >
        <i aria-hidden="true" className="icon icon_-Tb_chevron_down text-[1.125rem]" />
      </button>
    </div>
  )
}

export function TimePicker({
  value,
  onChange,
  hour12 = false,
  minuteStep = 1,
  disabled,
  className,
}: TimePickerProps) {
  const parts = parseTime(value)

  // Handlers recompute parts from the current `value` so they only depend on
  // primitive props — stable identities across renders (no per-render arrows
  // at the StepCol call sites).
  const hourUp = useCallback(() => {
    const p = parseTime(value)
    onChange?.(formatTime({ ...p, hour: wrap(p.hour + 1, 24) }))
  }, [value, onChange])
  const hourDown = useCallback(() => {
    const p = parseTime(value)
    onChange?.(formatTime({ ...p, hour: wrap(p.hour - 1, 24) }))
  }, [value, onChange])
  const minuteUp = useCallback(() => {
    const p = parseTime(value)
    onChange?.(formatTime({ ...p, minute: wrap(p.minute + minuteStep, 60) }))
  }, [value, onChange, minuteStep])
  const minuteDown = useCallback(() => {
    const p = parseTime(value)
    onChange?.(formatTime({ ...p, minute: wrap(p.minute - minuteStep, 60) }))
  }, [value, onChange, minuteStep])
  const toggleMeridiem = useCallback(() => {
    const p = parseTime(value)
    onChange?.(formatTime({ ...p, hour: wrap(p.hour + 12, 24) }))
  }, [value, onChange])

  const { h12, meridiem } = to12h(parts.hour)
  const hourDisplay = hour12
    ? String(h12).padStart(2, "0")
    : String(parts.hour).padStart(2, "0")
  const minuteDisplay = String(parts.minute).padStart(2, "0")

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center gap-3.5 rounded-[0.625rem] border border-border p-4",
        className
      )}
      data-disabled={disabled || undefined}
    >
      <StepCol
        label="hour"
        display={hourDisplay}
        onUp={hourUp}
        onDown={hourDown}
        disabled={disabled}
      />
      <div className="mt-0 pb-0.5 text-lg font-semibold text-foreground">:</div>
      <StepCol
        label="minute"
        display={minuteDisplay}
        onUp={minuteUp}
        onDown={minuteDown}
        disabled={disabled}
      />
      {hour12 && (
        <StepCol
          label="meridiem"
          display={meridiem}
          onUp={toggleMeridiem}
          onDown={toggleMeridiem}
          disabled={disabled}
        />
      )}
    </div>
  )
}
