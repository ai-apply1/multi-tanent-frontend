import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { AlertCircle, Check, Clock, Database, Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CopyButton } from "@/components/common/CopyButton"
import { AWS_REGIONS } from "@/features/organization/awsRegions"
import {
  getStorageSetup,
  provisionStorage,
} from "@/features/organization/organizationApi"
import type {
  OrgAwsStorage,
  TenantStorageState,
} from "@/features/organization/types"

const ROLE_ARN_RE = /^arn:aws:iam::\d{12}:role\/.+$/
const REGION_RE = /^[a-z]{2}-[a-z]+-\d$/

/** Exhaustive maps, so a new backend state breaks the build here, not the UI. */
const stateLabel: Record<TenantStorageState, string> = {
  active: "Connected",
  provisioning: "Setting up",
  verifying: "Verifying",
  pending: "Not connected",
  failed: "Setup failed",
}

type ChipTone = "success" | "warning" | "danger" | "muted"

const stateTone: Record<TenantStorageState, ChipTone> = {
  active: "success",
  provisioning: "warning",
  verifying: "warning",
  pending: "muted",
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
  muted: Clock,
}

/** A titled, copyable code block for the exact JSON to paste into AWS. */
function PolicyBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-semibold text-ink-muted">{title}</span>
        <CopyButton value={code} label={title} />
      </div>
      <pre className="scroll overflow-x-auto px-3 py-2 text-[11px] leading-relaxed text-ink-2">
        <code className="mono">{code}</code>
      </pre>
    </div>
  )
}

interface AwsStorageCardProps {
  awsStorage: OrgAwsStorage
  canWrite: boolean
}

/**
 * The org's OWN S3 storage, and the step-by-step guide to connect it.
 *
 * Written for a non-technical admin: the two IAM policies are rendered filled
 * in with the real platform account id and the org's STABLE server-owned
 * ExternalId (fetched, not generated here), each with a copy button, so there is
 * nothing to hand-edit and nothing that changes on a retry. The admin creates
 * one role in their AWS console, pastes back its ARN and region, and we
 * provision the bucket + a locked-down access role in their account and verify.
 *
 * There is no fallback storage: until this is `active`, the org cannot upload
 * CVs, logos, or interview recordings, so the card says so plainly rather than
 * implying it can wait.
 */
