/**
 * USE CASE — Empty state
 *
 * Reference only. Read before building a "no data yet" surface.
 *
 * Follows design-system/patterns/empty-state.html (`.jf-empty`): the brand
 * illustration with a swappable focal icon, a title, a one-line description,
 * and at most one primary action. Only the focal `icon` changes per surface —
 * the three small gold icons in the illustration are fixed.
 *
 * - Default size for full pages / list & grid landings.
 * - `size="sm"` for modals and small panels (e.g. a search with no results).
 * - Swap the Nucleo glyph (`icon_-Tb_*`) to match the surface.
 *
 * NOTE: the older icon-tile style (`Empty` + `EmptyMedia variant="icon"` from
 * `@/components/ui/empty`) still exists for dense/inline surfaces where the
 * illustration is too heavy; prefer this illustrated `EmptyState` for primary
 * empty surfaces.
 */
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

export function EmptyStateUseCase() {
  return (
    <div className="flex flex-col gap-12 p-6">
      {/* Default — full page / list / grid landing, with a primary action. */}
      <EmptyState
        icon="icon_-Tb_users_group"
        title="No clients yet"
        description="Clients you add will appear here. Get started by creating your first one."
        action={
          <Button>
            <i className="icon icon_-Tb_plus text-[1.125rem]" aria-hidden="true" />
            New client
          </Button>
        }
      />

      {/* Compact — for modals & small panels (no action needed). */}
      <EmptyState
        size="sm"
        icon="icon_-Tb_file_search"
        title="No results found"
        description="Try a different search or filter."
      />
    </div>
  );
}

export default EmptyStateUseCase;
