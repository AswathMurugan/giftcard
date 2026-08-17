/**
 * USE CASE — Button (canonical on-brand usage)
 *
 * Reference only. Not routed, not bundled. Read this to see the correct way to
 * use the design system's Button before building one. Author real pages the
 * same way: shadcn `Button` + Tailwind token classes + Nucleo icons. Never
 * hand-roll a `.btn` element, never hard-code a hex/shadow.
 *
 * DS rules shown here:
 * - ONE primary (gold) action per screen. Everything else is secondary /
 *   tertiary / ghost.
 * - `default` = Primary (filled gold), `secondary` = gold outline,
 *   `tertiary`/`outline` = neutral outline, `ghost` = text/icon.
 * - Button icons are Nucleo glyphs at 18px (`text-[1.125rem]`), gap stays `gap-2`.
 * - There is no destructive button variant — use `default` with destructive
 *   copy, or an AlertDialog for the confirm step.
 */
import { Button } from '@/components/ui/button';

export function ButtonUseCase() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* One primary action per screen, sitting with secondary/tertiary. */}
      <div className="flex items-center gap-3">
        <Button>
          <i className="icon icon_-Tb_plus text-[1.125rem]" aria-hidden="true" />
          New client
        </Button>
        <Button variant="secondary">Export</Button>
        <Button variant="tertiary">Cancel</Button>
        <Button variant="ghost">
          <i className="icon icon_-Tb_dots text-[1.125rem]" aria-hidden="true" />
          More
        </Button>
      </div>

      {/* Sizes */}
      <div className="flex items-center gap-3">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="icon" aria-label="Settings">
          <i className="icon icon_-Tb_settings text-[1.25rem]" aria-hidden="true" />
        </Button>
      </div>

      {/* Disabled */}
      <div className="flex items-center gap-3">
        <Button disabled>Saving…</Button>
        <Button variant="secondary" disabled>
          Unavailable
        </Button>
      </div>
    </div>
  );
}

export default ButtonUseCase;
