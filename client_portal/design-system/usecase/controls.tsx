/**
 * USE CASE — Checkbox / Radio / Switch (selection controls)
 *
 * Reference only. Read before adding boolean / choice controls.
 *
 * DS rules shown here:
 * - All three are 24px hit targets with a 2px gold focus ring; checked state is
 *   Primary-500. Styling is baked in — don't restyle.
 * - Each control gets an associated `<Label htmlFor>`; clicking the label
 *   toggles the control.
 * - Use Checkbox for independent booleans, RadioGroup for one-of-many, Switch
 *   for an instant on/off setting.
 */
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

export function ControlsUseCase() {
  return (
    <div className="flex max-w-sm flex-col gap-6 p-6">
      {/* Checkbox — independent boolean */}
      <div className="flex items-center gap-2">
        <Checkbox id="terms" />
        <Label htmlFor="terms">I agree to the terms</Label>
      </div>

      {/* RadioGroup — one of many */}
      <RadioGroup defaultValue="monthly">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="monthly" id="r-monthly" />
          <Label htmlFor="r-monthly">Monthly statements</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="quarterly" id="r-quarterly" />
          <Label htmlFor="r-quarterly">Quarterly statements</Label>
        </div>
      </RadioGroup>

      {/* Switch — instant setting */}
      <div className="flex items-center justify-between">
        <Label htmlFor="notify">Email notifications</Label>
        <Switch id="notify" defaultChecked />
      </div>
    </div>
  );
}

export default ControlsUseCase;
