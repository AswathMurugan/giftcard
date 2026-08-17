/**
 * Which of MY organisations am I looking at?
 *
 * Not an identity picker any more. It renders only when the signed-in account
 * is genuinely entitled to more than one client — a group buyer covering two
 * brands, or a Fiserv operator whose job is to work every client's orders. A
 * client with one grant sees their own name and nothing to change.
 *
 * An operator grant is labelled as such rather than left to the reader, so a
 * Fiserv session is never mistaken for the client's own view of their data.
 */
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Badge } from '@/components/ui/badge';
import { useClientSession } from './client-session';

export function ClientSwitcher() {
  const { clientId, clientName, options, isLoading, canSwitch, isOperator, setClientId } =
    useClientSession();

  if (isLoading) return null;

  // One grant: the portal simply IS this client. Show who, offer nothing.
  if (!canSwitch) {
    if (!clientName) return null;
    return (
      <div className="flex items-center gap-2" data-testid="client-identity">
        <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Signed in as
        </span>
        <span className="text-[14px] font-bold text-foreground">{clientName}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" data-testid="client-switcher">
      {isOperator ? (
        <Badge variant="outline" data-testid="operator-mode">
          Operator
        </Badge>
      ) : null}
      <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {isOperator ? 'Acting for' : 'Viewing'}
      </span>
      <SearchableSelect
        value={clientId}
        onValueChange={setClientId}
        options={options.map((o) => ({ label: o.name, value: o.id }))}
        placeholder="Choose client"
        searchPlaceholder="Search clients"
        aria-label={isOperator ? 'Acting for client' : 'Viewing client'}
      />
    </div>
  );
}
