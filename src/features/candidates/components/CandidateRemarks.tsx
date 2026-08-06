import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Loader2, MessageSquare, MessageSquarePlus } from "lucide-react";
import toast from "react-hot-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthContext";
import {
  addCandidateRemark,
  getCandidateRemarks,
} from "@/features/candidates/candidatesApi";
import { remarksQueryKey } from "@/features/candidates/candidatesCache";
import type {
  CandidateActivity,
  PaginatedActivities,
} from "@/features/candidates/types";
import { formatDateTime, formatRelativeTime } from "@/lib/date";
import { errorMessage } from "@/lib/errors";

/** Mirrors the server cap on `AddRemarkDto.note`. */
const REMARK_MAX = 1000;

/** How many thread rows each "Load earlier" click fetches. */
const REMARKS_PAGE_SIZE = 25;

/**
 * The candidate drawer's REMARKS thread: what people wrote, and the manual
 * pipeline moves those remarks are about.
 *
 * Sibling to the Activity tab, not a replacement for it, and the split is the
 * point. Activity answers "what happened to this candidate" — invites,
 * scores, automated emails, machine notes, scoped to one interview attempt.
 * This answers "what does my team think", which is a different question asked
 * at a different moment, spans the WHOLE candidate (most remarks are written
 * while screening the CV, before any attempt exists), and is the only one of
 * the two you can write to.
 *
 * Newest first, with the composer above the list, so what you just wrote
 * appears immediately under the box you wrote it in — no scroll, no hunt. The
 * Activity tab runs oldest-first for the opposite reason: it is a narrative of
 * a process with a beginning, and reads down.
 */
