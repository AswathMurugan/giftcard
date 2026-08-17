import * as React from "react"

import { cn } from "@/lib/utils"
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-2.5", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        // DS .jf-dt__page-box (active) vs plain numeral (inactive): the
        // current page is a bordered gray-300 box, weight 600, ink.
        "inline-grid h-[2.125rem] min-w-[2.375rem] cursor-pointer place-content-center rounded-[0.5rem] px-2 text-md text-foreground transition-colors",
        isActive
          ? "border border-grayscale-300 font-semibold"
          : "text-grayscale-500 hover:bg-grayscale-100 hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

// DS pager prev/next (.jf-dt__pager-btn): 30px circle, fg-3, hover gray-100.
const pagerButtonClass =
  "inline-grid size-[1.875rem] cursor-pointer place-content-center rounded-full text-grayscale-500 transition-colors hover:bg-grayscale-100 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg:not([class*='size-'])]:size-[1.375rem]"

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<"a">) {
  return (
    <a
      aria-label="Go to previous page"
      data-slot="pagination-previous"
      className={cn(pagerButtonClass, className)}
      {...props}
    >
      <ChevronLeftIcon />
    </a>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<"a">) {
  return (
    <a
      aria-label="Go to next page"
      data-slot="pagination-next"
      className={cn(pagerButtonClass, className)}
      {...props}
    >
      <ChevronRightIcon />
    </a>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-[2.125rem] items-center justify-center text-grayscale-500 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon
      />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
