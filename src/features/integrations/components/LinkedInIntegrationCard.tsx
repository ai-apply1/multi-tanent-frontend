import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import {
  AlertTriangle,
  CheckCircle2,
  Linkedin,
  Loader2,
  RefreshCw,
  Unplug,
} from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  disconnectLinkedIn,
  getLinkedInStatus,
  startLinkedInConnect,
} from "@/features/integrations/integrationsApi"
import { errorMessage as apiError } from "@/lib/errors"

const DAY_MS = 24 * 60 * 60 * 1000

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS)
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * The LinkedIn connection card on Settings → Integrations. Per-user: shows
 * whether THIS user's LinkedIn is connected + active, and lets them connect /
 * reconnect / disconnect / refresh. Posting a job to LinkedIn happens from a
 * job's detail page; this is only the connection.
 */
export function LinkedInIntegrationCard() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const statusQuery = useQuery({
    queryKey: ["linkedInStatus"],
    queryFn: getLinkedInStatus,
  })

  // Back from the OAuth round-trip: the backend callback 302s here with
  // ?linkedin=connected|error. Toast + refresh status, then strip only that
  // param (keep ?tab=integrations).
  useEffect(() => {
    const flag = searchParams.get("linkedin")
    if (!flag) return
    if (flag === "connected") {
      toast.success("LinkedIn connected.")
      void queryClient.invalidateQueries({ queryKey: ["linkedInStatus"] })
    } else if (flag === "error") {
      toast.error("Could not connect LinkedIn. Please try again.")
    }
    const next = new URLSearchParams(searchParams)
    next.delete("linkedin")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, queryClient])

  const connectMutation = useMutation({
    mutationFn: () => startLinkedInConnect(window.location.href),
    onSuccess: ({ url }) => {
      // Run the OAuth step process: full-page redirect to LinkedIn; the backend
      // callback returns here with ?linkedin=connected. (If the server has no
      // LinkedIn app configured, the dry-run note below already warns that the
      // handshake won't complete.)
      window.location.href = url
    },
    onError: (err) =>
      toast.error(apiError(err, "Could not start LinkedIn sign-in.")),
  })

  const disconnectMutation = useMutation({
    mutationFn: disconnectLinkedIn,
    onSuccess: () => {
      toast.success("LinkedIn disconnected.")
      setConfirmDisconnect(false)
      void queryClient.invalidateQueries({ queryKey: ["linkedInStatus"] })
    },
    onError: (err) =>
      toast.error(apiError(err, "Could not disconnect LinkedIn.")),
  })

  const status = statusQuery.data
  const connecting = connectMutation.isPending
  // A real connection means a real OAuth token — which only exists after a
  // genuine handshake. `dryRun` (server has no LinkedIn app) can never be a real
  // connection, so treat it as NOT connected even if the backend reports
  // `connected: true`; that's what surfaces the Connect button in dry-run.
  const isConnected = Boolean(status?.connected) && !status?.dryRun
  const isExpired = Boolean(status?.expired)
  const daysLeft = daysUntil(status?.expiresAt ?? null)

  const connectButton = (label: string) => (
    <Button
      size="sm"
      onClick={() => connectMutation.mutate()}
      disabled={connecting}
    >
      {connecting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Redirecting…
        </>
      ) : (
        <>
          <Linkedin className="h-4 w-4" strokeWidth={1.9} />
          {label}
        </>
      )}
    </Button>
  )

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <Linkedin className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-ink">LinkedIn</h3>
              {status ? (
                <StatusPill
                  connected={isConnected}
                  active={Boolean(status.active)}
                  expired={isExpired}
                  dryRun={Boolean(status.dryRun)}
                />
              ) : null}
              <button
                type="button"
                onClick={() => statusQuery.refetch()}
                disabled={statusQuery.isFetching}
                className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-ink-muted hover:text-ink disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${statusQuery.isFetching ? "animate-spin" : ""}`}
                  strokeWidth={1.9}
                />
                Refresh status
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Connect your LinkedIn account to post jobs to your feed from a
              job's detail page.
            </p>

            <div className="mt-4">
              {statusQuery.isLoading ? (
                <div className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking connection…
                </div>
              ) : statusQuery.isError || !status ? (
                <div className="flex items-center gap-3">
                  <p className="text-[13px] text-[var(--danger)]">
                    Could not load LinkedIn status.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => statusQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : !isConnected ? (
                // Not connected (includes the server-not-configured dry-run case).
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[13px] text-ink-muted">Not connected.</p>
                    {connectButton("Connect LinkedIn")}
                  </div>
                  {status.dryRun ? (
                    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-3 px-3 py-2">
                      <AlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
                        strokeWidth={1.9}
                      />
                      <p className="text-[12.5px] text-ink-muted">
                        Heads up: the server has no LinkedIn app configured yet,
                        so connecting won't complete until a platform admin sets
                        it up.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : isExpired ? (
                // Connected but past the 30-day window.
                <div className="grid gap-3">
                  <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2">
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                      strokeWidth={1.9}
                    />
                    <p className="text-[12.5px] text-[var(--warning)]">
                      Your LinkedIn connection expired on{" "}
                      {formatDate(status.expiresAt)}. Reconnect to post jobs
                      again.
                    </p>
                  </div>
                  <ConnectionMeta status={status} />
                  <div className="flex flex-wrap gap-2">
                    {connectButton("Reconnect")}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmDisconnect(true)}
                      disabled={disconnectMutation.isPending}
                    >
                      <Unplug className="h-4 w-4" strokeWidth={1.9} />
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                // Connected + active.
                <div className="grid gap-3">
                  <div className="flex items-center gap-2 text-[13px] text-ink-2">
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-[var(--success)]"
                      strokeWidth={2}
                    />
                    <span className="truncate">
                      Connected{status.name ? ` as ${status.name}` : ""}
                      {daysLeft !== null ? (
                        <span className="text-ink-muted">
                          {" "}
                          · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <ConnectionMeta status={status} />
                  <div className="flex flex-wrap gap-2">
                    {connectButton("Reconnect")}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmDisconnect(true)}
                      disabled={disconnectMutation.isPending}
                    >
                      <Unplug className="h-4 w-4" strokeWidth={1.9} />
                      Disconnect
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <p className="mt-4 rounded-lg border border-line bg-surface-3 px-3 py-2 text-[12px] text-ink-muted">
              LinkedIn connections expire after 30 days. Use{" "}
              <span className="font-semibold text-ink-2">Refresh status</span> to
              check; once expired you'll need to reconnect before posting again.
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect LinkedIn?"
        description="You'll need to reconnect before you can post jobs to LinkedIn again. Any posts already published stay on LinkedIn."
        destructive
        confirmLabel="Disconnect"
        loadingLabel="Disconnecting…"
        loading={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />
    </div>
  )
}

function ConnectionMeta({
  status,
}: {
  status: { connectedAt: string | null; expiresAt: string | null; expired: boolean }
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
      <dt className="text-ink-muted">Connected</dt>
      <dd className="text-ink-2">{formatDate(status.connectedAt)}</dd>
      <dt className="text-ink-muted">{status.expired ? "Expired" : "Expires"}</dt>
      <dd className="text-ink-2">{formatDate(status.expiresAt)}</dd>
    </dl>
  )
}

function StatusPill({
  connected,
  active,
  expired,
  dryRun,
}: {
  connected: boolean
  active: boolean
  expired: boolean
  dryRun: boolean
}) {
  if (connected && active) {
    return (
      <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
        Connected
      </span>
    )
  }
  if (connected && expired) {
    return (
      <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
        Expired
      </span>
    )
  }
  if (dryRun) {
    return (
      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
        Not configured
      </span>
    )
  }
  return (
    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
      Not connected
    </span>
  )
}
