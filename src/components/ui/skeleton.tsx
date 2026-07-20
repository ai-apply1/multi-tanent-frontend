import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Skeleton — a single shimmering placeholder block.
 *
 * The building block for the per-page loading skeletons that stand in for
 * real content while a query is in flight. It carries only the shimmer and a
 * default fill; every skeleton is SIZED at the call site with utility classes
 * (`h-*`, `w-*`, `rounded-*`) so it mirrors the exact element it replaces —
 * an avatar is a circle, a title is a short bar, a pill is a rounded-full
 * block of the same width the real chip would be.
 *
 * `bg-surface-3` is the same fill the hand-rolled skeletons on Pipeline and
 * Job detail already use, so every page's loading state reads as one system.
 * `animate-pulse` is Tailwind's built-in and lives on each block, so a
 * skeleton is self-contained — no need for a pulsing wrapper around it.
 */
export const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden
    className={cn("animate-pulse rounded-md bg-surface-3", className)}
    {...props}
  />
))
Skeleton.displayName = "Skeleton"
