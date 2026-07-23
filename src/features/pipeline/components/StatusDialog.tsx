import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CandidateStatus } from "@/features/candidates/types";
import {
  createStatusColumn,
  updateStatusColumn,
} from "@/features/pipeline/pipelineApi";
import {
  STATUS_COLORS,
  STATUS_KEY_PATTERN,
  slugifyStatusKey,
} from "@/features/pipeline/types";
import { errorMessage } from "@/lib/errors";

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row being edited, or null to create a new column. */
  status: CandidateStatus | null;
}

/**
 * Create / edit one kanban column.
 *
 * The two modes differ by exactly what the backend allows: CREATE sends
 * `key` + `isTerminal` alongside the display fields; EDIT sends the display
 * fields plus, for CUSTOM columns only, `isTerminal` — `key` is immutable
 * and a protected built-in's terminality is server-owned (the service
 * ignores the flag for those, so we don't offer the toggle either). Board
 * position is never sent — the server appends a new column and
 * drag-and-drop reorders it.
 */
export function StatusDialog({
  open,
  onOpenChange,
  status,
}: StatusDialogProps) {
  const isEdit = !!status;
  /** Built-in row: name and colour are editable, board position is not. */
  const pinned = !!status?.isProtected;
  const queryClient = useQueryClient();

  /**
   * The form is seeded from `status` in the state INITIALISERS, not in a
   * `useEffect` and not in the open handler. That only works because the
   * caller mounts this component when it opens the dialog and unmounts it
   * on close (`{dialogOpen && <StatusDialog … />}` with a `key` per row) —
   * so every open is a fresh mount and these run again. Seeding in
   * `onOpenChange` would silently never fire: Radix only calls it when the
   * DIALOG asks to change, never when the parent flips `open` itself.
   */
  const [label, setLabel] = useState(status?.label ?? "");
  const [key, setKey] = useState(status?.key ?? "");
  const [description, setDescription] = useState(status?.description ?? "");
  const [color, setColor] = useState<string>(
    status?.color ?? STATUS_COLORS[0]!.hex,
  );
  const [isTerminal, setIsTerminal] = useState(status?.isTerminal ?? false);
  /** Stop auto-deriving the key once the user has typed one themselves. */
  const [keyTouched, setKeyTouched] = useState(isEdit);

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return updateStatusColumn(status!._id, {
          label: label.trim(),
          // Always sent, even when empty — an emptied field is a deliberate
          // clear, and omitting it would leave the old text in place.
          description: description.trim(),
          color,
          // Only custom columns may change terminality — the server ignores
          // the flag on protected built-ins, so don't send it for those.
          ...(pinned ? {} : { isTerminal }),
        });
      }
      return createStatusColumn({
        key: key.trim(),
        label: label.trim(),
        description: description.trim(),
        color,
        isTerminal,
      });
    },
    onSuccess: () => {
      // Both queries read the same catalog — the Candidates page's filter
      // and change-status menu would otherwise show a stale column list.
      queryClient.invalidateQueries({ queryKey: ["candidateStatuses"] });
      toast.success(isEdit ? "Status updated." : "Status created.");
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(
        errorMessage(
          err,
          isEdit ? "Could not update status." : "Could not create status.",
        ),
      );
    },
  });

  const trimmedKey = key.trim();
  const keyValid = isEdit || STATUS_KEY_PATTERN.test(trimmedKey);
  const canSave =
    label.trim().length > 0 && keyValid && !mutation.isPending;

  const handleLabelChange = (value: string) => {
    setLabel(value);
    if (!isEdit && !keyTouched) setKey(slugifyStatusKey(value));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px] gap-0 p-0" hideCloseButton>
        <form onSubmit={handleSubmit}>
          <div className="px-6 pb-[14px] pt-[22px]">
            <DialogTitle className="text-[18px] font-semibold text-ink">
              {isEdit ? "Edit status" : "New status"}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {pinned
                ? "A built-in stage. Rename and recolour it freely — the key and its position in the funnel are fixed, because the hiring automations run in that order and reference this column by key."
                : isEdit
                  ? "Name, colour and the freeze setting are editable. The key is fixed — automations and the activity timeline reference this column by it. Drag the row on the board to change its position."
                  : "A new column on the candidate board. It's added at the end — drag it into place afterward. The key is permanent, so pick it deliberately."}
            </DialogDescription>
          </div>

          <div className="grid gap-4 px-6 pb-5">
            {/* Label */}
            <div>
              <label
                htmlFor="status-label"
                className="mb-1.5 block text-[13px] font-semibold text-ink"
              >
                Name
              </label>
              <input
                id="status-label"
                autoFocus
                value={label}
                maxLength={100}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder="e.g. Reference check"
                className="h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
              />
            </div>

            {/* Key */}
            <div>
              <label
                htmlFor="status-key"
                className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink"
              >
                Key
                {isEdit ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-faint px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                    <Lock className="h-[10px] w-[10px]" strokeWidth={1.9} />
                    Immutable
                  </span>
                ) : null}
              </label>
              <input
                id="status-key"
                value={key}
                maxLength={50}
                disabled={isEdit}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value);
                }}
                placeholder="e.g. reference_check"
                className="h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 font-mono text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
              />
              {!isEdit && trimmedKey.length > 0 && !keyValid ? (
                <p className="mt-1.5 text-[12px] text-[var(--danger)]">
                  Lowercase letters and digits, separated by - or _, starting
                  with a letter or digit.
                </p>
              ) : null}
            </div>

            {/* Description — optional, editable on built-ins and customs
                alike (display-only, like the name and colour). Shown under
                the row on the pipeline page so teammates know what the
                column is for. */}
            <div>
              <label
                htmlFor="status-description"
                className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink"
              >
                Description
                <span className="text-[11.5px] font-normal text-ink-subtle">
                  optional
                </span>
              </label>
              <textarea
                id="status-description"
                value={description}
                maxLength={500}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this column for? e.g. Candidates whose references are being called."
                className="w-full resize-none rounded-lg border border-[var(--field-border)] bg-surface px-3.5 py-2.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
              />
            </div>

            {/* Color pills */}
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-ink">
                Colour
              </label>
              <div className="flex flex-wrap gap-2">
                {STATUS_COLORS.map((c) => {
                  const selected = color.toLowerCase() === c.hex.toLowerCase();
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setColor(c.hex)}
                      className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${
                        selected ? "border-primary" : "border-[var(--line-2)]"
                      }`}
                      style={{
                        background: `color-mix(in oklab, ${c.hex}, white 88%)`,
                        color: c.hex,
                      }}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The `isTerminal` flag, worded as the consequence rather than
                the mechanism. "Terminal column" asked HR a systems question;
                what they actually mean is "hold this person here until I say
                otherwise". Same flag, same behaviour.

                Hidden for protected built-ins only: their terminality is part
                of the funnel contract and the server ignores the field for
                them. Custom columns can toggle it in create AND edit. */}
            {!pinned ? (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3">
                <input
                  type="checkbox"
                  checked={isTerminal}
                  onChange={(e) => setIsTerminal(e.target.checked)}
                  className="mt-0.5 h-[15px] w-[15px] accent-[var(--accent,#003fbc)]"
                />
                <span>
                  <span className="block text-[13.5px] font-semibold text-ink">
                    Freeze candidates here
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-muted">
                    The AI won't move them out — not when an interview is
                    scored, not when one is abandoned. Only a person can.
                    Leave this off and a candidate parked here can still be
                    moved on automatically.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
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
  );
}
