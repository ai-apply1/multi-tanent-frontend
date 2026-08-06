import { useState } from "react";
import { ArrowRight, Loader2, MessageSquarePlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CandidateStatus } from "@/features/candidates/types";

/**
 * The server caps `note` at 1000 characters on BOTH write paths
 * (`OverrideStatusDto.note` and `AddRemarkDto.note`). Mirrored here so the
 * limit is enforced where it can still be fixed — a 400 on submit after
 * someone has typed 1200 characters into a box that accepted them is the
 * worst possible moment to mention it.
 */
const REMARK_MAX = 1000;

/** Show the counter only once it starts mattering — see `charHint` below. */
const COUNTER_VISIBLE_FROM = REMARK_MAX - 150;

export type RemarkDialogMode =
  /** Committing a pipeline move; the remark rides ON the transition row. */
  | { kind: "move"; from?: CandidateStatus | null; to: CandidateStatus }
  /** A standalone remark; no status change. */
  | { kind: "remark" };

/**
 * Capture an optional remark, in the two places HR writes one.
 *
 * ONE component for both because they are the same act with different
 * consequences, and a second copy is how the two drift into behaving
 * differently — different caps, different keyboard handling, different
 * "did that save?" feedback on a record that outlives the hire.
 *
 * The one real difference is what an EMPTY box means, and it is the whole
 * reason `mode` exists:
 *
 *   - `move`   — the remark is optional and the primary button stays enabled.
 *                A move with nothing to say is the common case and must not
 *                cost more than a click; the dialog exists to OFFER the
 *                remark, never to demand one as a toll on the move.
 *   - `remark` — the remark IS the action, so an empty box disables the
 *                button. There is nothing else for the submit to do.
 *
 * Keyboard: the textarea takes focus on open, Escape closes (Radix), and
 * Cmd/Ctrl+Enter submits from inside it — plain Enter is left alone because
 * this is a multi-line field and stealing Enter would make a two-sentence
 * remark impossible to type.
 */
