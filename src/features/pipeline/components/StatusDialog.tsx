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
  BUILTIN_STAGE_ORDER_MAX,
  MIN_CUSTOM_STAGE_ORDER,
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
  /** Every existing column — used to default `stageOrder` past the last one. */
  existing: CandidateStatus[];
}

/**
 * Create / edit one kanban column.
 *
 * The two modes differ by exactly what the backend allows: CREATE sends
 * `key` + `stageOrder` + `isTerminal` alongside the display fields; EDIT
 * sends display fields ONLY, because `key` is immutable and the
 * builtin/terminal flags are server-owned. So the key and terminal inputs
 * are not merely disabled in edit mode — they are not sent at all, and the
 * global `whitelist: true` pipe would strip them anyway.
 */
export function StatusDialog({
  open,
  onOpenChange,
  status,
  existing,
}: StatusDialogProps) {
  const isEdit = !!status;
  /** Built-in row: name and colour are editable, board position is not. */
  const pinned = !!status?.isProtected;
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState<string>(STATUS_COLORS[0]!.hex);
  const [stageOrder, setStageOrder] = useState("");
  const [isTerminal, setIsTerminal] = useState(false);
  /** Stop auto-deriving the key once the user has typed one themselves. */
  const [keyTouched, setKeyTouched] = useState(false);

  /**
   * Seed the form on OPEN via the controlled handler rather than a
   * `useEffect` on `open` — same reason as everywhere else in this feature:
   * it avoids the setState-in-effect cascade, and resetting on CLOSE would
   * race the exit animation and flash the defaults before unmount.
   */
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setLabel(status?.label ?? "");
      setKey(status?.key ?? "");
      setColor(status?.color ?? STATUS_COLORS[0]!.hex);
      setStageOrder(
        status ? String(status.stageOrder) : String(nextStageOrder(existing)),
      );
      setIsTerminal(status?.isTerminal ?? false);
      setKeyTouched(isEdit);
    }
    onOpenChange(next);
  };

  const mutation = useMutation({
    mutationFn: () => {
      const order = Number(stageOrder);
      if (isEdit) {
        return updateStatusColumn(status!._id, {
          label: label.trim(),
          color,
          // Omitted entirely for built-ins — the server 403s an actual
          // move, and sending the unchanged value back would only be a
          // no-op that hides the rule from anyone reading this call.
          ...(pinned ? {} : { stageOrder: order }),
        });
      }
      return createStatusColumn({
        key: key.trim(),
        label: label.trim(),
        color,
        stageOrder: order,
        isTerminal,
      });
    },
    onSuccess: () => {
      // Both queries read the same catalog — the Candidates page's filter
      // and change-status menu would otherwise show a stale column list.
      queryClient.invalidateQueries({ queryKey: ["candidateStatuses"] });
      toast.success(isEdit ? "Status updated." : "Status created.");
      handleOpenChange(false);
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

  /** The first column on the board — named in the help text below. */
  const firstLabel = existing[0]?.label ?? "the first stage";

  const trimmedKey = key.trim();
  const orderNum = Number(stageOrder);
  const orderInRange =
    stageOrder.trim() !== "" &&
    Number.isInteger(orderNum) &&
    // Matches `createStatus`'s guard: nothing sorts above the first
    // built-in, so Save is blocked rather than round-tripping to a 409.
    orderNum >= MIN_CUSTOM_STAGE_ORDER &&
    orderNum <= 10_000;

  /**
   * The column already sitting on this number, if any — excluding the row
   * being edited, which owns its own position. Two columns sharing a
   * position sort arbitrarily (the catalog's sort has no tiebreaker), so
   * the server 409s it; naming the occupant here is friendlier than
   * discovering it on Save.
   */
  const orderClash = orderInRange
    ? (existing.find(
        (s) => s.stageOrder === orderNum && s._id !== status?._id,
      ) ?? null)
    : null;
  const orderValid = orderInRange && !orderClash;
  const keyValid = isEdit || STATUS_KEY_PATTERN.test(trimmedKey);
  const canSave =
    label.trim().length > 0 &&
    keyValid &&
    // The order field isn't rendered for a pinned row, so it can't gate
    // Save there.
    (pinned || orderValid) &&
    !mutation.isPending;

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
                  ? "Name, colour and board position are editable. The key is fixed — automations and the activity timeline reference this column by it."
                  : "A new column on the candidate board. The key is permanent, so pick it deliberately."}
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

            {/* Board position — hidden for built-ins, whose position is
                pinned to the funnel order the automations run. Showing a
                disabled field would imply it's unlocked somewhere; the
                banner below the key says why instead. */}
            {pinned ? null : (
              <div>
                <label
                  htmlFor="status-order"
                  className="mb-1.5 block text-[13px] font-semibold text-ink"
                >
                  Board position
                </label>
                <input
                  id="status-order"
                  type="number"
                  min={MIN_CUSTOM_STAGE_ORDER}
                  max={10000}
                  step={1}
                  value={stageOrder}
                  onChange={(e) => setStageOrder(e.target.value)}
                  className="h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
                />
                {orderClash ? (
                  <p className="mt-1.5 text-[12px] text-[var(--danger)]">
                    Position {orderNum} is already taken by "
                    {orderClash.label}". Pick another — two columns on the same
                    number sort unpredictably.
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12px] text-ink-muted">
                    Columns sort ascending. The nine built-ins are fixed at 10,
                    20, 30 … {BUILTIN_STAGE_ORDER_MAX} and never move, so a
                    custom column goes in a gap between two of them —{" "}
                    {MIN_CUSTOM_STAGE_ORDER} sits just after {firstLabel}, 75
                    just after Shortlisted. Nine slots per gap, and nothing
                    sorts above {firstLabel}.
                  </p>
                )}
              </div>
            )}

            {/* The `isTerminal` flag, worded as the consequence rather than
                the mechanism. "Terminal column" asked HR a systems question;
                what they actually mean is "hold this person here until I say
                otherwise". Same flag, same behaviour.

                Create-only: `UpdateStatusDto` has no `isTerminal` field, so
                the server cannot patch it. */}
            {!isEdit ? (
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
  );
}

/**
 * Default `stageOrder` for a new column: 10 past the highest existing one,
 * so "add a column" lands it at the end of the board instead of colliding
 * with a builtin and sorting unpredictably against it.
 */
function nextStageOrder(existing: CandidateStatus[]): number {
  const max = existing.reduce(
    (acc, s) => Math.max(acc, s.stageOrder),
    BUILTIN_STAGE_ORDER_MAX,
  );
  return Math.min(max + 10, 10_000);
}
