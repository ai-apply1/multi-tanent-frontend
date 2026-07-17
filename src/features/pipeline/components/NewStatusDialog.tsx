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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AUTO_SEED_OPTIONS,
  STATUS_COLORS,
  STATUS_GATES,
  STATUS_KINDS,
  type CreateStatusPayload,
} from "@/features/pipeline/types"
import { createPipelineStatus } from "@/features/pipeline/pipelineApi"
import { errorMessage } from "@/lib/errors"

interface NewStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The group the new status will belong to. Populates the modal title context. */
  groupId: string | null
  groupName?: string
}

/**
 * "New status" modal — matches `openModal('status')` in the reference
 * (max-w-[540px]). Backend does not model gating/kind/auto-seed today, so
 * everything except name+color is UI-only; the mutation itself is a stub.
 */
export function NewStatusDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
}: NewStatusDialogProps) {
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(STATUS_COLORS[0]!.hex)
  const [kind, setKind] = useState<CreateStatusPayload["kind"]>("assignable")
  const [gate, setGate] = useState<CreateStatusPayload["gate"]>("none")
  const [autoSeed, setAutoSeed] = useState<Set<string>>(new Set())
  const [prerequisites, setPrerequisites] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  // Reset on OPEN via the controlled handler (not a useEffect). This avoids
  // the setState-in-effect cascade warning while still guaranteeing a fresh
  // form for every open. Resetting on close would race the exit animation
  // and briefly flash defaults before the panel unmounts.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName("")
      setColor(STATUS_COLORS[0]!.hex)
      setKind("assignable")
      setGate("none")
      setAutoSeed(new Set())
      setPrerequisites(new Set())
    }
    onOpenChange(next)
  }

  const mutation = useMutation({
    mutationFn: (payload: CreateStatusPayload) => {
      // Guard is belt-and-braces — the Save button is disabled until a
      // group id lands, but React state updates can lag a click.
      if (!groupId) return Promise.reject(new Error("Missing group id."))
      return createPipelineStatus(groupId, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelineGroups"] })
      toast.success("Saved (dummy — backend not implemented).")
      handleOpenChange(false)
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Could not create status."))
    },
  })

  const canSave = name.trim().length > 0 && !!groupId && !mutation.isPending

  const toggle = (
    set: Set<string>,
    setter: (next: Set<string>) => void,
    value: string,
  ) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    mutation.mutate({
      name: name.trim(),
      color,
      kind,
      gate,
      autoSeed: [...autoSeed],
      prerequisites: [...prerequisites],
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[540px] gap-0 p-0" hideCloseButton>
        <form onSubmit={handleSubmit}>
          <div className="px-6 pb-[14px] pt-[22px]">
            <DialogTitle className="text-[18px] font-semibold text-ink">
              New status
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {groupName
                ? `Adding to “${groupName}”. Configure the status, its gating, and what it auto-seeds.`
                : "Configure the status, its gating, and what it auto-seeds."}
            </DialogDescription>
          </div>

          <div className="grid gap-4 px-6 pb-5">
            {/* Name */}
            <div>
              <label
                htmlFor="pipeline-status-name"
                className="mb-1.5 block text-[13px] font-semibold text-ink"
              >
                Name
              </label>
              <input
                id="pipeline-status-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Reference Passed"
                className="h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
              />
            </div>

            {/* Color pills */}
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-ink">
                Color
              </label>
              <div className="flex flex-wrap gap-2">
                {STATUS_COLORS.map((c) => {
                  const selected = color === c.hex
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setColor(c.hex)}
                      className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${
                        selected
                          ? "border-primary"
                          : "border-[var(--line-2)]"
                      }`}
                      style={{
                        background: `color-mix(in oklab, ${c.hex}, white 88%)`,
                        color: c.hex,
                      }}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Kind + Gating */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-ink">
                  Kind
                </label>
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as CreateStatusPayload["kind"])}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-ink">
                  Unlocked by (gating)
                </label>
                <Select
                  value={gate}
                  onValueChange={(v) => setGate(v as CreateStatusPayload["gate"])}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_GATES.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Auto-seed */}
            <ChecklistBox
              label="Auto-seed when set"
              items={AUTO_SEED_OPTIONS}
              selected={autoSeed}
              onToggle={(v) => toggle(autoSeed, setAutoSeed, v)}
            />

            {/* Prerequisites */}
            <ChecklistBox
              label="Prerequisites (survives only while one is present)"
              items={AUTO_SEED_OPTIONS}
              selected={prerequisites}
              onToggle={(v) => toggle(prerequisites, setPrerequisites, v)}
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

interface ChecklistBoxProps {
  label: string
  items: string[]
  selected: Set<string>
  onToggle: (value: string) => void
}

function ChecklistBox({ label, items, selected, onToggle }: ChecklistBoxProps) {
  return (
    <div className="grid gap-2">
      <label className="text-[13px] font-semibold text-ink">{label}</label>
      <div className="scroll max-h-[120px] overflow-auto rounded-lg border border-line p-1">
        {items.map((it) => {
          const checked = selected.has(it)
          return (
            <label
              key={it}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] text-ink hover:bg-surface-3"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(it)}
                className="h-[15px] w-[15px] accent-[var(--accent,#003fbc)]"
              />
              {it}
            </label>
          )
        })}
      </div>
    </div>
  )
}
