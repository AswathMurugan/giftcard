/**
 * USE CASE — Input + Label + Select (a form field)
 *
 * Reference only. Read before building any form control.
 *
 * DS rules shown here:
 * - Every field control pairs with a `<Label htmlFor>` (a11y + shadcn Field
 *   styling). Stack label above control with a small gap.
 * - Input/Select are 16px/600, 8px radius, neutral border; focus tints the
 *   field teal (`bg-teal-50` + `border-teal-200`) — all baked into the
 *   primitives; don't restyle them.
 * - Required fields: pass `required` (the primitive draws a 3px gold bar on
 *   the field's left edge automatically) AND add a `*` after the label
 *   (`text-destructive`) — both markers show.
 * - Select options come from a real enum (`*_VALUES`); never invent values,
 *   never use `<SelectItem value="">` (Radix reserves the empty string).
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ACCOUNT_TYPES = ['Individual', 'Joint', 'Trust', 'Retirement'] as const;

export function InputUseCase() {
  return (
    <form className="flex max-w-sm flex-col gap-4 p-6">
      <div className="flex flex-col gap-1.5">
        {/* required → `*` on the label + automatic gold left bar on the field */}
        <Label htmlFor="client-name">
          Client name<span className="text-destructive">*</span>
        </Label>
        <Input id="client-name" placeholder="e.g. Jane Doe" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="account-type">Account type</Label>
        <Select>
          <SelectTrigger id="account-type">
            <SelectValue placeholder="Select a type" />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="jane@example.com" />
      </div>
    </form>
  );
}

export default InputUseCase;
