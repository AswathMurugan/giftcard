/**
 * Which of MY suppliers am I looking at?
 *
 * Not an identity picker any more. It renders only when the signed-in account
 * is genuinely entitled to more than one supplier — an agency acting for two
 * of them, or a Fiserv operator whose job is to work every supplier's orders.
 * A supplier with one grant sees their own name and nothing to change.
 *
 * The distinction is drawn in the label rather than left to the reader:
 * "Viewing as" on an operator grant is an admin capability and says so, so
 * nobody mistakes a Fiserv session for a supplier's own view.
 */
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Badge } from '@/components/ui/badge';
import { useSupplierSession } from './supplier-session';

export function SupplierSwitcher() {
  const { supplierId, supplierName, options, isLoading, canSwitch, isOperator, setSupplierId } =
    useSupplierSession();

  if (isLoading) return null;

  // One grant: the portal simply IS this supplier. Show who, offer nothing.
  if (!canSwitch) {
    if (!supplierName) return null;
    return (
      <div className="flex items-center gap-2" data-testid="supplier-identity">
        <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Signed in as
        </span>
        <span className="text-[14px] font-bold text-foreground">{supplierName}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" data-testid="supplier-switcher">
      {isOperator ? (
        <Badge variant="outline" data-testid="operator-mode">
          Operator
        </Badge>
      ) : null}
      <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {isOperator ? 'Acting for' : 'Viewing'}
      </span>
      <SearchableSelect
        value={supplierId}
        onValueChange={setSupplierId}
        options={options.map((o) => ({ label: o.name, value: o.id }))}
        placeholder="Choose supplier"
        searchPlaceholder="Search suppliers"
        aria-label={isOperator ? 'Acting for supplier' : 'Viewing supplier'}
      />
    </div>
  );
}
