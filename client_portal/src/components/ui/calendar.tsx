"use client"

import * as React from "react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// View drill-down state: the day grid, the month grid (Image 3), and the
// year grid (Image 2). Clicking the day-view caption opens "years"; picking a
// year advances to "months"; picking a month returns to "days".
type CalendarView = "days" | "months" | "years"

// Years shown per page in the year grid: 18 in a 3-col × 6-row layout,
// matching the DS picker ("2008-2025").
const YEARS_PER_PAGE = 18

// Shared inner width for all three views (day grid, month grid, year grid) so
// the popover keeps a constant size as you drill down. DS spec: the popover is
// 300px wide with 18px side padding → 300 − 18 − 18 = 264px grid area.
const GRID_WIDTH = "w-[16.5rem]"

// Shared card chrome so all three views size + frame identically. Border + bg
// are dropped inside a popover/card (the host provides those), but the padding
// is KEPT so the grid never sits flush against the popover edge. DS padding:
// 16px top / 18px sides / 18px bottom.
const CALENDAR_SHELL =
  "group/calendar rounded-[0.625rem] border border-border bg-background p-[1rem_1.125rem_1.125rem] [--cell-radius:9999px] [--cell-size:--spacing(9)] in-data-[slot=card-content]:border-0 in-data-[slot=card-content]:bg-transparent in-data-[slot=card-content]:p-0 in-data-[slot=popover-content]:border-0 in-data-[slot=popover-content]:bg-transparent"

/** Best-effort initial display month from the current selection. */
function pickInitialMonth(selected: unknown, fallback?: Date): Date {
  if (selected instanceof Date) return selected
  if (Array.isArray(selected) && selected[0] instanceof Date) return selected[0]
  if (
    selected &&
    typeof selected === "object" &&
    (selected as { from?: unknown }).from instanceof Date
  ) {
    return (selected as { from: Date }).from
  }
  return fallback ?? new Date()
}

function NavIcon({ name }: { name: "left" | "right" | "down" }) {
  return (
    <i
      aria-hidden="true"
      className={cn(`icon icon_-Tb_chevron_${name} text-[1.125rem]`)}
    />
  )
}

// ── Year grid (Image 2) ──────────────────────────────────────────────────────

