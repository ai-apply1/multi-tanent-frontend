import { Mail, ShieldCheck } from "lucide-react"
import { useAuth } from "@/features/auth/AuthContext"
import { EmailTemplatesCard } from "@/features/organization/components/EmailTemplatesCard"

/**
 * The candidate-email template editor + live preview, as its own top-level
 * destination (like Hiring Pipeline / Manage Team) rather than a Settings tab.
 * The editor and its side-by-side preview want the full page width, and it owns
 * its own writes, so it never belonged under the shared Settings Save bar.
 *
 * `EmailTemplatesCard` holds all the logic; this page is the header + shell.
 */
export function EmailTemplatesPage() {
  const { user } = useAuth()
  const canWrite = user?.role === "org_admin"
  // `EmailTemplatesCard` fetches the template list on mount with no `enabled`
  // gate, and the backend 403s that list for anyone below hr — so the card has
  // to stay unmounted rather than render an error, the way TeamPage bails
  // before its own query for a non-admin.
  const canRead = user?.role === "org_admin" || user?.role === "hr"

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      <div className="mb-5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex text-primary">
            <Mail className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </span>
          <h1 className="text-[23px] font-semibold tracking-tight text-ink">
            Email templates
          </h1>
        </div>
        <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
          Customise the wording of the emails your candidates receive. The
          layout, your logo and colours stay on brand. Use the merge fields to
          drop in each candidate's details.
        </p>
      </div>

      {canRead ? (
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <EmailTemplatesCard canWrite={canWrite} />
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
              <ShieldCheck className="h-6 w-6" strokeWidth={1.7} />
            </span>
            <h3 className="text-[16px] font-semibold text-ink">
              Not available for your role
            </h3>
            <p className="max-w-[340px] text-[13.5px] text-ink-muted">
              Your role doesn&apos;t include email templates. Ask an org admin
              or a recruiter in your organization to review or change them.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