export function AwsStorageCard({ awsStorage, canWrite }: AwsStorageCardProps) {
  const queryClient = useQueryClient()
  const state = awsStorage.state
  const active = state === "active"
  const tone = stateTone[state]
  const StatusIcon = toneIcon[tone]

  const [roleArn, setRoleArn] = useState("")
  const [region, setRegion] = useState(awsStorage.region || "")
  const [touched, setTouched] = useState(false)

  // The guide (and its setup details) is only needed while not connected.
  const showGuide = !active && canWrite
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["storageSetup"],
    queryFn: getStorageSetup,
    enabled: showGuide,
    staleTime: 60 * 60 * 1000,
  })
  const roleName = config?.bootstrapRoleName ?? "JobjenBootstrap"
  // Server-owned and stable: shown in the trust policy, never generated here, so
  // it can never drift out of sync with the role the admin creates on a retry.
  const externalId = config?.bootstrapExternalId ?? ""

  const mutation = useMutation({
    mutationFn: () =>
      provisionStorage({
        bootstrapRoleArn: roleArn.trim(),
        region: region.trim().toLowerCase(),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["organization"] })
      if (result.state === "active") {
        toast.success("Storage connected.")
      } else if (result.state === "failed") {
        toast.error(result.error || "Setup failed. Check the details and try again.", {
          duration: 8000,
        })
      } else {
        toast(`Storage is ${result.state}.`)
      }
    },
    onError: () => {
      toast.error("Could not connect storage. Please try again.")
    },
  })

  const arnError = touched && !ROLE_ARN_RE.test(roleArn.trim())
  const regionError = touched && !REGION_RE.test(region.trim().toLowerCase())

  const submit = () => {
    setTouched(true)
    if (ROLE_ARN_RE.test(roleArn.trim()) && REGION_RE.test(region.trim().toLowerCase())) {
      mutation.mutate()
    }
  }

  const trustPolicy = config
    ? JSON.stringify(
        {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { AWS: `arn:aws:iam::${config.platformAccountId}:root` },
              Action: "sts:AssumeRole",
              Condition: { StringEquals: { "sts:ExternalId": externalId } },
            },
          ],
        },
        null,
        2,
      )
    : ""

  const permissionPolicy = config
    ? JSON.stringify(
        {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "s3:CreateBucket",
                "s3:PutBucketPolicy",
                "s3:PutBucketCORS",
                "s3:PutEncryptionConfiguration",
                "s3:PutBucketPublicAccessBlock",
              ],
              Resource: `arn:aws:s3:::${config.bucketPrefix}*`,
            },
            {
              Effect: "Allow",
              Action: [
                "iam:CreateRole",
                "iam:PutRolePolicy",
                "iam:GetRole",
                "iam:UpdateAssumeRolePolicy",
              ],
              Resource: `arn:aws:iam::*:role/${config.dataRoleName}`,
            },
          ],
        },
        null,
        2,
      )
    : ""

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">
            Storage (your AWS account)
          </h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
            {active
              ? "Your files (CVs, interview recordings, logos) are stored in your own AWS account."
              : "Connect your AWS account so your candidates' files are stored in your own account. Until this is connected, uploads won't work."}
          </p>
        </div>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold " +
            toneChipClass[tone]
          }
        >
          <StatusIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
          {stateLabel[state]}
        </span>
      </div>

      {awsStorage.error ? (
        <p className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_60%)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-[var(--danger)]">
          {awsStorage.error}
        </p>
      ) : null}

      {active ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink-muted">Stored in</span>
          <code className="mono rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[12.5px] text-ink">
            {awsStorage.bucket}
            {awsStorage.region ? ` (${awsStorage.region})` : ""}
          </code>
        </div>
      ) : !canWrite ? (
        <p className="mt-4 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-[13px] text-ink-muted">
          Storage isn&apos;t connected yet. Ask an organization admin to set it
          up.
        </p>
      ) : configLoading ? (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading setup steps…
        </div>
      ) : !config?.platformAccountId ? (
        <p className="mt-4 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-[13px] text-ink-muted">
          Storage setup isn&apos;t available yet. Please contact support.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {/* Step 1 — create the role, with the exact JSON to paste. */}
          <div className="space-y-3">
            <p className="text-[13.5px] font-semibold text-ink">
              Step 1 &middot; Create a role in your AWS account
            </p>
            <ol className="list-decimal space-y-2.5 pl-4 text-[12.5px] leading-relaxed text-ink-muted">
              <li>
                In the AWS console, open{" "}
                <span className="font-medium text-ink-2">
                  IAM &rarr; Roles &rarr; Create role
                </span>
                , choose{" "}
                <span className="font-medium text-ink-2">
                  Custom trust policy
                </span>
                , and paste this:
                <div className="mt-2">
                  <PolicyBlock title="Trust policy (who can use it)" code={trustPolicy} />
                </div>
              </li>
              <li>
                Name the role exactly{" "}
                <code className="mono text-ink-2">{roleName}</code> and finish
                creating it.
              </li>
              <li>
                Open the role, then{" "}
                <span className="font-medium text-ink-2">
                  Add permissions &rarr; Create inline policy &rarr; JSON
                </span>
                , and paste this:
                <div className="mt-2">
                  <PolicyBlock title="Permission policy (what it can do)" code={permissionPolicy} />
                </div>
              </li>
              <li>
                Copy the role&apos;s <span className="font-medium text-ink-2">ARN</span>{" "}
                from its summary page.
              </li>
            </ol>
          </div>

          {/* Step 2 — the two things to paste back. */}
          <div className="space-y-3 border-t border-line pt-5">
            <p className="text-[13.5px] font-semibold text-ink">
              Step 2 &middot; Paste the details back here
            </p>

            <div className="space-y-1.5">
              <label
                htmlFor="aws-role-arn"
                className="block text-[12.5px] font-medium text-ink-2"
              >
                Role ARN
              </label>
              <input
                id="aws-role-arn"
                value={roleArn}
                onChange={(e) => setRoleArn(e.target.value)}
                placeholder={`arn:aws:iam::123456789012:role/${roleName}`}
                className="mono w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary"
              />
              {arnError ? (
                <p className="text-[12px] text-[var(--danger)]">
                  That doesn&apos;t look like a role ARN (e.g.
                  arn:aws:iam::123456789012:role/{roleName}).
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="aws-region"
                className="block text-[12.5px] font-medium text-ink-2"
              >
                Region
              </label>
              {/* A strict dropdown, not free text: a mistyped region can never
                  reach provisioning, and the admin picks the one they chose in
                  AWS by its familiar code. */}
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger id="aws-region" className="mono w-full text-[12.5px]">
                  <SelectValue placeholder="Choose your region" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {AWS_REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} className="mono text-[12.5px]">
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {regionError ? (
                <p className="text-[12px] text-[var(--danger)]">
                  Please choose your region.
                </p>
              ) : null}
            </div>

            <p className="text-[12px] leading-relaxed text-ink-subtle">
              Connecting takes a few seconds. Once connected, you can delete the{" "}
              <code className="mono">{roleName}</code> role in AWS; only a
              locked-down access role stays.
            </p>

            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.9} />
              ) : (
                <Database className="mr-2 h-4 w-4" strokeWidth={1.9} />
              )}
              {state === "failed" ? "Try again" : "Connect storage"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
