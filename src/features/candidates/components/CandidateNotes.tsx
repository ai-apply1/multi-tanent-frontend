import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthContext";
import {
  createHrNote,
  deleteHrNote,
  listHrNotes,
  updateHrNote,
} from "@/features/candidates/candidatesApi";
import { hrNotesQueryKey } from "@/features/candidates/candidatesCache";
import type { HrNote, PaginatedHrNotes } from "@/features/candidates/types";
import { formatDateTime, formatRelativeTime } from "@/lib/date";
import { errorMessage } from "@/lib/errors";

/** Mirrors `NOTE_MAX_LENGTH` on the server's `candidate-note.schema.ts`. */
const NOTE_MAX = 4000;

/** Show the counter only once it starts mattering — see `CharCounter`. */
const COUNTER_VISIBLE_FROM = NOTE_MAX - 150;

/** How many thread rows each "Load earlier" click fetches. */
const NOTES_PAGE_SIZE = 25;

/**
 * The candidate drawer's HR NOTES thread: what the team wrote about this
 * person, newest first.
 *
 * Sibling to the Activity tab, not a replacement for it, and the split is the
 * point. Activity answers "what happened to this candidate" — invites, scores,
 * automated emails, machine notes, status moves and the reason attached to
 * one, scoped to a single interview attempt. This answers "what does my team
 * think", which is a different question asked at a different moment, spans the
 * WHOLE candidate (most notes are written while screening the CV, before any
 * attempt exists), and is the only one of the two you can write to.
 *
 * Nothing from the pipeline appears here. A note is only ever something a
 * person typed into this box, which is what makes every row the same shape and
 * the thread readable as a conversation rather than a feed.
 *
 * Newest first, with the composer above the list, so what you just wrote
 * appears immediately under the box you wrote it in — no scroll, no hunt. The
 * Activity tab runs oldest-first for the opposite reason: it is a narrative of
 * a process with a beginning, and reads down.
 */