export function CandidateRemarks({
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

  const thread = useInfiniteQuery({
    queryKey: remarksQueryKey(candidateId),
    queryFn: ({ pageParam }) =>
      getCandidateRemarks(candidateId, {
        page: pageParam,
        limit: REMARKS_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: Boolean(candidateId),
  });

  const addRemark = useMutation({
    mutationFn: (note: string) => addCandidateRemark(candidateId, note),
    onSuccess: (created) => {
      /*
       * Splice the created row into the page we already have rather than
       * refetching. The server returns it in the feed's own wire shape for
       * exactly this, and the alternative is a visible round-trip in which
       * the composer has cleared but the remark has not appeared — the one
       * window in which someone retypes what they just wrote.
       *
       * Prepended to page ONE because the thread is newest-first, which is
       * also where it lands on the next real fetch, so the optimistic order
       * and the server's order agree.
       */
      queryClient.setQueryData<InfiniteData<PaginatedActivities>>(
        remarksQueryKey(candidateId),
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
      toast.error(errorMessage(err, "Could not save your remark."));
    },
  });

  const trimmed = draft.trim();
  const rows = (thread.data?.pages ?? []).flatMap((page) => page.data);

  return (
    <div className="grid gap-4">
      {canWrite ? (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <Textarea
            rows={3}
            value={draft}
            maxLength={REMARK_MAX}
            placeholder="Add a remark for your team…"
            disabled={addRemark.isPending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter, never bare Enter: remarks run to two or three
              // sentences and a newline has to stay a newline.
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                trimmed
              ) {
                event.preventDefault();
                addRemark.mutate(trimmed);
              }
            }}
            className="resize-y border-0 bg-transparent p-0 text-[13.5px] shadow-none focus-visible:ring-0"
          />
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-[11.5px] text-ink-subtle">
              {/* Says the two things people assume otherwise, before they
                  write rather than after: this is internal, and it is
                  permanent. Both are cheap to say here and expensive to
                  discover later. */}
              Visible to your team. Can't be edited or deleted.
            </span>
            <Button
              size="sm"
              disabled={!trimmed || addRemark.isPending}
              onClick={() => addRemark.mutate(trimmed)}
            >
              {addRemark.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MessageSquarePlus />
              )}
              Add remark
            </Button>
          </div>
        </div>
      ) : null}

      {thread.isLoading ? (
        <RemarksSkeleton />
      ) : rows.length === 0 ? (
        <EmptyRemarks canWrite={canWrite} />
      ) : (
        <div className="grid gap-2.5">
          {rows.map((row) => (
            <RemarkRow
              key={row.id}
              row={row}
              isMine={Boolean(row.actorId && row.actorId === user?.id)}
              timeZone={timeZone}
            />
          ))}
          {thread.hasNextPage ? (
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
    </div>
  );
}

/**
 * One row of the thread.
 *
 * Two shapes, from the same feed. A move with nothing said is a THIN DIVIDER
 * — it is context for the remarks around it, not content of its own, and
 * giving it a full card would bury a three-word remark under a wall of
 * "moved to" rows on any candidate who has been through the funnel twice. A
 * remark (standalone, or one that rode a move) is a CARD.
 */
function RemarkRow({
  row,
  isMine,
  timeZone,
}: {
  row: CandidateActivity;
  isMine: boolean;
  timeZone?: string;
}) {
  const exact = formatDateTime(row.createdAt, timeZone);
  const relative = formatRelativeTime(row.createdAt, timeZone);
  const who = displayName(row.actorName);

  if (row.type === "status_changed" && !row.note) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-0.5 text-[12px] text-ink-subtle">
        <span className="h-px flex-1 bg-border" />
        <span className="flex shrink-0 items-center gap-1.5">
          <StatusDot status={row.toStatus} />
          <span>
            {isMine ? "You" : who} moved to{" "}
            <span className="font-medium text-ink-muted">
              {statusLabel(row.toStatus)}
            </span>
          </span>
          <span aria-hidden>·</span>
          <time dateTime={row.createdAt} title={exact}>
            {relative}
          </time>
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

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
        </div>

        {/* A remark that rode a status move carries its destination, which is
            what makes a run of remarks legible as eras rather than a flat
            list. */}
        {row.type === "status_changed" ? (
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11.5px] text-ink-muted">
            <StatusDot status={row.toStatus} />
            Moved to {statusLabel(row.toStatus)}
          </span>
        ) : null}

        {/* `whitespace-pre-wrap` so the paragraph breaks someone typed are the
            paragraph breaks their colleague reads. `break-words` so a pasted
            URL wraps instead of stretching the drawer. */}
        <p className="mt-1.5 whitespace-pre-wrap wrap-break-word text-[13.5px] leading-relaxed text-ink-2">
          {row.note}
        </p>
      </div>
    </div>
  );
}

function EmptyRemarks({ canWrite }: { canWrite: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-ink-subtle">
        <MessageSquare className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <p className="text-[13.5px] font-semibold text-ink">No remarks yet</p>
      <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] leading-relaxed text-ink-muted">
        {canWrite
          ? "Notes you and your team add here stay on the candidate's record — including any you attach when moving them through the pipeline."
          : "Notes your team adds stay on the candidate's record, including any attached to a pipeline move."}
      </p>
    </div>
  );
}

function RemarksSkeleton() {
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

/** The catalog colour for a timeline status ref, or a neutral dot. */
function StatusDot({ status }: { status: CandidateActivity["toStatus"] }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: status?.color ?? "var(--ink-subtle)" }}
    />
  );
}

/**
 * A timeline status ref is three-state (see `CandidateActivity`): an object
 * while the column still exists, `null` once it has been deleted, and absent
 * when the row never named one. Only the middle case gets a label of its own —
 * never hide the row over it.
 */
function statusLabel(status: CandidateActivity["toStatus"]): string {
  if (status === null) return "a deleted status";
  return status?.label ?? "another status";
}

/**
 * `actorName` is frozen at write time. Rows written before the actor's
 * display name was recorded carry the EMAIL instead, so strip the domain
 * rather than printing `sarah@acme.com` as if it were a person's name.
 * New rows carry `fullName` and fall through untouched.
 */
function displayName(actorName: string | null): string {
  if (!actorName) return "A teammate";
  const at = actorName.indexOf("@");
  return at > 0 ? actorName.slice(0, at) : actorName;
}

/** Up to two initials — "Sarah Chen" → SC, "sarah.chen" → S. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}
