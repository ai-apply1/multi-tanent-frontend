import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MoreVertical,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  UserSquare2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { UserFormDialog } from "@/features/users/components/UserFormDialog";
import { listUsers, updateUser } from "@/features/users/usersApi";
import { USER_ROLE_LABELS, type OrgUser } from "@/features/users/types";
import { useAuth } from "@/features/auth/AuthContext";
import type { UserRole } from "@/features/auth/types";
import { formatDateTime } from "@/lib/date";
import { errorMessage as apiError } from "@/lib/errors";
import { titleCase } from "@/lib/text";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/** Sentinel for the "no filter" option (Radix Select forbids empty values). */
const ALL = "all";

const COLS = "grid-cols-[1.5fr_1fr_1.5fr_0.9fr_0.9fr_1.3fr_40px]";

export function TeamPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OrgUser | null>(null);
  const [activationTarget, setActivationTarget] = useState<OrgUser | null>(null);

  const isOrgAdmin = user?.role === "org_admin";
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      "users",
      {
        page,
        limit: pageSize,
        search: debouncedSearch,
        role: roleFilter,
        status: statusFilter,
      },
    ],
    queryFn: () =>
      listUsers({
        page,
        limit: pageSize,
        search: debouncedSearch.trim() || undefined,
        role: roleFilter || undefined,
        isActive: statusFilter === "" ? undefined : statusFilter === "active",
      }),
    // The nav hides Team from `hr`, but a hand-typed URL still mounts this
    // page — don't fire a request the backend will 403.
    enabled: isOrgAdmin,
    placeholderData: keepPreviousData,
  });

  const activationMutation = useMutation({
    mutationFn: (row: OrgUser) =>
      updateUser(row._id, { isActive: !row.isActive }),
    onSuccess: (updated) => {
      toast.success(
        updated.isActive ? "Member reactivated." : "Member deactivated.",
      );
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setActivationTarget(null);
    },
    onError: (err) => {
      toast.error(apiError(err, "Could not update member."));
      setActivationTarget(null);
    },
  });

  if (!isOrgAdmin) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
        <div className="mb-5">
          <div className="flex items-center gap-2.5">
            <span className="text-primary">
              <UserSquare2 className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight text-ink">
              Team
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            Recruiters and admins with access to this workspace.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
              <ShieldCheck className="h-6 w-6" strokeWidth={1.7} />
            </span>
            <h3 className="text-[16px] font-semibold text-ink">
              Org admins only
            </h3>
            <p className="max-w-[340px] text-[13.5px] text-ink-muted">
              Your role doesn&apos;t include team management. Ask an org admin
              in your organization to add or change members.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const openEdit = (row: OrgUser) => {
    setEditTarget(row);
    setFormOpen(true);
  };

  const rows = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = data?.totalPage ?? 0;
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-primary">
              <UserSquare2 className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight text-ink">
              Team
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            Recruiters and admins with access to this workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Add member
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">
              Members
              {total > 0 ? (
                <span className="ml-2 text-[12px] font-medium text-ink-muted">
                  {total}
                </span>
              ) : null}
            </div>
            <div className="text-[12px] text-ink-muted">
              {total > 0
                ? `Showing ${showingFrom}–${showingTo} of ${total}`
                : "No members yet."}
            </div>
          </div>
          <div className="flex-1" />
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search members…"
              className="h-9 w-full rounded-lg border border-line bg-surface-3 pl-9 pr-3 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
            />
          </div>
          <Select
            value={roleFilter || ALL}
            onValueChange={(v) => {
              setRoleFilter(v === ALL ? "" : (v as UserRole));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-full sm:w-36">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              <SelectItem value="org_admin">
                {USER_ROLE_LABELS.org_admin}
              </SelectItem>
              <SelectItem value="hr">{USER_ROLE_LABELS.hr}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter || ALL}
            onValueChange={(v) => {
              setStatusFilter(v === ALL ? "" : (v as "active" | "inactive"));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-full sm:w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" strokeWidth={1.9} />
            )}
          </Button>
        </div>

        {/* Table */}
        <div>
          {/* Header row */}
          <div
            className={`grid ${COLS} items-center gap-3 border-b border-line bg-surface-3 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted`}
          >
            <span>Name</span>
            <span>Username</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Last login</span>
            <span />
          </div>

          {isLoading ? (
            <TeamTableSkeleton />
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="text-[13.5px] text-[var(--danger)]">
                Could not load members.
              </p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
                <UserSquare2 className="h-6 w-6" strokeWidth={1.7} />
              </span>
              <h3 className="text-[16px] font-semibold text-ink">
                No members match these filters
              </h3>
              <p className="max-w-[340px] text-[13.5px] text-ink-muted">
                Try a different search, or click &quot;Add member&quot; to
                invite someone.
              </p>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                Add member
              </Button>
            </div>
          ) : (
            rows.map((row) => {
              // The backend 403s a self-deactivation and a self-role-change,
              // so neither is offered on your own row.
              const isSelf = user?.id === row._id;
              return (
                <div
                  key={row._id}
                  onClick={() => openEdit(row)}
                  className={`grid ${COLS} cursor-pointer items-center gap-3 border-b border-line px-5 py-3.5 text-[13.5px] text-ink last:border-b-0 hover:bg-hover`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-ink">
                      {titleCase(row.fullName)}
                    </span>
                    {isSelf ? (
                      <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-muted">
                        You
                      </span>
                    ) : null}
                  </div>
                  <div className="mono truncate text-[12.5px] text-ink-muted">
                    {/* Usernames are canonical lowercase login handles — show
                        them verbatim, never title-cased. */}
                    {row.userName}
                  </div>
                  <div className="truncate text-[13px] text-ink-2">
                    {row.email}
                  </div>
                  <div>
                    <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-[11.5px] font-semibold text-primary">
                      {USER_ROLE_LABELS[row.role] ?? row.role}
                    </span>
                  </div>
                  <div>
                    {row.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--success)]">
                        <Check className="h-3 w-3" strokeWidth={2.6} />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--warning-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--warning)]">
                        <Clock className="h-3 w-3" strokeWidth={2.2} />
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-ink-muted">
                    {formatDateTime(row.lastLoginAt)}
                  </div>
                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Actions for ${row.fullName}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
                        >
                          <MoreVertical className="h-4 w-4" strokeWidth={1.9} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-48"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenuItem onSelect={() => openEdit(row)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={isSelf}
                          onSelect={() => setActivationTarget(row)}
                        >
                          {row.isActive ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination footer */}
        <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-ink-muted">Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-18">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-ink-muted">
              <span>
                Page {page} of {Math.max(totalPages, 1)}
              </span>
              {isFetching ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.nextPage || isFetching}
            >
              Next
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </Button>
          </div>
        </div>
      </div>

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editTarget}
        isSelf={Boolean(editTarget && user?.id === editTarget._id)}
      />

      {/* Deactivation is reversible and keeps the member's history, so it is a
          plain confirm — not a destructive one. */}
      <ConfirmDialog
        open={Boolean(activationTarget)}
        onOpenChange={(o) => !o && setActivationTarget(null)}
        title={
          activationTarget?.isActive
            ? `Deactivate ${activationTarget?.fullName}?`
            : `Reactivate ${activationTarget?.fullName ?? "member"}?`
        }
        description={
          activationTarget?.isActive
            ? "They lose access immediately and can't sign in. Their account and everything they've done stays put, you can reactivate them at any time."
            : "They get their access back and can sign in with their existing password."
        }
        confirmLabel={activationTarget?.isActive ? "Deactivate" : "Reactivate"}
        loadingLabel={
          activationTarget?.isActive ? "Deactivating…" : "Reactivating…"
        }
        loading={activationMutation.isPending}
        onConfirm={() =>
          activationTarget && activationMutation.mutate(activationTarget)
        }
      />
    </div>
  );
}

/**
 * Loading placeholder for the members table. Skeleton rows on the SAME `COLS`
 * grid as the real rows and the live header — name, username, email, a role
 * pill, a status pill, last login, and the trailing actions slot.
 */
function TeamTableSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={`grid ${COLS} items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0`}
        >
          <Skeleton className="h-3.5 w-28 max-w-full" />
          <Skeleton className="h-3 w-24 max-w-full" />
          <Skeleton className="h-3.5 w-36 max-w-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-3 w-24 max-w-full" />
          <Skeleton className="ml-auto h-8 w-8 rounded-md" />
        </div>
      ))}
    </div>
  );
}