export function CandidateNotes({
  candidateId,
  canWrite,
  timeZone,
}: {
  candidateId: string;
  /** False for `interviewer` (view-only) — the backend 403s the write too. */
  canWrite: boolean;
  timeZone?: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  /*
   * Which row is open in the inline editor, and its working copy. Lifted to
   * the thread rather than kept per row so only one note can be open at a
   * time: two half-finished rewrites on the same screen is a way to save the
   * wrong one, and the Save/Cancel pair only reads as a decision when there
   * is exactly one of it.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HrNote | null>(null);

  const thread = useInfiniteQuery({
    queryKey: hrNotesQueryKey(candidateId),
    queryFn: ({ pageParam }) =>
      listHrNotes(candidateId, {
        page: pageParam,
        limit: NOTES_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: Boolean(candidateId),
  });

  const addNote = useMutation({
    mutationFn: (body: string) => createHrNote(candidateId, body),
    onSuccess: (created) => {
      /*
       * Splice the created row into the page we already have rather than
       * refetching. The server returns it in the feed's own wire shape for
       * exactly this, and the alternative is a visible round-trip in which
       * the composer has cleared but the note has not appeared — the one
       * window in which someone retypes what they just wrote.
       *
       * Prepended to page ONE because the thread is newest-first, which is
       * also where it lands on the next real fetch, so the optimistic order
       * and the server's order agree.
       */
      queryClient.setQueryData<InfiniteData<PaginatedHrNotes>>(
        hrNotesQueryKey(candidateId),
        (current) => {
          if (!current?.pages.length) return current;
          const [first, ...rest] = current.pages;
          return {
            ...current,
            pages: [{ ...first, data: [created, ...first.data] }, ...rest],
          };
        }
      );
      setDraft("");
    },
    onError: (err) => {
      // The draft is deliberately NOT cleared on failure — see `onSuccess`.
      toast.error(errorMessage(err, "Could not save your note."));
    },
  });

  const editNote = useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      updateHrNote(candidateId, noteId, body),
    onSuccess: (saved) => {
      /*
       * Applied on SUCCESS, never optimistically. A rewrite that paints
       * instantly and then snaps back on a 403 (someone else's note, forced
       * through) or a dropped connection reads as the app losing your words,
       * which is the one thing a note-taking surface cannot afford to look
       * like. The request is a single small PATCH; there is nothing to hide.
       *
       * Replaced IN PLACE across every fetched page, not moved. The thread is
       * ordered by when a thing was WRITTEN — a note that jumps to the top
       * because someone fixed a typo destroys the only ordering the thread
       * has, and the server leaves `createdAt` alone for the same reason.
       */
      queryClient.setQueryData<InfiniteData<PaginatedHrNotes>>(
        hrNotesQueryKey(candidateId),
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  data: page.data.map((row) =>
                    row.id === saved.id ? saved : row
                  ),
                })),
              }
            : current
      );
      setEditingId(null);
      setEditDraft("");
    },
    onError: (err) => {
      // The editor stays open with the draft intact, for the same reason the
      // composer keeps its text: a failed write is when the words are least
      // reproducible.
      toast.error(errorMessage(err, "Could not save your changes."));
    },
  });

  const removeNote = useMutation({
    mutationFn: (noteId: string) => deleteHrNote(candidateId, noteId),
    onSuccess: (result) => {
      /*
       * Also on success, and here the reason is sharper than for the edit: a
       * rolled-back optimistic delete is a note that vanishes off a hiring
       * record and then reappears, which every reader will file as a bug in
       * the record rather than a failed request.
       *
       * Only `data` is filtered. `count` / `totalPage` are left as the server
       * last reported them because nothing on this screen renders them, and
       * "Load earlier" walks the server's own `nextPage` cursor — hand-
       * recomputing a paginated envelope in the cache is how it starts
       * disagreeing with the collection it describes.
       */
      queryClient.setQueryData<InfiniteData<PaginatedHrNotes>>(
        hrNotesQueryKey(candidateId),
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  data: page.data.filter((row) => row.id !== result.noteId),
                })),
              }
            : current
      );
      toast.success("Note deleted.");
    },
    onError: (err) => {
      // 403 (someone else's note, and not an org admin) carries a message
      // naming the actual reason — surface it as-is.
      toast.error(errorMessage(err, "Could not delete the note."));
    },
    // Close on either outcome: a 403 is a permanent "no" for this row, so
    // leaving the dialog up to retry would only cover the toast.
    onSettled: () => setDeleteTarget(null),
  });

  const startEdit = (row: HrNote) => {
    setEditingId(row.id);
    setEditDraft(row.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const saveEdit = (row: HrNote) => {
    const body = editDraft.trim();
    // An empty box is what Delete is for, and the server 400s it anyway.
    if (!body || editNote.isPending) return;
    /*
     * An untouched body is a cancel, not a write. The server stamps
     * `editedAt` on every PATCH, so saving a note someone opened and thought
     * better of would hang "· edited" on it — a marker that then means
     * nothing on any row that carries it.
     */
    if (body === row.body) {
      cancelEdit();
      return;
    }
    editNote.mutate({ noteId: row.id, body });
  };

  const trimmed = draft.trim();
  const rows = (thread.data?.pages ?? []).flatMap((page) => page.data);

  return (
    <div className="grid gap-4">
      {canWrite ? (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <Textarea
            rows={3}
            value={draft}
            maxLength={NOTE_MAX}
            placeholder="Add a note for your team…"
            /*
             * `readOnly` while the write is in flight, NOT `disabled`.
             *
             * Disabling the focused textarea makes the browser drop focus to
             * `<body>`, and the button's icon swap in that same commit trips
             * Radix's FocusScope MutationObserver, which then parks focus on
             * the drawer's `tabindex="-1"` Content node. After a KEYBOARD
             * submit that node still matches `:focus-visible`, so the browser
             * rings the entire drawer — the pending state of a 200ms request
             * lighting up an 860px panel.
             *
             * `focus:outline-none` on SheetContent kills the ring; this kills
             * the focus jump behind it, which is the part that was actually
             * costing something: the caret stays in the composer, so the line
             * after the one you just sent starts where you're already typing
             * instead of somewhere up the drawer.
             */
            readOnly={addNote.isPending}
            aria-busy={addNote.isPending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter, never bare Enter: notes run to two or three
              // sentences and a newline has to stay a newline.
              //
              // `isPending` is checked HERE — a read-only field still
              // delivers keydown (a disabled one did not), so a second
              // shortcut press landing mid-flight would post the same note
              // twice and leave someone deleting their own duplicate.
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                trimmed &&
                !addNote.isPending
              ) {
                event.preventDefault();
                addNote.mutate(trimmed);
              }
            }}
            /*
             * `-mx-2 px-2` is one gesture, not two competing ones: the padding
             * is what the field needs, the negative margin is what the LAYOUT
             * needs, and they cancel to zero.
             *
             * A borderless composer wants its text to line up with the caption
             * and the button under it, and the cheap way to get that is `p-0`.
             * But a text field's caret is drawn AT the text origin, so with no
             * padding the origin sits exactly on the content-box edge and the
             * browser clips the caret and the leading pixel column of the
             * first glyph against it — which is why the "A" of the
             * placeholder looked shaved. Padding the field and pulling the box
             * back out by the same 8px keeps the text where the design wants
             * it and gives the caret somewhere to live.
             *
             * The width has to grow by that same 1rem. `w-full` under a
             * negative margin doesn't widen the box, it MOVES it — the field
             * would hang 8px off the right edge and every line would wrap
             * 16px early. `calc(100%+1rem)` puts the two 8px pads outside the
             * old box on both sides, so the text column is exactly what it
             * was.
             *
             * `py-0` stays: vertical padding inside a textarea scrolls with
             * the content, so it buys nothing here, and it would drop the
             * resize grip onto the divider below.
             */
            className="-mx-2 w-[calc(100%+1rem)] resize-y border-0 bg-transparent px-2 py-0 text-[13.5px] shadow-none focus-visible:ring-0"
          />
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-[11.5px] text-ink-subtle">
              {/* Says the two things people assume otherwise, before they
                  write rather than after: this never leaves the team, and
                  it is yours to fix afterwards. Both are cheap to say here
                  and expensive to discover later — and the second one is
                  what stops a typo from being a reason to write less. */}
              Only your team sees this. You can edit or delete your own notes.
            </span>
            <div className="flex shrink-0 items-center gap-3">
              <CharCounter length={draft.length} />
              <Button
                size="sm"
                disabled={!trimmed || addNote.isPending}
                onClick={() => addNote.mutate(trimmed)}
              >
                {addNote.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Add note
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {thread.isLoading ? (
        <NotesSkeleton />
      ) : rows.length === 0 ? (
        <EmptyNotes canWrite={canWrite} />
      ) : (
        <div className="grid gap-2.5">
          {rows.map((row) => {
            const isMine = Boolean(row.authorId && row.authorId === user?.id);
            return (
              <NoteRow
                key={row.id}
                row={row}
                isMine={isMine}
                /*
                 * Nobody edits someone else's words — not even an org admin,
                 * who may take a note OFF the record but never reword it
                 * under its author's byline. The server enforces both; this
                 * is the same rule spelled in the UI so the affordance and
                 * the 403 agree.
                 */
                canEdit={canWrite && isMine}
                canDelete={
                  canWrite && (isMine || user?.role === "org_admin")
                }
                timeZone={timeZone}
                editing={editingId === row.id}
                editDraft={editDraft}
                onEditDraftChange={setEditDraft}
                onStartEdit={() => startEdit(row)}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => saveEdit(row)}
                saving={editNote.isPending}
                onDelete={() => setDeleteTarget(row)}
              />
            );
          })}
          {thread.hasNextPage ? (
            // An explicit button, not an infinite scroller: the thread lives
            // inside the drawer's own scroll container, so an observer would
            // have to be rooted on that node to fire at all — and a click is
            // the honest control when the rest of the panel is also scrolling
            // past.
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-center"
              disabled={thread.isFetchingNextPage}
              onClick={() => void thread.fetchNextPage()}
            >
              {thread.isFetchingNextPage ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Load earlier
            </Button>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this note?"
        description={
          <>
            This removes the note for everyone on your team. This cannot be
            undone.
            {deleteTarget && deleteTarget.authorId !== user?.id ? (
              <>
                {" "}
                {/* Named out loud: an org admin deleting a colleague's note is
                    a different act from tidying up your own, and the confirm
                    step is the last place to notice which one this is. */}
                It was written by {displayName(deleteTarget.authorName)}, not
                by you.
              </>
            ) : null}
          </>
        }
        confirmLabel="Delete note"
        loadingLabel="Deleting…"
        destructive
        loading={removeNote.isPending}
        onConfirm={() => deleteTarget && removeNote.mutate(deleteTarget.id)}
      />
    </div>
  );
}

/**
 * One note. There is exactly ONE row shape here, deliberately — the thread
 * carries nothing but text a person typed, so a second shape would have to be
 * invented for something that no longer lands in this collection.
 */
function NoteRow({
  row,
  isMine,
  canEdit,
  canDelete,
  timeZone,
  editing,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  saving,
  onDelete,
}: {
  row: HrNote;
  isMine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  timeZone?: string;
  editing: boolean;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  saving: boolean;
  onDelete: () => void;
}) {
  const exact = formatDateTime(row.createdAt, timeZone);
  const relative = formatRelativeTime(row.createdAt, timeZone);
  const who = displayName(row.authorName);

  /*
   * Radix returns focus to the kebab trigger when the menu closes, and that
   * restore runs AFTER React has mounted the inline editor — so the caret
   * lands back on the three dots and the field you just asked for opens
   * unfocused.
   *
   * Suppress the restore only for the close that hands focus somewhere
   * deliberate (Edit → the textarea's `autoFocus`; Delete → the confirm
   * dialog's own FocusScope) and keep it for every other close. A blanket
   * `preventDefault` would leave a plain Escape with nowhere to send focus,
   * and it would land on `<body>` — the drawer-wide focus ring documented on
   * the composer above.
   */
  const handoff = useRef(false);

  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-surface p-3.5">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="text-[11.5px]">
          {initialsOf(who)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-ink">{who}</span>
          {isMine ? (
            // A quiet chip, not a colour-flooded one: on your own candidates
            // most rows are yours, and a loud badge on every card would be
            // pure noise. It only has to answer "was that me?" at a glance.
            <span className="rounded-full border border-border bg-surface-3 px-1.5 py-px text-[10.5px] font-medium text-ink-muted">
              You
            </span>
          ) : null}
          {/* Relative on the face, exact on hover. "3h ago" is the question
              people actually have; the timestamp is one hover away and never
              lost. */}
          <time
            dateTime={row.createdAt}
            title={exact}
            className="text-[11.5px] text-ink-subtle"
          >
            {relative}
          </time>
          {/* Driven by `editedAt`, which the server sets on the body-edit path
              and nothing else. Never `updatedAt !== createdAt`: that starts
              lying the first time any other field is written, and then every
              row wears the marker. */}
          {row.editedAt ? (
            <span
              className="text-[11.5px] text-ink-subtle"
              title={formatDateTime(row.editedAt, timeZone)}
            >
              · edited
            </span>
          ) : null}

          {canEdit || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label="Note actions"
                  className="-my-1 ml-auto shrink-0 text-ink-muted"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-40"
                onCloseAutoFocus={(event) => {
                  if (!handoff.current) return;
                  handoff.current = false;
                  event.preventDefault();
                }}
              >
                {canEdit ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      handoff.current = true;
                      onStartEdit();
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <DropdownMenuItem
                    className="text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)]"
                    onSelect={() => {
                      handoff.current = true;
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {editing ? (
          /*
           * Edited in place, not in a modal. What you are rewriting is almost
           * always relative to the notes around it — the call it followed up
           * on, the thing a colleague asked — and a dialog covers exactly
           * that context while asking you to reword against it.
           */
          <div className="mt-1.5 grid gap-2">
            <Textarea
              autoFocus
              rows={4}
              value={editDraft}
              maxLength={NOTE_MAX}
              aria-label="Edit note"
              // `readOnly`, not `disabled`, for the same focus reason as the
              // composer.
              readOnly={saving}
              aria-busy={saving}
              onChange={(event) => onEditDraftChange(event.target.value)}
              onKeyDown={(event) => {
                // Same contract as the composer: Cmd/Ctrl+Enter saves, plain
                // Enter stays a newline, and `saving` is re-checked because a
                // read-only field still delivers keydown.
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  if (!saving) onSaveEdit();
                  return;
                }
                // Escape abandons the EDIT. Propagation is stopped so it
                // doesn't reach the drawer's dismiss handler underneath —
                // backing out of a typo fix must not also close the panel
                // you were reading.
                if (event.key === "Escape" && !saving) {
                  event.preventDefault();
                  event.stopPropagation();
                  onCancelEdit();
                }
              }}
              className="resize-y text-[13.5px]"
            />
            <div className="flex items-center justify-end gap-3">
              <CharCounter length={editDraft.length} />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={onCancelEdit}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={saving || !editDraft.trim()}
                  onClick={onSaveEdit}
                >
                  {saving ? <Loader2 className="animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* `whitespace-pre-wrap` so the paragraph breaks someone typed are the
             paragraph breaks their colleague reads. `wrap-break-word` so a
             pasted URL wraps instead of stretching the drawer. */
          <p className="mt-1.5 whitespace-pre-wrap wrap-break-word text-[13.5px] leading-relaxed text-ink-2">
            {row.body}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The character counter, shown only in the last 150 characters.
 *
 * Notes are typically a sentence or two, so a live "6 / 4000" on every
 * keystroke reads as a quota being metered — it makes a free-form box feel
 * like a form field with a budget. The number is only useful as a WARNING, so
 * it appears when it is one, and turns red at the cap.
 */
function CharCounter({ length }: { length: number }) {
  if (length < COUNTER_VISIBLE_FROM) return null;
  return (
    <span
      className={`shrink-0 text-[11.5px] ${
        length >= NOTE_MAX ? "text-(--danger)" : "text-ink-subtle"
      }`}
    >
      {length} / {NOTE_MAX}
    </span>
  );
}

function EmptyNotes({ canWrite }: { canWrite: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-ink-subtle">
        <NotebookPen className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <p className="text-[13.5px] font-semibold text-ink">No notes yet</p>
      <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] leading-relaxed text-ink-muted">
        {canWrite
          ? "This is your team's own thread on the candidate — what came up on a call, what to check next. What happened in the pipeline is kept separately, on the Activity timeline."
          : "Notes your team writes about this candidate appear here, newest first. What happened in the pipeline is kept separately, on the Activity timeline."}
      </p>
    </div>
  );
}

function NotesSkeleton() {
  return (
    <div className="grid gap-2.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex gap-3 rounded-2xl border border-border bg-surface p-3.5"
        >
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-32 max-w-full" />
            <Skeleton className="mt-2 h-3 w-full max-w-104" />
            <Skeleton className="mt-1.5 h-3 w-40 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * `authorName` is frozen at write time. Rows carried over from the old remarks
 * thread can hold the EMAIL instead of a display name, so strip the domain
 * rather than printing `sarah@acme.com` as if it were a person's name. Notes
 * written since carry `fullName` and fall through untouched.
 */
function displayName(authorName: string | null): string {
  if (!authorName) return "A teammate";
  const at = authorName.indexOf("@");
  return at > 0 ? authorName.slice(0, at) : authorName;
}

/** Up to two initials — "Sarah Chen" → SC, "sarah.chen" → S. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}
