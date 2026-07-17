import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { GitBranch, Lock, Pencil, Plus, RotateCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  deletePipelineGroup,
  listPipelineGroups,
} from "@/features/pipeline/pipelineApi"
import type { PipelineGroup, PipelineStatus } from "@/features/pipeline/types"
import { NewGroupDialog } from "@/features/pipeline/components/NewGroupDialog"
import { NewStatusDialog } from "@/features/pipeline/components/NewStatusDialog"
import { errorMessage } from "@/lib/errors"

/**
 * Pipeline configuration page — mirrors `vPipeline` in the reference design
 * (OrgPortal.dc.html lines 763–787). One card per status group; each card
 * lists its statuses with an Edit ghost button and a header row of
 * Rename / +Status / delete actions.
 *
 * The backend has NO pipeline endpoints — statuses live in a flat catalog
 * under `/admin/statuses`. `pipelineApi.listPipelineGroups()` synthesises
 * groups by bucketing `stageOrder`; mutations are stubbed. See the comments
 * in `pipelineApi.ts` for the swap-out plan.
 */
export function PipelinePage() {
  const queryClient = useQueryClient()
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [statusDialogGroup, setStatusDialogGroup] = useState<PipelineGroup | null>(
    null,
  )

  const {
    data: groups = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["pipelineGroups"],
    queryFn: listPipelineGroups,
  })

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => deletePipelineGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelineGroups"] })
      toast.success("Saved (dummy — backend not implemented).")
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Could not delete group."))
    },
  })

  const openStatusDialog = (group: PipelineGroup) => {
    setStatusDialogGroup(group)
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6 lg:px-8 lg:py-8">
      {/* Page header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex text-primary">
              <GitBranch className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight text-ink">
              Pipeline
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            Define the hiring pipeline: the status groups, the statuses inside
            them, single-select behaviour and gating. Built-in stages that carry
            coded behaviour are locked to name and colour edits only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setGroupDialogOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            New group
          </Button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} loading={isFetching} />
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              onAddStatus={() => openStatusDialog(group)}
              onEditStatus={() => openStatusDialog(group)}
              onRename={() =>
                toast("Rename is not wired up yet (backend stub).", {
                  icon: "ℹ️",
                })
              }
              onDelete={() => {
                if (group.builtin) return
                if (
                  window.confirm(
                    `Delete “${group.name}” and its statuses? This cannot be undone.`,
                  )
                ) {
                  deleteGroupMutation.mutate(group.id)
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <NewGroupDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} />
      <NewStatusDialog
        open={!!statusDialogGroup}
        onOpenChange={(o) => {
          if (!o) setStatusDialogGroup(null)
        }}
        groupId={statusDialogGroup?.id ?? null}
        groupName={statusDialogGroup?.name}
      />
    </div>
  )
}

// ---------------------------------------------------------------------
// Group card
// ---------------------------------------------------------------------

interface GroupCardProps {
  group: PipelineGroup
  onAddStatus: () => void
  onEditStatus: (status: PipelineStatus) => void
  onRename: () => void
  onDelete: () => void
}

function GroupCard({
  group,
  onAddStatus,
  onEditStatus,
  onRename,
  onDelete,
}: GroupCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex text-primary">
          <GitBranch className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </span>
        <h2 className="text-[16px] font-semibold text-ink">{group.name}</h2>
        {group.builtin ? (
          <>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
              Built-in
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-faint px-2 py-0.5 text-[11px] font-semibold text-ink">
              <Lock className="h-[11px] w-[11px]" strokeWidth={1.7} />
              Locked
            </span>
          </>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRename}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-2)] bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-surface-3"
        >
          <Pencil className="h-[13px] w-[13px]" strokeWidth={1.9} />
          Rename
        </button>
        <Button size="sm" onClick={onAddStatus}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
          Status
        </Button>
        {!group.builtin ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${group.name}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line-2)] bg-surface text-[var(--danger)] hover:bg-[var(--danger-soft)]"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

      {/* Sub row */}
      <p className="mt-2 text-[12.5px] text-ink-muted">{group.description}</p>

      {/* Status list */}
      <div className="mt-3.5 border-t border-line">
        {group.statuses.length === 0 ? (
          <div className="py-4 text-[13px] text-ink-muted">
            No statuses in this group yet.
          </div>
        ) : (
          group.statuses.map((st) => (
            <StatusRow key={st.id} status={st} onEdit={() => onEditStatus(st)} />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Status row
// ---------------------------------------------------------------------

interface StatusRowProps {
  status: PipelineStatus
  onEdit: () => void
}

function StatusRow({ status, onEdit }: StatusRowProps) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
      <span
        className="inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-semibold"
        style={{
          background: `color-mix(in oklab, ${status.color}, white 88%)`,
          color: status.color,
        }}
      >
        {status.label}
      </span>
      {status.system ? (
        <span className="text-[11.5px] text-ink-subtle">system</span>
      ) : null}
      {status.gate ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-faint px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-2">
          <Lock className="h-[10px] w-[10px]" strokeWidth={1.9} />
          {status.gate}
        </span>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted hover:bg-surface-3"
      >
        <Pencil className="h-[13px] w-[13px]" strokeWidth={1.9} />
        Edit
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------
// Loading / error states
// ---------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="grid gap-4">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-line bg-surface p-5"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-5 w-5 rounded-md bg-surface-3" />
            <div className="h-4 w-40 rounded bg-surface-3" />
            <div className="flex-1" />
            <div className="h-7 w-20 rounded-full bg-surface-3" />
            <div className="h-7 w-20 rounded-full bg-surface-3" />
          </div>
          <div className="mt-3 h-3 w-2/3 rounded bg-surface-3" />
          <div className="mt-4 space-y-3 border-t border-line pt-3">
            <div className="h-6 w-32 rounded-full bg-surface-3" />
            <div className="h-6 w-40 rounded-full bg-surface-3" />
            <div className="h-6 w-28 rounded-full bg-surface-3" />
          </div>
        </div>
      ))}
    </div>
  )
}

interface ErrorStateProps {
  onRetry: () => void
  loading: boolean
}

function ErrorState({ onRetry, loading }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-14 text-center">
      <p className="text-[13.5px] text-[var(--danger)]">
        Failed to load pipeline. Try refreshing.
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry} disabled={loading}>
        <RotateCw className="h-4 w-4" strokeWidth={1.9} />
        Refresh
      </Button>
    </div>
  )
}
