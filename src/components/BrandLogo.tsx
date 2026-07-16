import { Link } from "react-router-dom"
import { ROUTES } from "@/routes"
import { cn } from "@/lib/utils"

interface BrandLogoProps {
  /** Render as a non-clickable mark (no Link wrapping). */
  staticMark?: boolean
  className?: string
  /**
   * Visual size — controls SVG height. Defaults to "md" (h-7).
   */
  size?: "sm" | "md" | "lg"
  /** Override the link target when not in static mode. */
  to?: string
}

const sizeClasses: Record<NonNullable<BrandLogoProps["size"]>, string> = {
  sm: "h-5",
  md: "h-7",
  lg: "h-9"
}

export function BrandLogo({
  staticMark = false,
  className,
  size = "md",
  to = ROUTES.OVERVIEW
}: BrandLogoProps) {
  const sizeCls = sizeClasses[size]

  // Two SVGs: dark text on light bg (default), white text on dark bg (.dark).
  // Tailwind's dark variant flips visibility based on the .dark class on <html>.
  const inner = (
    <>
      <img
        src="/jobjen-logo-dark.svg"
        alt="Jobjen"
        className={cn(sizeCls, "w-auto block dark:hidden select-none")}
        draggable={false}
      />
      <img
        src="/jobjen-logo.svg"
        alt="Jobjen"
        className={cn(sizeCls, "w-auto hidden dark:block select-none")}
        draggable={false}
      />
    </>
  )

  const baseCls = cn(
    "inline-flex items-center",
    !staticMark && "cursor-pointer transition-opacity hover:opacity-90",
    className
  )

  if (staticMark) {
    return (
      <span className={cn(baseCls, "cursor-default")} aria-label="Jobjen">
        {inner}
      </span>
    )
  }

  return (
    <Link to={to} aria-label="Jobjen" className={baseCls}>
      {inner}
    </Link>
  )
}
