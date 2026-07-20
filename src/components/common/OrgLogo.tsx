import { cn } from "@/lib/utils"

/**
 * Standardised box for an ORG-UPLOADED logo. The one place that sizing is
 * decided in this portal.
 *
 * Deliberately NOT `BrandLogo`: that renders the PLATFORM's own two SVGs, whose
 * dimensions we control, so a bare `h-7 w-auto` is safe there. These are
 * customer uploads at whatever aspect ratio they had to hand: a 5:1 wordmark, a
 * 1:1 app icon, the occasional tall crest.
 *
 * WHY A FIXED BOX AND NOT `h-8 w-auto`: constraining the height alone lets each
 * ratio claim a different slice of the layout, so the same nav reads enormous
 * for one tenant and tiny for the next. Bounding BOTH axes and letting
 * `object-contain` fit the art inside gives every tenant the same footprint — a
 * wordmark fills the width, an icon fills the height, and neither can overflow
 * or dominate.
 *
 * Keep `SIZES` in step with the apply portal's `TenantLogo`: separate packages,
 * but the same candidate sees both.
 */
/**
 * Sized for TIGHTLY-CROPPED artwork. Uploads are trimmed of transparent
 * padding (`imageTrim.ts`), so the whole box is now real ink — the mark reads
 * far larger at a given height than an untrimmed file did at the same number.
 * These came down after trimming shipped: 44px looked correct while half the
 * canvas was empty, and overbearing once it wasn't.
 */
const SIZES = {
  /** Dense chrome. */
  sm: { box: "h-5 max-w-28", fallback: "h-6 w-6 text-[11px]" },
  /** Default: sidebar and nav bars. Mirrored by the apply portal. */
  md: { box: "h-6.5 max-w-36", fallback: "h-7 w-7 text-[13px]" },
  /** Hero: the login screen. */
  lg: { box: "h-8 max-w-44", fallback: "h-9 w-9 text-[14px]" },
} as const

export type OrgLogoSize = keyof typeof SIZES

/** First letter of each of the first two words — the no-logo avatar. */
function orgInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "?"
  )
}

interface OrgLogoProps {
  /**
   * The org's uploaded logo. Routinely absent (the backend defaults it to `""`
   * rather than omitting it), so the initials fallback is the common path, not
   * an edge case.
   */
  logoUrl?: string | null
  /** Used for `alt`/`title`, and for the initials fallback. */
  name: string
  size?: OrgLogoSize
  className?: string
}

export function OrgLogo({
  logoUrl,
  name,
  size = "md",
  className,
}: OrgLogoProps) {
  const { box, fallback } = SIZES[size]

  if (!logoUrl) {
    return (
      <span
        title={name}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground",
          fallback,
          className,
        )}
      >
        {orgInitials(name)}
      </span>
    )
  }

  return (
    // Dark-mode legibility: orgs upload ONE logo, usually dark ink on a
    // transparent background, so on the dark theme it sits on a white plate.
    //
    // The plate is the OUTER element and the sized box is nested inside it, so
    // the padding grows the plate outwards instead of eating into the logo.
    // With padding on the sized box itself the same logo rendered smaller in
    // dark mode than in light, which is the theme-dependent sizing this
    // component exists to prevent.
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md dark:bg-white dark:px-2 dark:py-1.5",
        className,
      )}
    >
      <span className={cn("inline-flex items-center", box)}>
        <img
          src={logoUrl}
          alt={name}
          title={name}
          /* `h-full`, NOT `max-h-full`: a max only ever shrinks, so a logo whose
             intrinsic size is under the box rendered at its natural size and
             looked tiny. `h-full` scales it UP to fill the box; `w-auto` keeps
             the ratio; `max-w-full` caps a very wide wordmark, and
             `object-contain` letterboxes it rather than distorting. */
          className="h-full w-auto max-w-full object-contain"
          draggable={false}
        />
      </span>
    </span>
  )
}
