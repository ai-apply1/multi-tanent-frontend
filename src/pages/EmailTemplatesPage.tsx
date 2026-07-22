import { Mail } from "lucide-react"
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

      <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <EmailTemplatesCard canWrite={canWrite} />
      </div>
    </div>
  )
}
