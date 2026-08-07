import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
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
 * The server caps the transition note at 1000 characters
 * (`OverrideStatusDto.note`) — this box genuinely mirrors that one column.
 * Mirrored here so the limit is enforced where it can still be fixed: a 400 on
 * submit after someone has typed 1200 characters into a box that accepted them
 * is the worst possible moment to mention it.
 *
 * Deliberately NOT shared with the HR-notes cap (4000, `NOTE_MAX_LENGTH`).
 * Different collection, different server constant — one shared number here is
 * how the next bump to either silently drags the other along with it.
 */
const MOVE_REASON_MAX = 1000;

/** Show the counter only once it starts mattering — see `charHint` below. */
const COUNTER_VISIBLE_FROM = MOVE_REASON_MAX - 150;

/**
 * Confirm a manual pipeline move and offer the optional "why" in one step.
 *
 * The move is the action; the reason is not. An empty box leaves the primary
 * button enabled, because a move with nothing to say is the common case and
 * must not cost more than a click — this dialog exists to OFFER the reason,
 * never to demand one as a toll on the move.
 *
 * The reason rides ON the transition row (`OverrideStatusDto.note`), so it
 * lands on the candidate's record as part of the status change and nowhere
 * else. What the team writes to each other lives in a separate thread with its
 * own composer (`CandidateNotes` / `NoteComposerDialog`). This component used
 * to serve both acts through one `mode` prop, and that is precisely how "note"
 * came to mean two different things on the same screen.
 *
 * Keyboard: the textarea takes focus on open, Escape closes (Radix), and
 * Cmd/Ctrl+Enter submits from inside it — plain Enter is left alone because
 * this is a multi-line field and stealing Enter would make a two-sentence
 * reason impossible to type.
 */
export function StatusMoveDialog({
  open,
  onOpenChange,
  from,
  to,
  candidateName,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where they are now, when the caller knows it. Renders the left pill. */
  from?: CandidateStatus | null;
  /**
   * Where the candidate is going. May go null the instant the dialog closes —
   * the caller usually derives it from the same state that drives `open` — so
   * the last non-null value is retained below rather than pushed onto every
   * caller.
   */
  to: CandidateStatus | null;
  /** Whose record this is — the dialog is often opened from a dense list. */
  candidateName?: string | null;
  pending: boolean;
  /** `note` is trimmed; empty means "no reason", which is allowed here. */
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
   * Tracked against a STABLE STRING, not the status objects. `from`/`to` are
   * fresh objects on every refetch of the row they came from, so comparing
   * them by identity would be "changed" far more often than the target
   * actually changes and the adjustment below would re-render on a loop.
   *
   * It re-syncs while OPEN, not only at open time, and that matters: the
   * drawer derives `from` from a candidate query that can still be in flight
   * when the menu is used, so capturing once would pin `from` to null and drop
   * the "Needs Review →" half of the transition for good.
   */
  const moveKey = to ? `${from?.key ?? ""}>${to.key}` : null;
  const [shown, setShown] = useState<{
    key: string | null;
    from: CandidateStatus | null;
    to: CandidateStatus | null;
  }>({ key: moveKey, from: from ?? null, to });
  if (to && moveKey !== shown.key)
    setShown({ key: moveKey, from: from ?? null, to });
  const shownFrom = shown.from;
  const shownTo = shown.to;

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
  const canSubmit = !pending;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  /*
   * Counter appears only in the last 150 characters.
   *
   * A move reason is typically one or two sentences, so a live "6 / 1000" on
   * every keystroke reads as a quota being metered — it makes a free-form box
   * feel like a form field with a budget. The number is only useful as a
   * WARNING, so it shows up when it is one, and turns red at the cap.
   */
  const charHint =
    note.length >= COUNTER_VISIBLE_FROM
      ? `${note.length} / ${MOVE_REASON_MAX}`
      : null;

  // Never opened, nothing retained — render nothing at all rather than an
  // empty shell that would flash if `open` ever raced ahead of `to`.
  if (!shownTo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>Move to {shownTo.label}</DialogTitle>
          <DialogDescription>
            {/* Says the quiet part out loud at the moment of the decision:
                a manual move writes the status and nothing else. The same
                sentence is in the status submenu, and both are load-bearing
                — people reasonably assume a rejection emails the candidate. */}
            This won't email {candidateName || "the candidate"}. Add a reason if
            you want it on their record.
          </DialogDescription>
        </DialogHeader>

        {/* The transition, spelled out. The board move is about to happen
            whatever is in the box, so showing it here is the confirmation
            half of this dialog — the reason is the optional half. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-[13px]">
          {shownFrom ? (
            <>
              <StatusPill status={shownFrom} muted />
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-ink-subtle"
                strokeWidth={1.8}
              />
            </>
          ) : null}
          <StatusPill status={shownTo} />
        </div>

        <div className="grid gap-1.5">
          <label
            htmlFor="candidate-move-reason"
            className="text-[12.5px] font-medium text-ink-muted"
          >
            Reason (optional)
          </label>
          <Textarea
            id="candidate-move-reason"
            autoFocus
            rows={4}
            value={note}
            maxLength={MOVE_REASON_MAX}
            placeholder="Why are you making this move? Your team will see this."
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter only. Plain Enter must stay a newline — this is
              // a multi-line field, and a reason is routinely two sentences.
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
              <span className="pl-1.5">to move</span>
            </span>
            {charHint ? (
              <span
                className={
                  note.length >= MOVE_REASON_MAX ? "text-(--danger)" : undefined
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
            {pending ? <Loader2 className="animate-spin" /> : null}
            {/* Names the destination rather than saying "Confirm", so the
                button itself is the last chance to notice a mis-click in a
                long status list. */}
            Move to {shownTo.label}
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
