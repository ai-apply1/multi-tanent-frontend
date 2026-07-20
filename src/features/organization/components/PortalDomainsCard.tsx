import { AlertCircle, Check, Clock, Globe, MinusCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { CopyButton } from "@/components/common/CopyButton"
import type {
  OrgDomain,
  TenantDomainState,
  TenantPortal,
} from "@/features/organization/types"

/**
 * Exhaustive `Record`s rather than ternaries, so adding a state to the backend
 * enum breaks the build here instead of rendering a blank chip.
 */
const stateLabel: Record<TenantDomainState, string> = {
  live: "Live",
  pending_dns: "Awaiting DNS",
  pending_verification: "Awaiting verification",
  pending: "Setting up",
  skipped: "Not set up",
  failed: "Failed",
}

type ChipTone = "success" | "warning" | "danger" | "muted"

const stateTone: Record<TenantDomainState, ChipTone> = {
  live: "success",
  pending_dns: "warning",
  pending_verification: "warning",
  pending: "warning",
  skipped: "muted",
  failed: "danger",
}

const toneChipClass: Record<ChipTone, string> = {
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  muted: "bg-surface-3 text-ink-muted",
}

const toneIcon: Record<ChipTone, LucideIcon> = {
  success: Check,
  warning: Clock,
  danger: AlertCircle,
  muted: MinusCircle,
}

/** What each portal actually is, in the customer's terms rather than ours. */
const portalLabel: Record<TenantPortal, string> = {
  admin: "Team dashboard",
  screening: "Candidate interview",
  apply: "Careers and apply pages",
}

/** Stable display order — provisioning order isn't guaranteed by the array. */
const PORTAL_ORDER: TenantPortal[] = ["admin", "screening", "apply"]

interface PortalDomainsCardProps {
  parentDomain: string
  domains: OrgDomain[]
}

/**
 * The org's three branded portal domains and the DNS they still owe us.
 *
 * READ-ONLY. The hosts are derived from the apex the super admin set at
 * provisioning, and are registered with the hosting platform automatically —
 * there is nothing here for an HR admin to create, so the card's whole job is
 * to answer "is my branded URL live yet, and if not, what do I give my DNS
 * team?".
 *
 * The honest bit is the status vocabulary. "Awaiting DNS" is the NORMAL state
 * for days after an org is created, not a failure — the customer controls the
 * DNS and we cannot make it resolve any faster. Only `live` means the URL
 * actually works, which is why nothing here shows a green tick until then.
 */
export function PortalDomainsCard({
  parentDomain,
  domains,
}: PortalDomainsCardProps) {
  if (domains.length === 0) return null

  const ordered = [...domains].sort(
    (a, b) => PORTAL_ORDER.indexOf(a.portal) - PORTAL_ORDER.indexOf(b.portal),
  )
  const liveCount = ordered.filter((d) => d.state === "live").length
  const allLive = liveCount === ordered.length

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">Portal domains</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
            Your branded addresses on{" "}
            <span className="mono text-ink-2">{parentDomain}</span>. Point each
            host at the target below with your DNS provider, then they go live
            on their own.
          </p>
        </div>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold " +
            (allLive ? toneChipClass.success : toneChipClass.warning)
          }
        >
          {allLive ? (
            <Check className="h-3.5 w-3.5" strokeWidth={1.9} />
          ) : (
            <Clock className="h-3.5 w-3.5" strokeWidth={1.9} />
          )}
          {liveCount} of {ordered.length} live
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {ordered.map((d) => {
          const tone = stateTone[d.state]
          const StateIcon = toneIcon[tone]
          return (
            <div
              key={d.portal}
              className="rounded-xl border border-line bg-surface-2 p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Globe
                    className="h-3.5 w-3.5 shrink-0 text-ink-subtle"
                    strokeWidth={1.7}
                  />
                  <span className="mono truncate text-[13px] text-ink">
                    {d.host}
                  </span>
                </div>
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold " +
                    toneChipClass[tone]
                  }
                >
                  <StateIcon className="h-3 w-3" strokeWidth={1.9} />
                  {stateLabel[d.state]}
                </span>
              </div>
              <div className="mt-1 pl-[22px] text-[12px] text-ink-subtle">
                {portalLabel[d.portal]}
              </div>

              {/* The CNAME is per-domain, never shared — see the type's note. */}
              {d.state !== "live" && d.cnameTarget ? (
                <div className="mt-3 grid grid-cols-[52px_1fr_auto] items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] mono">
                  <span className="font-semibold text-ink">CNAME</span>
                  <span className="truncate text-ink-2" title={d.cnameTarget}>
                    {d.cnameTarget}
                  </span>
                  <CopyButton value={d.cnameTarget} label="CNAME target" />
                </div>
              ) : null}

              {/* Only present when another account already claims the apex, in
                  which case a TXT challenge proves ownership. Rare, and
                  impossible to guess at, so it is shown verbatim. */}
              {d.verification.map((v) => (
                <div
                  key={`${v.type}-${v.domain}`}
                  className="mt-2 grid grid-cols-[52px_1fr_auto] items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] mono"
                >
                  <span className="font-semibold text-ink">{v.type}</span>
                  <span className="truncate text-ink-2" title={v.value}>
                    {v.value}
                  </span>
                  <CopyButton value={v.value} label={`${v.type} value`} />
                </div>
              ))}

              {d.error ? (
                <p className="mt-2 text-[12px] text-[var(--danger)]">
                  {d.error}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[12px] text-ink-subtle">
        DNS changes can take a few hours to spread. We keep checking on our own,
        so you can close this page.
      </p>
    </div>
  )
}
