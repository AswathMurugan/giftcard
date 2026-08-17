/**
 * USE CASE — DatePicker
 *
 * Reference only. Read before adding a date field.
 *
 * DS rules shown here:
 * - Use the `DatePicker` primitive (input-styled trigger + popover calendar);
 *   don't hand-wire Popover + Calendar.
 * - The trigger matches Input (8px radius, 16px, gold focus, Nucleo calendar
 *   glyph). Pair with a `<Label htmlFor>`.
 * - `mode="range"` for a from/to range (selected cells are Primary-500).
 * - `minDate` / `maxDate` bound the selectable range: out-of-range days are
 *   disabled AND month/year navigation is capped. e.g. a birth date can't be in
 *   the future → `maxDate={new Date()}`.
 */
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';

export function DatePickerUseCase() {
  const [date, setDate] = React.useState<Date>();
  const [dob, setDob] = React.useState<Date>();
  const [range, setRange] = React.useState<DateRange>();

  return (
    <div className="flex max-w-sm flex-col gap-4 p-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="as-of">As of date</Label>
        <DatePicker id="as-of" value={date} onChange={setDate} placeholder="Pick a date" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dob">Date of birth</Label>
        {/* No future dates: days after today are disabled + nav caps at today. */}
        <DatePicker id="dob" value={dob} onChange={setDob} maxDate={new Date()} placeholder="Pick a date" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="period">Reporting period</Label>
        <DatePicker
          id="period"
          mode="range"
          value={range}
          onChange={setRange}
          numberOfMonths={2}
          placeholder="Pick a range"
        />
      </div>
    </div>
  );
}

export default DatePickerUseCase;