export function RemarkDialog({
  open,
  onOpenChange,
  mode,
  candidateName,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * What is being captured. May go null the instant the dialog closes — the
   * caller usually derives it from the same state that drives `open` — so the
   * last non-null value is retained below rather than pushed onto every
   * caller.
   */
  mode: RemarkDialogMode | null;
  /** Whose record this is — the dialog is often opened from a dense list. */
  candidateName?: string | null;
  pending: boolean;
  /** `note` is trimmed; empty means "no remark" (only reachable in `move`). */
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");

  /*
   * Retain the last target so this component can stay MOUNTED while closing.
   *
   * Callers follow the codebase's dialog convention — always rendered,
   * `open={Boolean(target)}` — because unmounting on close tears the node out
   * from under Radix's Presence and the exit animation never plays (see the
   * long note in `ui/dialog.tsx`, which exists for exactly this). But the
   * target usually goes null in the same tick `open` does, which would blank
   * the title and the status pills mid-fade. Holding the last one keeps the
   * dialog reading correctly for the ~150ms it is animating out.
   *
   * Tracked against a STABLE STRING, not the object. `mode` is a fresh literal
   * on every parent render, so `mode !== shownMode` would be true forever and
   * the adjustment below would re-render on a loop.
   *
   * It re-syncs while OPEN, not only at open time, and that matters: the
   * drawer derives `from` from a candidate query that can still be in flight
   * when the menu is used, so capturing once would pin `from` to null and drop
   * the "Needs Review →" half of the transition for good.
   */
  const modeKey = mode
    ? mode.kind === "move"
      ? `move:${mode.from?.key ?? ""}>${mode.to.key}`
      : "remark"
    : null;
  const [shown, setShown] = useState<{
    key: string | null;
    mode: RemarkDialogMode | null;
  }>({ key: modeKey, mode });
  if (mode && modeKey !== shown.key) setShown({ key: modeKey, mode });
  const shownMode = shown.mode;

  /*
   * Clear the draft when the dialog OPENS, not when it closes.
   *
   * Clearing on close would wipe the text during the exit animation, so it
   * visibly blanks while still on screen — and it would destroy the draft on a
   * FAILED submit, the one moment the words are least reproducible.
   *
   * Done as a render-phase adjustment (React's documented "adjusting state
   * when a prop changes") rather than in an effect: an effect would render the
   * stale draft for one frame first, which is the flash this avoids.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNote("");
  }

  const trimmed = note.trim();
  // `move` is the narrowed shape when this is a transition; null before the
  // dialog has ever been opened, in which case there is nothing to render.
  const move = shownMode?.kind === "move" ? shownMode : null;
  const isMove = Boolean(move);
  const canSubmit = !pending && (isMove || trimmed.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  /*
   * Counter appears only in the last 150 characters.
   *
   * Remarks are typically one or two sentences, so a live "6 / 1000" on every
   * keystroke reads as a quota being metered — it makes a free-form box feel
   * like a form field with a budget. The number is only useful as a WARNING,
   * so it shows up when it is one, and turns red at the cap.
   */
  const charHint =
    note.length >= COUNTER_VISIBLE_FROM
      ? `${note.length} / ${REMARK_MAX}`
      : null;

  // Never opened, nothing retained — render nothing at all rather than an
  // empty shell that would flash if `open` ever raced ahead of `mode`.
  if (!shownMode) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>
            {move ? `Move to ${move.to.label}` : "Add a remark"}
          </DialogTitle>
          <DialogDescription>
            {isMove ? (
              <>
                {/* Says the quiet part out loud at the moment of the decision:
                    a manual move writes the status and nothing else. The same
                    sentence is in the status submenu, and both are load-bearing
                    — people reasonably assume a rejection emails the candidate. */}
                This won't email {candidateName || "the candidate"}. Add a
                remark if you want the reason on their record.
              </>
            ) : (
              <>
                Recorded on {candidateName || "the candidate"}'s timeline with
                your name and the time. Remarks can't be edited or deleted.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* The transition, spelled out. The board move is about to happen
            whatever is in the box, so showing it here is the confirmation
            half of this dialog — the remark is the optional half. */}
        {move ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-[13px]">
            {move.from ? (
              <>
                <StatusPill status={move.from} muted />
                <ArrowRight
                  className="h-3.5 w-3.5 shrink-0 text-ink-subtle"
                  strokeWidth={1.8}
                />
              </>
            ) : null}
            <StatusPill status={move.to} />
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <label
            htmlFor="candidate-remark"
            className="text-[12.5px] font-medium text-ink-muted"
          >
            {isMove ? "Remark (optional)" : "Remark"}
          </label>
          <Textarea
            id="candidate-remark"
            autoFocus
            rows={4}
            value={note}
            maxLength={REMARK_MAX}
            placeholder={
              isMove
                ? "Why are you making this move? Your team will see this."
                : "Anything the rest of the team should know."
            }
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter only. Plain Enter must stay a newline — this is
              // a multi-line field, and a remark is routinely two sentences.
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className="resize-y"
          />
          <div className="flex min-h-4 items-center justify-between text-[11.5px] text-ink-subtle">
            <span>
              <kbd className="rounded border border-border px-1 py-0.5 font-sans text-[10.5px]">
                ⌘
              </kbd>
              <span className="px-0.5">+</span>
              <kbd className="rounded border border-border px-1 py-0.5 font-sans text-[10.5px]">
                ↵
              </kbd>
              <span className="pl-1.5">
                to {isMove ? "move" : "save"}
              </span>
            </span>
            {charHint ? (
              <span
                className={
                  note.length >= REMARK_MAX ? "text-(--danger)" : undefined
                }
              >
                {charHint}
              </span>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {pending ? (
              <Loader2 className="animate-spin" />
            ) : isMove ? null : (
              <MessageSquarePlus />
            )}
            {move
              ? // Names the destination rather than saying "Confirm", so the
                // button itself is the last chance to notice a mis-click in a
                // long status list.
                `Move to ${move.to.label}`
              : "Add remark"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The catalog's own dot + label, so the dialog can't drift from the board. */
function StatusPill({
  status,
  muted = false,
}: {
  status: CandidateStatus;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 ${
        muted ? "text-ink-muted" : "text-ink"
      }`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: status.color ?? "var(--ink-muted)" }}
      />
      <span className="truncate font-medium">{status.label}</span>
    </span>
  );
}
