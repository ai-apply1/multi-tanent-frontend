import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UserFormDialog } from "@/features/users/components/UserFormDialog";
import { listUsers, updateUser } from "@/features/users/usersApi";
import { USER_ROLE_LABELS, type OrgUser } from "@/features/users/types";
import { useAuth } from "@/features/auth/AuthContext";
import type { UserRole } from "@/features/auth/types";
import { formatDateTime } from "@/lib/date";
import { errorMessage as apiError } from "@/lib/errors";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/** Sentinel for the "no filter" option (Radix Select forbids empty values). */
const ALL = "all";

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

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      "users",
      { page, limit: pageSize, search, role: roleFilter, status: statusFilter },
    ],
    queryFn: () =>
      listUsers({
        page,
        limit: pageSize,
        search: search.trim() || undefined,
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
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Users className="h-6 w-6 text-primary" />
            Team
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage who can sign in to this organization.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Org admins only</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your role doesn&apos;t include team management. Ask an org admin
              in your organization to add or change members.
            </p>
          </CardContent>
        </Card>
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

  const total = data?.count ?? 0;
  const totalPages = data?.totalPage ?? 0;
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Users className="h-6 w-6 text-primary" />
            Team
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage who can sign in to this organization and what they can do.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add member
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                {total > 0
                  ? `Showing ${showingFrom}–${showingTo} of ${total}`
                  : "No members yet."}
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search members…"
                  className="pl-9"
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
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table containerClassName="max-h-[70vh]">
            <TableHeader className="sticky top-0 z-20 bg-card [&_th]:bg-card">
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="pr-6 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
                    Loading members…
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-destructive"
                  >
                    Could not load members.{" "}
                    <button onClick={() => refetch()} className="underline">
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : (data?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    No members match these filters. Click "Add member" to invite
                    someone.
                  </TableCell>
                </TableRow>
              ) : (
                (data?.data ?? []).map((row) => {
                  // The backend 403s a self-deactivation and a self-role-change,
                  // so neither is offered on your own row.
                  const isSelf = user?.id === row._id;
                  return (
                    <TableRow key={row._id}>
                      <TableCell className="pl-6">
                        <div className="font-medium leading-tight">
                          {row.fullName}
                          {isSelf ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              You
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.userName}
                      </TableCell>
                      <TableCell className="text-sm">{row.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant={row.role === "org_admin" ? "default" : "secondary"}
                        >
                          {USER_ROLE_LABELS[row.role] ?? row.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.isActive ? "success" : "muted"}>
                          {row.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(row.lastLoginAt)}
                      </TableCell>
                      <TableCell className="pr-6 text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${row.fullName}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
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
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>

        <div className="flex flex-col gap-3 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Rows per page
              </span>
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.nextPage || isFetching}
            >
              Next
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>

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
            ? "They lose access immediately and can't sign in. Their account and everything they've done stays put — you can reactivate them at any time."
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
