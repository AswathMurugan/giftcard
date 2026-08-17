/**
 * USE CASE — Card (content container)
 *
 * Reference only. Read before grouping content in a bordered surface.
 *
 * DS rules shown here:
 * - Cards are FLAT: 1px border + 8px radius do the separating, not heavy
 *   shadows. A subtle rest shadow + slightly stronger hover shadow are baked
 *   into the primitive — don't add your own.
 * - Compose with the slots (Header / Title / Description / Content / Footer);
 *   don't hand-roll padding.
 * - One primary action max inside a card footer.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function CardUseCase() {
  return (
    <div className="grid max-w-3xl gap-4 p-6 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Account summary</CardTitle>
          <CardDescription>Balances across all linked accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold tabular-nums">$1,284,920</p>
          <p className="text-sm text-muted-foreground">As of today</p>
        </CardContent>
        <CardFooter>
          <Button variant="tertiary">View details</Button>
        </CardFooter>
      </Card>

      {/* Compact card */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Pending tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">3 items need review.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default CardUseCase;
