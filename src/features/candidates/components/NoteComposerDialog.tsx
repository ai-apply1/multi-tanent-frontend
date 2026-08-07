import { useState } from "react";
import { Loader2, NotebookPen } from "lucide-react";
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

/**
 * Mirrors the server's `NOTE_MAX_LENGTH` (`candidate-note.schema.ts`), so the
 * limit is enforced where it can still be fixed — a 400 on submit after
 * someone has typed a full debrief into a box that accepted it is the worst
 * possible moment to mention a cap.
 *
 * Four times the move-reason cap in `StatusMoveDialog` on purpose: that one
 * annotates a single transition, this one carries call notes and reference
 * checks. Two constants, because they are two columns in two collections.
 */
const NOTE_MAX = 4000;

/** Show the counter only once it starts mattering — see `charHint` below. */
const COUNTER_VISIBLE_FROM = NOTE_MAX - 150;

/**
 * The post-drop note composer, opened from the kanban's "Moved to X" toast.
 *
 * Its own dialog rather than a mode on `StatusMoveDialog`, even though the two
 * look alike: they write different collections (an HR note vs the reason that
 * rides on the transition row), they appear on different screens, and they
 * have different caps. One component serving both is how "note" ends up
 * meaning two things on the same screen, and how two acts on a record that
 * outlives the hire drift into behaving differently.
 *
 * The note IS the action here, so an empty box disables the button — there is
 * nothing else for the submit to do. That is the one behaviour that must not
 * be copied back from the move dialog, where an empty box is the common case.
 *
 * Keyboard: the textarea takes focus on open, Escape closes (Radix), and
 * Cmd/Ctrl+Enter submits from inside it — plain Enter is left alone because
 * this is a multi-line field and stealing Enter would make a two-paragraph
 * note impossible to type.
 */
export function NoteComposerDialog({
  open,
  onOpenChange,
  candidateName,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose record this is — the toast that opens this is long gone by now. */
  candidateName?: string | null;
  pending: boolean;
  /** `body` is trimmed and always non-empty; the button gates on it. */
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState("");

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
    if (open) setBody("");
  }

  const trimmed = body.trim();
  const canSubmit = !pending && trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  /*
   * Counter appears only in the last 150 characters.
   *
   * A live "6 / 4000" on every keystroke reads as a quota being metered — it
   * makes a free-form box feel like a form field with a budget, on the one
   * surface where we want people to write more rather than less. The number is
   * only useful as a WARNING, so it shows up when it is one, and turns red at
   * the cap.
   */
  const charHint =
    body.length >= COUNTER_VISIBLE_FROM ? `${body.length} / ${NOTE_MAX}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>Add a note</DialogTitle>
          <DialogDescription>
            Saved to {candidateName || "the candidate"}'s HR notes with your
            name and the time. You can edit or delete it later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <label
            htmlFor="candidate-note"
            className="text-[12.5px] font-medium text-ink-muted"
          >
            Note
          </label>
          <Textarea
            id="candidate-note"
            autoFocus
            rows={4}
            value={body}
            maxLength={NOTE_MAX}
            placeholder="Anything the rest of the team should know."
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter only. Plain Enter must stay a newline — this is
              // a multi-line field, and a note is routinely several sentences.
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
              <span className="pl-1.5">to save</span>
            </span>
            {charHint ? (
              <span
                className={
                  body.length >= NOTE_MAX ? "text-(--danger)" : undefined
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
            {pending ? <Loader2 className="animate-spin" /> : <NotebookPen />}
            Add note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