function YearGrid({
  displayYear,
  minYear,
  maxYear,
  onPick,
}: {
  displayYear: number
  minYear: number
  maxYear: number
  onPick: (year: number) => void
}) {
  // Anchor windows so the CURRENT year sits in the last cell of its page
  // (gives "2008-2025" today), then tile by YEARS_PER_PAGE.
  const anchorYear = React.useMemo(() => new Date().getFullYear(), [])
  const startFor = React.useCallback(
    (year: number) => {
      const offset =
        (((anchorYear - year) % YEARS_PER_PAGE) + YEARS_PER_PAGE) %
        YEARS_PER_PAGE
      return year + offset - (YEARS_PER_PAGE - 1)
    },
    [anchorYear]
  )
  const [start, setStart] = React.useState(() => startFor(displayYear))
  const end = start + YEARS_PER_PAGE - 1
  const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => start + i)

  const prevDisabled = start <= minYear
  const nextDisabled = end >= maxYear

  return (
    <div className={GRID_WIDTH}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous years"
          disabled={prevDisabled}
          onClick={() => setStart(start - YEARS_PER_PAGE)}
          className="inline-grid size-7 place-content-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <NavIcon name="left" />
        </button>
        <span className="text-md font-semibold text-foreground">
          {start}-{end}
        </span>
        <button
          type="button"
          aria-label="Next years"
          disabled={nextDisabled}
          onClick={() => setStart(start + YEARS_PER_PAGE)}
          className="inline-grid size-7 place-content-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <NavIcon name="right" />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-y-3">
        {years.map((year) => {
          const disabled = year < minYear || year > maxYear
          const selected = year === displayYear
          return (
            <button
              key={year}
              type="button"
              disabled={disabled}
              onClick={() => onPick(year)}
              className={cn(
                "mx-auto flex h-9 w-[4.75rem] items-center justify-center rounded-full text-sm transition-colors",
                selected
                  ? "bg-foreground font-semibold text-background"
                  : "text-foreground hover:bg-accent",
                disabled && "pointer-events-none opacity-40"
              )}
            >
              {year}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Month grid (Image 3) ─────────────────────────────────────────────────────

function MonthGrid({
  displayYear,
  selectedYear,
  selectedMonth,
  minYear,
  maxYear,
  locale,
  onPick,
  onStepYear,
  onOpenYears,
}: {
  displayYear: number
  selectedYear: number
  selectedMonth: number
  minYear: number
  maxYear: number
  locale?: Partial<Locale>
  onPick: (month: number) => void
  onStepYear: (delta: number) => void
  onOpenYears: () => void
}) {
  // Column-major order (Jan-Jun left, Jul-Dec right) → grid-flow-col / 6 rows.
  const months = Array.from({ length: 12 }, (_, m) => m)

  return (
    <div className={GRID_WIDTH}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous year"
          disabled={displayYear - 1 < minYear}
          onClick={() => onStepYear(-1)}
          className="inline-grid size-7 place-content-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <NavIcon name="left" />
        </button>
        <button
          type="button"
          onClick={onOpenYears}
          className="rounded-md px-2 py-1 text-md font-semibold text-foreground transition-colors hover:bg-accent"
        >
          {displayYear}
        </button>
        <button
          type="button"
          aria-label="Next year"
          disabled={displayYear + 1 > maxYear}
          onClick={() => onStepYear(1)}
          className="inline-grid size-7 place-content-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <NavIcon name="right" />
        </button>
      </div>
      <div className="mt-4 grid grid-flow-col grid-cols-2 grid-rows-6 gap-y-3">
        {months.map((m) => {
          const selected = displayYear === selectedYear && m === selectedMonth
          return (
            <button
              key={m}
              type="button"
              onClick={() => onPick(m)}
              className={cn(
                "mx-auto flex h-9 w-[7.5rem] items-center justify-center rounded-full text-sm transition-colors",
                selected
                  ? "bg-foreground font-semibold text-background"
                  : "text-foreground hover:bg-accent"
              )}
            >
              {new Date(displayYear, m).toLocaleString(locale?.code, {
                month: "long",
              })}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Calendar ─────────────────────────────────────────────────────────────────

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  locale,
  formatters,
  components,
  // Year range for the year grid. Past (birthdates) + a little future
  // (due dates) reachable; callers can still override per-instance.
  startMonth = new Date(1920, 0),
  endMonth = new Date(new Date().getFullYear() + 10, 11),
  month: monthProp,
  defaultMonth,
  onMonthChange,
  selected,
  ...props
  // `react-day-picker` v9 types `DayPickerProps` as a mode-discriminated union,
  // so `selected` isn't on the common base — widen it here so this mode-agnostic
  // wrapper can read it (for the initial-month pick) and forward it below.
}: React.ComponentProps<typeof DayPicker> & { selected?: unknown }) {
  const defaultClassNames = getDefaultClassNames()

  const minYear = startMonth.getFullYear()
  const maxYear = endMonth.getFullYear()

  const [month, setMonthState] = React.useState<Date>(
    () => monthProp ?? defaultMonth ?? pickInitialMonth(selected)
  )
  const [view, setView] = React.useState<CalendarView>("days")

  // Keep internal month in sync when the caller controls `month`.
  React.useEffect(() => {
    if (monthProp) setMonthState(monthProp)
  }, [monthProp])

  const changeMonth = React.useCallback(
    (next: Date) => {
      setMonthState(next)
      onMonthChange?.(next)
    },
    [onMonthChange]
  )

  // Memoized view/drill-down handlers so the caption + grid panels receive
  // stable callback identities across renders.
  const openMonthsView = React.useCallback(() => setView("months"), [])
  const openYearsView = React.useCallback(() => setView("years"), [])

  const handlePickYear = React.useCallback(
    (year: number) => {
      changeMonth(new Date(year, month.getMonth(), 1))
      setView("months")
    },
    [changeMonth, month]
  )

  const handlePickMonth = React.useCallback(
    (m: number) => {
      changeMonth(new Date(month.getFullYear(), m, 1))
      setView("days")
    },
    [changeMonth, month]
  )

  const handleStepYear = React.useCallback(
    (delta: number) => {
      changeMonth(new Date(month.getFullYear() + delta, month.getMonth(), 1))
    },
    [changeMonth, month]
  )

  // The current selection's year/month drive the highlighted cell in the grids.
  const selectedDate = pickInitialMonth(selected, month)

  if (view === "years") {
    return (
      <div data-slot="calendar" className={cn(CALENDAR_SHELL, "w-fit", className)}>
        <YearGrid
          displayYear={month.getFullYear()}
          minYear={minYear}
          maxYear={maxYear}
          onPick={handlePickYear}
        />
      </div>
    )
  }

  if (view === "months") {
    return (
      <div data-slot="calendar" className={cn(CALENDAR_SHELL, "w-fit", className)}>
        <MonthGrid
          displayYear={month.getFullYear()}
          selectedYear={selectedDate.getFullYear()}
          selectedMonth={selectedDate.getMonth()}
          minYear={minYear}
          maxYear={maxYear}
          locale={locale}
          onPick={handlePickMonth}
          onStepYear={handleStepYear}
          onOpenYears={openYearsView}
        />
      </div>
    )
  }

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      startMonth={startMonth}
      endMonth={endMonth}
      month={month}
      onMonthChange={changeMonth}
      selected={selected as never}
      className={cn(
        // DS calendar (PHX-3941): white card, 10px radius, 1px border, 340px.
        // Day cells are 36px so the inner 32px circle has breathing room.
        cn(CALENDAR_SHELL, "w-fit"),
        className
      )}
      captionLayout="label"
      locale={locale}
      formatters={{
        // DS weekday header uses SINGLE letters (S M T W T F S); rdp's default
        // formatter renders 2-letter ("Su","Mo"). Use the narrow form.
        formatWeekdayName: (date) =>
          date.toLocaleString(locale?.code, { weekday: "narrow" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        // Fixed width so single + dual months both size to spec instead of
        // collapsing to content. Shared with the month/year grids (GRID_WIDTH).
        month: cn("flex flex-col gap-4", GRID_WIDTH, defaultClassNames.month),
        nav: cn(
          // `pointer-events-none` so the empty middle of this absolute overlay
          // doesn't swallow clicks meant for the month/year caption beneath it;
          // the chevron buttons re-enable pointer events.
          "pointer-events-none absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          // DS nav: 28px ghost square, fg-2, hover surface-alt, 6px radius.
          "pointer-events-auto inline-grid size-7 place-content-center rounded-md text-muted-foreground hover:bg-accent select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          "pointer-events-auto inline-grid size-7 place-content-center rounded-md text-muted-foreground hover:bg-accent select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          // DS header label: 16px / weight 600, ink.
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size) text-md font-semibold text-foreground",
          defaultClassNames.month_caption
        ),
        // @ts-expect-error -- 'table' exists at runtime but react-day-picker types lag behind
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          // DS weekday row (.cal__dow): 12px / 400, fg-3, 8px vertical pad + .02em tracking.
          "flex-1 py-2 text-xs font-normal tracking-[0.02em] text-muted-foreground select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] text-muted-foreground select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaultClassNames.day
        ),
        // DS range: a SOLID GOLD bar behind the cells (date-pickers.html
        // .cal__cell--in-range). The bar is drawn on the day-cell wrapper;
        // endpoints get the solid circle in the DayButton below.
        range_start: cn(
          "relative isolate z-0 bg-primary rounded-l-full",
          defaultClassNames.range_start
        ),
        range_middle: cn("bg-primary rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "relative isolate z-0 bg-primary rounded-r-full",
          defaultClassNames.range_end
        ),
        today: cn("text-foreground", defaultClassNames.today),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        // Caption: month and year are independently clickable — month opens
        // the month grid, year opens the year grid. Spaced apart, no chevron.
        MonthCaption: ({ calendarMonth, displayIndex: _displayIndex, ...divProps }) => {
          void _displayIndex
          const captionBtn =
            "rounded-md px-1.5 py-1 text-md font-semibold text-foreground transition-colors hover:bg-accent"
          return (
            <div {...divProps}>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openMonthsView}
                  className={captionBtn}
                >
                  {calendarMonth.date.toLocaleString(locale?.code, {
                    month: "long",
                  })}
                </button>
                <button
                  type="button"
                  onClick={openYearsView}
                  className={captionBtn}
                >
                  {calendarMonth.date.toLocaleString(locale?.code, {
                    year: "numeric",
                  })}
                </button>
              </span>
            </div>
          )
        },
        Chevron: ({ className, orientation }) => {
          // Nucleo icon font (the platform's icon system).
          const name =
            orientation === "left"
              ? "chevron_left"
              : orientation === "right"
                ? "chevron_right"
                : "chevron_down"
          return (
            <i
              aria-hidden="true"
              className={cn(`icon icon_-Tb_${name} text-[1.125rem]`, className)}
            />
          )
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-today={modifiers.today || undefined}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        // DS day (span.d): 14px number in a 28px circle, hover gold-50; the
        // wrapper draws the gold range bar (range_middle/start/end above).
        "relative isolate z-10 flex aspect-square size-7 min-w-7 items-center justify-center rounded-full border-0 p-0 text-[0.875rem] font-normal leading-none text-foreground transition-colors hover:bg-primary-50",
        modifiers.outside && "text-muted-foreground",
        // Today — gold (primary) filled circle with white text.
        "data-[today=true]:bg-primary data-[today=true]:text-primary-foreground",
        // Selected single (span.d) — gold #9E7B19 circle, white text, 14px / 400.
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground",
        // Range endpoints — gold circle, white text.
        "data-[range-start=true]:bg-primary data-[range-start=true]:font-semibold data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:font-semibold data-[range-end=true]:text-primary-foreground",
        // Range middle — transparent dot over the solid gold bar; white
        // weight-600 numerals (DS .cal__cell--in-range).
        "data-[range-middle=true]:bg-transparent data-[range-middle=true]:font-semibold data-[range-middle=true]:text-primary-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
