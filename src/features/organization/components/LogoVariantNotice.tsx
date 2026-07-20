import { useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { AlertTriangle, Loader2, Sparkles, Wand2 } from "lucide-react"
import { regenerateLogoVariant } from "@/features/organization/organizationApi"
import type { OrgProfile } from "@/features/organization/types"
import { errorMessage as apiError } from "@/lib/errors"

/**
 * Explains what happened to the org's two logo variants, and offers a re-run.
 *
 * ── Why this needs to exist at all ─────────────────────────────────────
 *
 * The derivation MOVES the admin's upload on the light-ink path: someone who
 * uploads a white logo finds it serving dark backgrounds with a black mark they
 * never made in the main slot. That is the correct outcome and it is completely
 * baffling without a sentence saying so. Silent correctness that looks like a
 * bug is worse than no automation.
 *
 * It is also the ONLY place the derived variant is visible. There is no upload
 * field for it any more, so without the two swatches below an admin would have
 * to deploy to find out whether the generated mark is any good.
 *
 * ── The escape hatch is the main logo, not a second upload ─────────────
 *
 * A bad derivation is fixed by replacing the logo it came from (a cleaner
 * source, ideally transparent-background artwork), then hitting Regenerate.
 * That is worth saying plainly on the failure path, because the field that used
 * to say "upload one yourself" is gone.
 */

interface LogoVariantNoticeProps {
  org: OrgProfile
  canWrite: boolean
}

export function LogoVariantNotice({ org, canWrite }: LogoVariantNoticeProps) {
  const queryClient = useQueryClient()
  const { status, error, darkIsGenerated, mainIsGenerated, sourcePolarity } =
    org.logoVariant

  const regenerate = useMutation({
    mutationFn: regenerateLogoVariant,
    onSuccess: (updated) => {
      queryClient.setQueryData<OrgProfile>(["organization"], updated)
      toast.success("Generating the other version of your logo.")
    },
    onError: (err) => toast.error(apiError(err, "Could not start generation.")),
  })

  // Nothing to say and nothing to offer.
  if (!org.logoUrl) return null

  const processing = status === "processing" || regenerate.isPending
  const generated = darkIsGenerated || mainIsGenerated

  return (
    <div className="rounded-xl border border-line bg-surface-3/50 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {processing ? (
            <Loader2 className="mt-px h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : status === "failed" ? (
            <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-[var(--warning)]" />
          ) : (
            <Sparkles className="mt-px h-4 w-4 shrink-0 text-primary" />
          )}

          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">
              {processing
                ? "Generating the other version…"
                : status === "failed"
                  ? "Couldn't generate the other version"
                  : generated
                    ? "Both versions ready"
                    : "One logo is enough"}
            </p>

            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              {processing ? (
                "We're making the opposite light or dark version of your logo. It'll appear here in a moment."
              ) : status === "failed" ? (
                <>
                  {error || "The image couldn't be processed."} Try replacing
                  the logo above with a PNG that has a transparent background,
                  then generate again.
                </>
              ) : mainIsGenerated ? (
                // The confusing case, spelled out.
                <>
                  You uploaded a light coloured logo, so we kept it for dark
                  backgrounds and generated the dark ink version above for
                  light ones.
                </>
              ) : darkIsGenerated ? (
                <>
                  We generated the version below from your logo, flipping the
                  black and white and keeping your brand colours as they are.
                </>
              ) : (
                <>
                  Upload one logo and we&apos;ll generate the opposite light or
                  dark version automatically. It works best with a transparent
                  background.
                </>
              )}
            </p>
          </div>
        </div>

        {canWrite ? (
          <button
            type="button"
            onClick={() => regenerate.mutate()}
            disabled={processing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--line-2)] px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wand2 className="h-3.5 w-3.5" />
            {generated ? "Regenerate" : "Generate"}
          </button>
        ) : null}
      </div>

      {/*
        Only shown once there is something to compare. Both marks on their own
        backdrop is the fastest way to see whether the generated one is right,
        and it is the check the admin would otherwise have to deploy to make.
      */}
      {org.logoDarkUrl && !processing ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="flex h-16 items-center justify-center rounded-lg border border-line bg-white px-3">
            <img
              src={org.logoUrl}
              alt="Logo on a light background"
              className="max-h-8 w-auto max-w-full object-contain"
            />
          </div>
          <div className="flex h-16 items-center justify-center rounded-lg border border-line bg-[#14101f] px-3">
            <img
              src={org.logoDarkUrl}
              alt="Logo on a dark background"
              className="max-h-8 w-auto max-w-full object-contain"
            />
          </div>
        </div>
      ) : null}

      {sourcePolarity === "light_ink" && !processing ? (
        <p className="mt-2 text-[11.5px] text-ink-subtle">
          Detected from your upload&apos;s own colours, not a setting.
        </p>
      ) : null}
    </div>
  )
}
