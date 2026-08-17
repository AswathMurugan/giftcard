/**
 * USE CASE — Badge (status + categorical tags)
 *
 * Reference only. Read before rendering any tag/status pill.
 *
 * DS rules shown here:
 * - STATUS uses the semantic variants: `success`, `info`, `warning`,
 *   `destructive`, plus `default` (gold) / `secondary` (neutral).
 * - CATEGORY values (e.g. a "Segment" column) use the extended families
 *   `teal` / `purple` / `pink` / `tan`. Assign a hue PER VALUE manually — map
 *   each distinct category to one colour. NEVER auto-map a category to a
 *   semantic status (e.g. "High Net Worth" must NOT render as `destructive`).
 */
import { Badge } from '@/components/ui/badge';

// Status pill driven by data — pick the variant from the value, not by index.
type AccountStatus = 'Active' | 'Pending' | 'On Hold' | 'Closed';

const STATUS_VARIANT: Record<AccountStatus, 'success' | 'info' | 'warning' | 'destructive'> = {
  Active: 'success',
  Pending: 'info',
  'On Hold': 'warning',
  Closed: 'destructive',
};

// Category → colour: a deliberate, stable mapping authored by hand.
const SEGMENT_VARIANT: Record<string, 'teal' | 'purple' | 'pink' | 'tan'> = {
  'High Net Worth': 'purple',
  'Mass Affluent': 'teal',
  Retail: 'tan',
  Institutional: 'pink',
};

export function BadgeUseCase() {
  const statuses: AccountStatus[] = ['Active', 'Pending', 'On Hold', 'Closed'];
  const segments = Object.keys(SEGMENT_VARIANT);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Status */}
      <div className="flex flex-wrap items-center gap-2">
        {statuses.map((s) => (
          <Badge key={s} variant={STATUS_VARIANT[s]}>
            {s}
          </Badge>
        ))}
      </div>

      {/* Categorical (per-value colour) */}
      <div className="flex flex-wrap items-center gap-2">
        {segments.map((seg) => (
          <Badge key={seg} variant={SEGMENT_VARIANT[seg]}>
            {seg}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default BadgeUseCase;
