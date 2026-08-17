import type * as React from "react"

import { cn } from "@/lib/utils"
import emptyStateIllustration from "@/assets/empty-state-illustration.svg"

/**
 * JiffyAI empty state — design-system pattern `.jf-empty`
 * (design-system/patterns/empty-state.html).
 *
 * The brand illustration with a swappable focal icon, a title, a description,
 * and an optional action. Use on any landing page / list / grid / panel /
 * modal that has no data yet. Generalize the title/description/action per
 * surface; ONLY the focal `icon` (a Nucleo glyph class, e.g. `icon_-Tb_files`)
 * changes per page/module — the three small gold icons in the illustration are
 * fixed. Pass `size="sm"` for the compact variant in modals & small panels.
 *
 * @example
 * <EmptyState
 *   icon="icon_-Tb_files"
 *   title="No documents yet"
 *   description="Files you upload will appear here."
 *   action={<Button><i className="icon icon_-Tb_plus" /> Upload</Button>}
 * />
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  size = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  /** Nucleo focal-icon class, e.g. `icon_-Tb_files`. Sits on the white circle. */
  icon?: string
  title: React.ReactNode
  description?: React.ReactNode
  /** Optional call-to-action, usually a <Button>. */
  action?: React.ReactNode
  size?: "default" | "sm"
}) {
  const sm = size === "sm"
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "mx-auto flex max-w-[23.75rem] flex-col items-center gap-1 text-center",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "relative",
          sm ? "mb-2 h-[7.3125rem] w-[10.5rem]" : "mb-3 h-[10.4375rem] w-[15rem]"
        )}
      >
        <img
          src={emptyStateIllustration}
          alt=""
          aria-hidden="true"
          className="block h-full w-full"
        />
        {icon && (
          <i
            className={cn("icon absolute leading-none text-grayscale-500", icon)}
            style={{
              left: "55.78%",
              top: "37.61%",
              transform: "translate(-50%, -50%)",
              fontSize: sm ? 21 : 30,
            }}
            aria-hidden="true"
          />
        )}
      </div>
      <h2 className="m-0 text-[1rem] font-semibold text-foreground">{title}</h2>
      {description && (
        <p
          className={cn(
            "m-0 font-normal leading-[1.5] text-pretty text-muted-foreground",
            action && "mb-4",
            sm ? "text-[0.8125rem]" : "text-[1rem]"
          )}
        >
          {description}
        </p>
      )}
      {action}
    </div>
  )
}

export { EmptyState }
