import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { createPipelineGroup } from "@/features/pipeline/pipelineApi"
import { errorMessage } from "@/lib/errors"

interface NewGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * "New group" modal — matches `openModal('group')` in the reference
 * (max-w-[460px]). Name-only form; the mutation is currently a stub, so
 * saving fires an informational toast rather than pretending the change
 * persisted. See `pipelineApi.ts`.
 */
export function NewGroupDialog({ open, onOpenChange }: NewGroupDialogProps) {
  const [name, setName] = useState("")
  const queryClient = useQueryClient()

  // Reset the field when the caller opens the dialog. Doing it inside the
  // controlled open handler (rather than a useEffect that watches `open`)
  // avoids the setState-in-effect cascade warning and still keeps the field
  // empty on every fresh open. Resetting on close would race the exit
  // animation and briefly flash an empty field before the panel unmounts.
  const handleOpenChange = (next: boolean) => {
    if (next) setName("")
    onOpenChange(next)
  }

  const mutation = useMutation({
    mutationFn: (payload: { name: string }) => createPipelineGroup(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelineGroups"] })
      toast.success("Saved (dummy — backend not implemented).")
      handleOpenChange(false)
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Could not create group."))
    },
  })

  const canSave = name.trim().length > 0 && !mutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    mutation.mutate({ name: name.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[460px] gap-0 p-0" hideCloseButton>
        <form onSubmit={handleSubmit}>
          <div className="px-6 pb-[14px] pt-[22px]">
            <DialogTitle className="text-[18px] font-semibold text-ink">
              New group
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              A group is a single-select stage of the pipeline.
            </DialogDescription>
          </div>

          <div className="px-6 pb-5">
            <label
              htmlFor="pipeline-group-name"
              className="mb-1.5 block text-[13px] font-semibold text-ink"
            >
              Name
            </label>
            <input
              id="pipeline-group-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Reference Check"
              className="h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
            />
          </div>

          <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
