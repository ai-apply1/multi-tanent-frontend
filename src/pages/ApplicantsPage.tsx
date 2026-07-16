import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";
import axios from "axios";
import {
  BadgeCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MailWarning,
  MessageSquareText,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Tag,
  Trash2,
  UserCheck,
  UserX,
  Video,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { InterviewDetailDrawer } from "@/components/interviews/InterviewDetailDrawer";
import { PhoneActions } from "@/components/PhoneActions";
import { SendTechnicalInviteDialog } from "@/features/applicants/components/SendTechnicalInviteDialog";
import {
  assignApplicantLabel,
  bulkDeleteApplicants,
  bulkResendInvites,
  bulkRestartFollowup,
  deleteApplicant,
  exportApplicantsCsv,
  getApplicantCvUrl,
  getSourceOptions,
  listApplicants,
  reattemptInterview,
  removeApplicantLabel,
  resendInvite,
  restartFollowup,
} from "@/features/applicants/applicantsApi";
import type {
  AiDecisionFilter,
  ApplicantListItem,
  ApplicantSortOrder,
  InitialDecision,
} from "@/features/applicants/types";
import {
  formatCity,
  formatSourceLabel,
  formatYearsOfExperience,
} from "@/features/applicants/helpers";
import {
  deliveryBadge,
  emailSuppressionLabel,
  followupDisplay,
  smsDeliveryBadge,
} from "@/features/applicants/followupHelpers";
import {
  SendTemplateDialog,
  type SendTemplateTarget,
} from "@/features/templates/components/SendTemplateDialog";
import { BulkSendTemplateDialog } from "@/features/templates/components/BulkSendTemplateDialog";
import {
  IndirectCandidateFormDialog,
  type ActivateApplicantTarget,
} from "@/features/indirect-candidates/components/IndirectCandidateFormDialog";
import {
  ACTIVATION_LABELS,
  FINAL_DECISION_GROUP,
  FINAL_DECISION_LABELS,
  FINAL_REJECTION_EMAIL_LABELS,
  MANUAL_REJECTION_EMAIL_LABELS,
  MANUAL_VERDICT_GROUP,
  POST_FINAL_INTEREST_GROUP,
  POST_FINAL_INTEREST_LABELS,
  PRE_SCHEDULE_INTEREST_GROUP,
  PRE_SCHEDULE_INTEREST_LABELS,
  RESPONSE_LABELS,
  resolveChipDisplay,
  resolveLabel,
  SCHEDULING_LABELS,
  VERDICT_LABELS,
} from "@/features/applicants/labelsCatalog";
import { usePipelineCatalog } from "@/features/pipeline/usePipelineCatalog";
import { SavedFilterBar } from "@/features/savedFilters/components/SavedFilterBar";
import type { SavedFilterCriteria } from "@/features/savedFilters/types";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 500, 1000];
const DEFAULT_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Filter dropdown options — the pre-screen and AI stages are filtered
// INDEPENDENTLY (two dropdowns) so operators can slice on either axis or
// both at once (e.g. "Initial pass" + "AI pending" = cleared pre-screen,
// interview still outstanding). Each maps to its own backend query param
// (`initialDecision` / `aiDecision`).
// ---------------------------------------------------------------------------

const INITIAL_FILTER_OPTIONS: {
  value: "all" | InitialDecision;
  label: string;
}[] = [
  { value: "all", label: "All initial" },
  { value: "pass", label: "Initial pass" },
  { value: "rejection", label: "Initial rejection" },
];

const AI_FILTER_OPTIONS: { value: "all" | AiDecisionFilter; label: string }[] =
  [
    { value: "all", label: "All AI" },
    { value: "pending", label: "AI pending" },
    { value: "pass", label: "AI pass" },
    { value: "rejection", label: "AI rejection" },
  ];

// Order options for the Sort dropdown. `newest`/`oldest` sort by submission
// time; the two "Scheduled" options sort by the scheduled interview date
// (server-side, unscheduled applicants last). Labels stay friendly rather
// than exposing the column name.
const SORT_OPTIONS: { value: ApplicantSortOrder; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "scheduled_soonest", label: "Scheduled: Oldest" },
  { value: "scheduled_latest", label: "Scheduled: Newest" },
];

// Marketing-source filter for the Source dropdown (next to Sort). "all" shows
// everyone; "direct" = arrived with no campaign tag. Every other value is a raw
// utmSource tag pulled LIVE from the DB (getSourceOptions), so there is no fixed
// option list here. Labels come from `formatSourceLabel`; see backend
// utm-source.ts.

/** Badge colour for a Source chip: muted for Direct, a stable accent otherwise. */
function sourceBadgeVariant(source: string): BadgeVariant {
  return source === "direct" ? "muted" : "default";
}

/** ISO -> value for an <input type="datetime-local"> in the viewer's tz. */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: true,
    }).format(d);
  } catch {
    return d.toLocaleString(undefined, { hour12: true });
  }
}

function formatRole(raw: string): string {
  if (!raw) return "—";
  return raw
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

// Which filter a trigger belongs to. Most filters are "catalog" (their value
// IS a status-chip key, so we read the colour straight from the catalog); the
// pre-pipeline funnel filters carry values that aren't catalog keys and map to
// a chip colour explicitly.
type FilterKind = "initial" | "ai" | "email" | "linkRequested" | "catalog";

// Resolve a filter's CURRENT value to the status-chip variant it represents,
// or null when the filter is inactive ("all"). For catalog-backed filters the
// value is itself a chip key, so we look it up; the funnel filters map by hand.
function activeFilterVariant(
  kind: FilterKind,
  value: string,
): BadgeVariant | null {
  if (value === "all") return null;
  switch (kind) {
    case "initial":
      // Initial Decision: pass / rejection (no catalog key on the filter).
      return value === "pass" ? "successSolid" : "destructiveSolid";
    case "ai":
      // AI Decision: pass / rejection / pending.
      return value === "pass"
        ? "successSolid"
        : value === "rejection"
          ? "destructiveSolid"
          : "muted";
    case "email":
      // Initial Email: only "suppressed" (a hard bounce / complaint).
      return "destructive";
    case "linkRequested":
      // Link Request: only "pending" (mirrors the purple "Link requested" chip).
      return "default";
    case "catalog":
    default:
      return resolveLabel(value)?.variant ?? "muted";
  }
}

// Trigger styling for a filter dropdown, colour-coded to the selected status's
// chip colour so the operator can see at a glance not just WHICH filters are
// applied but WHAT they're filtering to: green for a pass, red for a rejection,
// amber for anything else active. Inactive filters keep the neutral default.
function filterTriggerClass(variant: BadgeVariant | null): string {
  if (!variant) return "w-full";
  const tint =
    variant === "successSolid" || variant === "success"
      ? "border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
      : variant === "destructiveSolid" || variant === "destructive"
        ? "border-destructive bg-destructive/10 text-destructive"
        : "border-[var(--warning)] bg-[var(--warning)]/10 text-[var(--warning)]";
  return cn("w-full", tint);
}

export function ApplicantsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // Records-per-page. Part of the React-Query cache key (below) so a
  // change refetches against the new limit. Reset to page 1 on change
  // so the operator can't land on a now-out-of-range page.
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Independent pre-screen + AI stage filters (two dropdowns).
  const [initialFilter, setInitialFilter] = useState<"all" | InitialDecision>(
    "all",
  );
  const [aiFilter, setAiFilter] = useState<"all" | AiDecisionFilter>("all");
  const [search, setSearch] = useState("");
  // Sort order is part of the React-Query cache key (below), so a
  // change rebroadcasts a fresh request rather than re-sorting the
  // cached page client-side — pagination boundaries shift when the
  // direction flips so re-fetching is the correct behaviour.
  const [sortOrder, setSortOrder] = useState<ApplicantSortOrder>("newest");
  // Marketing-source filter. A header control (next to Sort), not part of the
  // collapsible filters pane, so it's excluded from the pane's Reset + active
  // count, mirroring how Search/Sort behave. Part of the query cache key below.
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  // Manual-status filter (a catalog key, or "all"). Independent of the
  // Initial/AI stage filters; resolved server-side against the
  // applicant_labels collection.
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [schedulingFilter, setSchedulingFilter] = useState<string>("all");
  const [finalDecisionFilter, setFinalDecisionFilter] = useState<string>("all");
  const [activationFilter, setActivationFilter] = useState<string>("all");
  const [manualRejectionFilter, setManualRejectionFilter] =
    useState<string>("all");
  const [finalRejectionFilter, setFinalRejectionFilter] =
    useState<string>("all");
  const [responseFilter, setResponseFilter] = useState<string>("all");
  // Two stage-specific "Not Interested" filters, each its own dropdown.
  const [preScheduleInterestFilter, setPreScheduleInterestFilter] =
    useState<string>("all");
  const [postFinalInterestFilter, setPostFinalInterestFilter] =
    useState<string>("all");
  // Pending "request a new link" filter. There's a dedicated Link Requests
  // tab too, but operators triaging the main table want to slice to it here.
  const [linkRequestedFilter, setLinkRequestedFilter] = useState<
    "all" | "pending"
  >("all");
  // Email-suppressed filter (hard bounce / spam complaint).
  const [emailFilter, setEmailFilter] = useState<"all" | "suppressed">("all");
  // Per-admin-group status filter (groupKey -> selected status key or "all").
  // Feeds the generic `statusKeys` param (intersected server-side).
  const [adminStatusFilters, setAdminStatusFilters] = useState<
    Record<string, string>
  >({});
  // Status/decision filters now live in a collapsible right-hand pane,
  // collapsed by default. Search + Sort stay in the header. Each filter still
  // applies immediately on change (resetting to page 1); the pane's Reset
  // clears only the pane filters (Search + Sort are left untouched).
  const [filtersOpen, setFiltersOpen] = useState(false);
  // CSV export in flight: "filtered" (honour the active filters) or "all".
  const [exporting, setExporting] = useState<null | "filtered" | "all">(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    applicationId: string;
    name?: string;
  } | null>(null);
  const [resendTarget, setResendTarget] = useState<{
    applicationId: string;
    name?: string;
    email?: string;
  } | null>(null);
  const [techInviteTarget, setTechInviteTarget] = useState<{
    applicationId: string;
    name?: string;
    email?: string;
    technicalInvite?: ApplicantListItem["technicalInvite"];
  } | null>(null);
  const [reattemptTarget, setReattemptTarget] = useState<{
    applicationId: string;
    name?: string;
    email?: string;
  } | null>(null);
  // "Restart follow-up" dialog target. `single` acts on one applicant; `bulk`
  // acts on the current multi-selection. `restartDays` is the no-reply cutoff
  // (2-10) the operator picks before confirming.
  const [restartTarget, setRestartTarget] = useState<
    | { mode: "single"; applicationId: string; name?: string; email?: string }
    | { mode: "bulk"; count: number }
    | null
  >(null);
  const [restartDays, setRestartDays] = useState<number>(10);
  // Whole applicant row currently open in the right-hand interview
  // drawer. We keep the entire row (not just sessionId) so that
  // when the drawer's delete CTA fires we have the applicationId
  // in scope and can cascade-delete BOTH the interview AND the
  // applicant row through the same `deleteApplicant` endpoint —
  // matching the operator's mental model of "I'm wiping this
  // candidate" rather than "I'm wiping just the interview attempt
  // and leaving the applicant orphaned in the table". Null when no
  // drawer is open.
  const [activeApplicant, setActiveApplicant] =
    useState<ApplicantListItem | null>(null);
  // Multi-select: applicationIds the operator has ticked. Drives the
  // bulk action bar (delete / resend). Selection is per-view — it's
  // cleared whenever the query (page, filter, search, sort) changes so
  // a hidden off-page row can never be caught in a bulk action.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Which bulk action's confirm dialog is open (null = none).
  const [bulkAction, setBulkAction] = useState<"delete" | "resend" | null>(
    null,
  );
  // Generic bulk "Send email / SMS" modal open state.
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  // "Manual Verification" dialog state: the row being managed (null =
  // closed), the chosen manual-label key, the remark, and the label the
  // row already carries (so the modal can prefill, edit, and remove it).
  const [labelTarget, setLabelTarget] = useState<{
    applicationId: string;
    name?: string;
    currentKey?: string;
  } | null>(null);
  const [labelKey, setLabelKey] = useState("");
  const [labelRemarks, setLabelRemarks] = useState("");
  // Each hiring-pipeline stage has its OWN action + focused modal (like
  // Manual Verification), so only one stage's fields are ever on screen.
  // The target holds the row being managed; the field states back the
  // inputs and are prefilled from the row's chips when a modal opens.
  const [scheduleTarget, setScheduleTarget] =
    useState<ApplicantListItem | null>(null);
  const [outcomeTarget, setOutcomeTarget] = useState<ApplicantListItem | null>(
    null,
  );
  const [activationTarget, setActivationTarget] =
    useState<ApplicantListItem | null>(null);
  // When the activation target dropped out post-final, we first show a choice
  // dialog (Mark Active / Mark Not Active). "Mark Active" flips this to escalate
  // into the onboarding modal for the same target.
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [notInterestedTarget, setNotInterestedTarget] = useState<{
    applicationId: string;
    name?: string;
  } | null>(null);
  // Stage-specific "Not Interested" confirm-modal targets (null = closed).
  // Unlocked by Manual Pass / Final Pass respectively, mirroring their gate.
  const [preScheduleInterestTarget, setPreScheduleInterestTarget] = useState<{
    applicationId: string;
    name?: string;
  } | null>(null);
  const [postFinalInterestTarget, setPostFinalInterestTarget] = useState<{
    applicationId: string;
    name?: string;
  } | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  // Final-outcome (Final Reject / Final Pass) meeting link + remark.
  const [outcomeLink, setOutcomeLink] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  // Generic "send a template" modal target (null = closed).
  const [sendTemplateTarget, setSendTemplateTarget] =
    useState<SendTemplateTarget | null>(null);

  // The live pipeline catalog, for admin-created status actions + filters.
  const { data: pipelineCatalog } = usePipelineCatalog();
  // Admin-created assignable statuses (built-in groups keep their dedicated
  // action modals; these are the runtime-defined ones), grouped for the menu.
  const adminAssignableStatuses = useMemo(
    () =>
      (pipelineCatalog?.statuses ?? []).filter(
        (s) => !s.builtin && s.assignable,
      ),
    [pipelineCatalog],
  );
  // Admin-created GROUPS (which have no hardcoded dropdown of their own) each get
  // a dynamic dropdown feeding `statusKeys`.
  const adminFilterGroups = useMemo(() => {
    const cat = pipelineCatalog;
    if (!cat) return [];
    return cat.groups
      .filter((g) => !g.builtin)
      .map((g) => ({
        group: g,
        statuses: cat.statuses
          .filter((s) => s.groupKey === g.key)
          .sort((a, b) => a.stageOrder - b.stageOrder),
      }))
      .filter((entry) => entry.statuses.length > 0);
  }, [pipelineCatalog]);
  // Custom (admin-created) statuses added to a BUILT-IN group, bucketed by group
  // key. A built-in group's hardcoded dropdown (e.g. "Not Interested
  // Pre-Schedule") only lists its built-in members, so these are merged in as
  // extra options on that SAME dropdown (see `builtinGroupFilter`) rather than
  // getting a separate dropdown of their own.
  const customStatusesByGroup = useMemo(() => {
    const statuses = pipelineCatalog?.statuses ?? [];
    const map = new Map<string, typeof statuses>();
    for (const s of statuses) {
      if (s.builtin) continue;
      const bucket = map.get(s.groupKey) ?? [];
      bucket.push(s);
      map.set(s.groupKey, bucket);
    }
    for (const bucket of map.values())
      bucket.sort((a, b) => a.stageOrder - b.stageOrder);
    return map;
  }, [pipelineCatalog]);
  // Props for a built-in stage dropdown merged with any custom statuses in that
  // group. A built-in option drives the group's own dedicated filter param; a
  // custom option drives the generic `statusKeys` path (`adminStatusFilters`).
  // Single-select, so choosing from one path clears the other.
  const builtinGroupFilter = (
    groupKey: string,
    builtinKeys: readonly string[],
    dedicatedValue: string,
    setDedicated: (v: string) => void,
  ) => {
    const customStatuses = customStatusesByGroup.get(groupKey) ?? [];
    const customValue = adminStatusFilters[groupKey] ?? "all";
    const value = customValue !== "all" ? customValue : dedicatedValue;
    // A value is a CUSTOM (admin-created) status iff it is not "all" and not one
    // of this group's BUILT-IN keys. Deciding this from the STATIC built-in key
    // set (never the async-loaded catalog) is what makes routing reliable: a
    // built-in value drives the group's dedicated `@IsIn`-validated param, a
    // custom value drives the generic `statusKeys` path. Routing a custom key to
    // the dedicated param would 400 (it fails `@IsIn`) and React Query's
    // keepPreviousData would then silently show the previous, unfiltered rows.
    const builtinKeySet = new Set(builtinKeys);
    const isCustomValue = value !== "all" && !builtinKeySet.has(value);
    // Trigger tint: a custom status carries its own catalog colour (so a green
    // status shows green, not the muted -> orange fallback); a built-in value
    // resolves through the static catalog like the other filters.
    const selectedCustom = customStatuses.find((s) => s.key === value);
    const variant: BadgeVariant | null =
      value === "all"
        ? null
        : isCustomValue
          ? ((selectedCustom?.color as BadgeVariant) ?? "muted")
          : (resolveLabel(value)?.variant ?? "muted");
    const onValueChange = (v: string) => {
      const isCustom = v !== "all" && !builtinKeySet.has(v);
      setDedicated(isCustom ? "all" : v);
      setAdminStatusFilters((prev) => {
        const next = { ...prev };
        if (isCustom) next[groupKey] = v;
        else delete next[groupKey];
        return next;
      });
      setPage(1);
    };
    return { customStatuses, value, variant, onValueChange };
  };
  const manualDecisionFilter = builtinGroupFilter(
    MANUAL_VERDICT_GROUP,
    VERDICT_LABELS.map((l) => l.key),
    labelFilter,
    setLabelFilter,
  );
  const preScheduleFilter = builtinGroupFilter(
    PRE_SCHEDULE_INTEREST_GROUP,
    PRE_SCHEDULE_INTEREST_LABELS.map((l) => l.key),
    preScheduleInterestFilter,
    setPreScheduleInterestFilter,
  );
  const finalDecisionGroupFilter = builtinGroupFilter(
    FINAL_DECISION_GROUP,
    FINAL_DECISION_LABELS.map((l) => l.key),
    finalDecisionFilter,
    setFinalDecisionFilter,
  );
  const postFinalFilter = builtinGroupFilter(
    POST_FINAL_INTEREST_GROUP,
    POST_FINAL_INTEREST_LABELS.map((l) => l.key),
    postFinalInterestFilter,
    setPostFinalInterestFilter,
  );
  // The selected admin-group status keys, intersected server-side via statusKeys.
  const activeStatusKeys = useMemo(
    () => Object.values(adminStatusFilters).filter((v) => v && v !== "all"),
    [adminStatusFilters],
  );

  // Source dropdown options, fetched live from the DB (distinct utmSource tags
  // plus the synthetic "direct"). Cached a while since the set changes slowly.
  const { data: sourceTags } = useQuery({
    queryKey: ["applicant-source-options"],
    queryFn: getSourceOptions,
    staleTime: 5 * 60 * 1000,
  });
  const sourceOptions = useMemo(
    () => [
      { value: "all", label: "All sources" },
      ...(sourceTags ?? []).map((s) => ({
        value: s,
        label: formatSourceLabel(s),
      })),
    ],
    [sourceTags],
  );

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      "applicants",
      {
        page,
        limit: pageSize,
        initial: initialFilter,
        ai: aiFilter,
        label: labelFilter,
        scheduling: schedulingFilter,
        finalDecision: finalDecisionFilter,
        activation: activationFilter,
        manualRejection: manualRejectionFilter,
        finalRejection: finalRejectionFilter,
        response: responseFilter,
        preScheduleInterest: preScheduleInterestFilter,
        postFinalInterest: postFinalInterestFilter,
        linkRequested: linkRequestedFilter,
        emailSuppressed: emailFilter,
        statusKeys: activeStatusKeys.join(","),
        source: sourceFilter,
        search,
        sort: sortOrder,
      },
    ],
    queryFn: () =>
      listApplicants({
        page,
        limit: pageSize,
        sort: sortOrder,
        ...(initialFilter !== "all" ? { initialDecision: initialFilter } : {}),
        ...(aiFilter !== "all" ? { aiDecision: aiFilter } : {}),
        ...(labelFilter !== "all" ? { label: labelFilter } : {}),
        ...(schedulingFilter !== "all" ? { scheduling: schedulingFilter } : {}),
        ...(finalDecisionFilter !== "all"
          ? { finalDecision: finalDecisionFilter }
          : {}),
        ...(activationFilter !== "all" ? { activation: activationFilter } : {}),
        ...(manualRejectionFilter !== "all"
          ? { manualRejection: manualRejectionFilter }
          : {}),
        ...(finalRejectionFilter !== "all"
          ? { finalRejection: finalRejectionFilter }
          : {}),
        ...(responseFilter !== "all" ? { response: responseFilter } : {}),
        ...(preScheduleInterestFilter !== "all"
          ? { notInterestedPreSchedule: preScheduleInterestFilter }
          : {}),
        ...(postFinalInterestFilter !== "all"
          ? { notInterestedPostFinal: postFinalInterestFilter }
          : {}),
        ...(linkRequestedFilter !== "all"
          ? { linkRequested: "pending" as const }
          : {}),
        ...(emailFilter !== "all"
          ? { emailSuppressed: "suppressed" as const }
          : {}),
        ...(sourceFilter !== "all" ? { source: sourceFilter } : {}),
        ...(activeStatusKeys.length ? { statusKeys: activeStatusKeys } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    placeholderData: keepPreviousData,
  });

  /**
   * Delete-applicant cascade. The backend wipes the applicant row,
   * the linked Interview document (if any), and every S3 artefact
   * (CV, recorded answer audios, webcam video). The success toast
   * surfaces whether an interview was also removed so the operator
   * has the full picture without having to re-check anything.
   *
   * This single mutation backs BOTH delete entry points:
   *
   *   1. The per-row trash icon (target is the row's applicationId).
   *
   *   2. The drawer's Delete CTA — when the operator clicks Delete
   *      inside the View Result drawer, we use the active row's
   *      applicationId here so the cascade also removes the
   *      applicant (rather than just the interview, which would
   *      leave the applicant in the table with no interview attached
   *      and force a second click to clean up).
   */
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApplicant(id),
    onSuccess: (res) => {
      const tail = res.deletedInterview
        ? ` (also removed interview ${res.deletedInterview.slice(0, 8)}…)`
        : "";
      toast.success(`Applicant deleted${tail}.`);
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      // If we just cascade-deleted a linked interview, blow its
      // per-session cache away too. The interviews list query
      // belongs to the (now-removed) standalone Interviews tab —
      // we still invalidate it so any deep-linked observer
      // (curl, Swagger UI, etc.) sees fresh state.
      if (res.deletedInterview) {
        queryClient.invalidateQueries({ queryKey: ["interviews"] });
        queryClient.removeQueries({
          queryKey: ["interview", res.deletedInterview],
        });
      }
      // Close the drawer if it was showing the row we just nuked.
      if (activeApplicant?.applicationId === res.applicationId) {
        setActiveApplicant(null);
      }
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Failed to delete applicant.";
      toast.error(message);
    },
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendInvite(id),
    onSuccess: (_res, id) => {
      toast.success(
        "Interview invite re-sent. Candidate should get the email shortly.",
      );
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      setResendTarget(null);
      // Touch the single-applicant cache too so a freshly-opened
      // detail drawer (if you ever add one) doesn't show stale
      // `inviteSentAt` until the BullMQ worker finishes.
      queryClient.removeQueries({ queryKey: ["applicant", id] });
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Failed to resend invite.";
      toast.error(message);
    },
  });

  // Re-open the AI interview for a fresh attempt (keeps prior attempts as
  // history) and email a new link. Backend resets the AI verdict to pending,
  // so invalidate the list to drop the old AI badge + reflect the re-invite.
  const reattemptMutation = useMutation({
    mutationFn: (id: string) => reattemptInterview(id),
    onSuccess: (res, id) => {
      toast.success(
        res.statusesCleared > 0
          ? `Interview re-opened and ${res.statusesCleared} status(es) reset. A fresh link has been emailed to the candidate.`
          : "Interview re-opened. A fresh link has been emailed to the candidate.",
      );
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      setReattemptTarget(null);
      queryClient.removeQueries({ queryKey: ["applicant", id] });
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Failed to re-open the interview.";
      toast.error(message);
    },
  });

  // Assign a manual label / status to a single applicant. The backend
  // returns the refreshed applicant; we invalidate the list so the Status
  // column re-renders with the new chip.
  const labelMutation = useMutation({
    mutationFn: (vars: {
      applicationId: string;
      key: string;
      remarks?: string;
    }) =>
      assignApplicantLabel(vars.applicationId, {
        key: vars.key,
        remarks: vars.remarks,
      }),
    onSuccess: () => {
      toast.success("Status updated.");
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      setLabelTarget(null);
      setLabelKey("");
      setLabelRemarks("");
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not update status.";
      toast.error(message);
    },
  });

  // Remove a manual label / status from an applicant (the modal's
  // "Remove status" action).
  const removeLabelMutation = useMutation({
    mutationFn: (vars: { applicationId: string; key: string }) =>
      removeApplicantLabel(vars.applicationId, vars.key),
    onSuccess: () => {
      toast.success("Status removed.");
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      setLabelTarget(null);
      setLabelKey("");
      setLabelRemarks("");
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not remove status.";
      toast.error(message);
    },
  });

  // ── Hiring pipeline mutations (shared by every stage modal) ──────────
  // Each stage now has its own focused modal; on success we close them all
  // (only one is ever open) and refresh the table so the row's chips and
  // the next stage's action appear.
  const closePipelineDialogs = () => {
    setScheduleTarget(null);
    setOutcomeTarget(null);
    setActivationTarget(null);
    setForceOnboarding(false);
    setNotInterestedTarget(null);
    setPreScheduleInterestTarget(null);
    setPostFinalInterestTarget(null);
  };
  const pipelineAssignMutation = useMutation({
    mutationFn: (vars: {
      applicationId: string;
      key: string;
      remarks?: string;
      scheduledAt?: string;
      link?: string;
    }) =>
      assignApplicantLabel(vars.applicationId, {
        key: vars.key,
        remarks: vars.remarks,
        scheduledAt: vars.scheduledAt,
        link: vars.link,
      }),
    onSuccess: () => {
      toast.success("Pipeline updated.");
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      closePipelineDialogs();
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not update the pipeline.";
      toast.error(message);
    },
  });

  const pipelineRemoveMutation = useMutation({
    mutationFn: (vars: { applicationId: string; key: string }) =>
      removeApplicantLabel(vars.applicationId, vars.key),
    onSuccess: () => {
      toast.success("Pipeline updated.");
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      closePipelineDialogs();
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not update the pipeline.";
      toast.error(message);
    },
  });

  // Bulk cascade-delete for the selected applicants. Fire-and-forget: the
  // backend accepts the job and removes each applicant in the background
  // (sequential, each delete fans out into several S3 + Mongo ops), so the
  // modal closes instantly instead of hanging until all N finish. The list is
  // refetched shortly after so the deleted rows drop out.
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteApplicants(ids),
    onSuccess: (res) => {
      toast.success(
        `Deleting ${res.requested} applicant${res.requested === 1 ? "" : "s"} in the background. This can take a moment to finish.`,
      );
      // Refetch now and again shortly after, since the deletes complete
      // asynchronously a moment behind the accepted response.
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
      window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["applicants"] });
        queryClient.invalidateQueries({ queryKey: ["interviews"] });
      }, 2500);
      setSelectedIds(new Set());
      setBulkAction(null);
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Bulk delete failed.";
      toast.error(message);
    },
  });

  // Bulk re-send invites for the selected applicants. Sent
  // sequentially server-side (Resend rate limits); per-id failures
  // (e.g. an unverified domain) are surfaced without losing the rest.
  const bulkResendMutation = useMutation({
    mutationFn: (ids: string[]) => bulkResendInvites(ids),
    onSuccess: (res) => {
      toast.success(
        `Re-sending ${res.requested} invite${res.requested === 1 ? "" : "s"} in the background. This can take a moment to finish.`,
      );
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      setSelectedIds(new Set());
      setBulkAction(null);
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Bulk resend failed.";
      toast.error(message);
    },
  });

  // Restart the follow-up lifecycle (single applicant). Re-opens the cycle and
  // sends a fresh invite now; the backend rejects ineligible candidates
  // (already attempted / opted out / suppressed) with a clear message.
  const restartMutation = useMutation({
    mutationFn: ({
      applicationId,
      days,
    }: {
      applicationId: string;
      days: number;
    }) => restartFollowup(applicationId, days),
    onSuccess: () => {
      toast.success("Follow-up restarted, fresh invite sent.");
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      setRestartTarget(null);
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Couldn't restart the follow-up lifecycle.";
      toast.error(message);
    },
  });

  // Restart the follow-up lifecycle for the selected applicants. Fire-and-forget:
  // the backend accepts the job and restarts each lifecycle in the background
  // (sequential, each restart emails an invite), so the modal closes instantly
  // instead of hanging until all N finish. Ineligible applicants (already
  // attempted, opted out, suppressed) are skipped server-side, never an error.
  const bulkRestartMutation = useMutation({
    mutationFn: ({ ids, days }: { ids: string[]; days: number }) =>
      bulkRestartFollowup(ids, days),
    onSuccess: (res) => {
      toast.success(
        `Restarting ${res.requested} follow-up${res.requested === 1 ? "" : "s"} in the background. Ineligible applicants are skipped automatically.`,
      );
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      setSelectedIds(new Set());
      setRestartTarget(null);
    },
    onError: (err: unknown) => {
      // Only a genuine request failure (network / 5xx, or the whole batch
      // rejected at validation) reaches here; per-applicant skips are handled
      // silently server-side.
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Bulk restart failed.";
      toast.error(message);
    },
  });

  // Server already filters by search, but we keep a memo here so the
  // table layout in the no-results branch doesn't flash when the user
  // is mid-typing (same UX pattern as the interviews page).
  const rows = useMemo<ApplicantListItem[]>(() => data?.data ?? [], [data]);

  // ── multi-select helpers ─────────────────────────────────────────────
  // Selection is per-view: cleared whenever the query (page / page-size /
  // filter / search / sort) changes, so a bulk action can never touch an
  // off-page row the operator can't see.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    page,
    pageSize,
    initialFilter,
    aiFilter,
    labelFilter,
    schedulingFilter,
    finalDecisionFilter,
    activationFilter,
    manualRejectionFilter,
    finalRejectionFilter,
    responseFilter,
    linkRequestedFilter,
    emailFilter,
    adminStatusFilters,
    search,
    sortOrder,
  ]);

  const pageIds = useMemo(() => rows.map((r) => r.applicationId), [rows]);
  const allSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someSelected = pageIds.some((id) => selectedIds.has(id));
  const headerChecked: boolean | "indeterminate" = allSelected
    ? true
    : someSelected
      ? "indeterminate"
      : false;

  const toggleAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) pageIds.forEach((id) => next.add(id));
      else pageIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const bulkBusy =
    bulkDeleteMutation.isPending ||
    bulkResendMutation.isPending ||
    bulkRestartMutation.isPending;

  /**
   * Click handler for the per-row "Open CV" button. Three things
   * to navigate carefully:
   *
   *   1. Private S3 bucket — the stored `cvUrl` returns S3's
   *      `AccessDenied` XML to an anonymous browser. We have to
   *      mint a fresh presigned GET URL on every click.
   *
   *   2. Popup blockers — `window.open(url, "_blank")` AFTER an
   *      `await` lands outside the user-gesture window, so Chrome /
   *      Firefox / Safari block it as a spam tab. The fix is to
   *      open a blank tab synchronously within the click, then
   *      redirect that tab once the signed URL arrives.
   *
   *   3. `noopener` BREAKS the redirect — when `window.open` is
   *      called with `noopener`, browsers return either `null` or a
   *      stripped-down Window handle whose `.location` setter is a
   *      no-op. `win.location.href = url` silently fails, the
   *      script falls into the `else` branch, and the URL ends up
   *      in the CURRENT tab while the new tab stays at
   *      `about:blank`. So we open WITHOUT `noopener`, redirect
   *      the new tab, then null out `win.opener` ourselves so the
   *      S3 tab can't navigate our admin tab back. Same security
   *      posture, working redirect.
   *
   * If the popup IS blocked (some adblockers / strict policies),
   * we fall back to navigating the existing tab via
   * `window.location.assign` — losing the table state but at least
   * delivering the PDF.
   */
  const handleOpenCv = async (applicationId: string) => {
    const win = window.open("about:blank", "_blank");
    try {
      const { url } = await getApplicantCvUrl(applicationId);
      if (win) {
        win.location.href = url;
        // Manually sever the back-reference so the S3 tab can't
        // call window.opener.postMessage() / location = … against
        // this admin tab. The browser allows the assignment
        // because we kept the opener relationship long enough to
        // set the URL; nulling it AFTER preserves both safety and
        // function.
        try {
          win.opener = null;
        } catch {
          /* some browsers freeze it */
        }
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      if (win) win.close();
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not open CV.";
      toast.error(message);
    }
  };

  /**
   * Export the applicants table to CSV. `withFilters` true sends the SAME
   * filter set the table is currently showing (so the file matches the view);
   * false exports everyone. The backend returns the CSV string inside the
   * encrypted envelope; we turn it into a client-side download (prefixing a
   * UTF-8 BOM so Excel reads non-ASCII names correctly).
   */
  const handleExport = async (withFilters: boolean) => {
    const params = withFilters
      ? {
          ...(initialFilter !== "all"
            ? { initialDecision: initialFilter }
            : {}),
          ...(aiFilter !== "all" ? { aiDecision: aiFilter } : {}),
          ...(labelFilter !== "all" ? { label: labelFilter } : {}),
          ...(schedulingFilter !== "all"
            ? { scheduling: schedulingFilter }
            : {}),
          ...(finalDecisionFilter !== "all"
            ? { finalDecision: finalDecisionFilter }
            : {}),
          ...(activationFilter !== "all"
            ? { activation: activationFilter }
            : {}),
          ...(manualRejectionFilter !== "all"
            ? { manualRejection: manualRejectionFilter }
            : {}),
          ...(finalRejectionFilter !== "all"
            ? { finalRejection: finalRejectionFilter }
            : {}),
          ...(responseFilter !== "all" ? { response: responseFilter } : {}),
          ...(preScheduleInterestFilter !== "all"
            ? { notInterestedPreSchedule: preScheduleInterestFilter }
            : {}),
          ...(postFinalInterestFilter !== "all"
            ? { notInterestedPostFinal: postFinalInterestFilter }
            : {}),
          ...(linkRequestedFilter !== "all"
            ? { linkRequested: "pending" as const }
            : {}),
          ...(emailFilter !== "all"
            ? { emailSuppressed: "suppressed" as const }
            : {}),
          ...(activeStatusKeys.length ? { statusKeys: activeStatusKeys } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          sort: sortOrder,
        }
      : {};
    setExporting(withFilters ? "filtered" : "all");
    try {
      const { filename, csv, count, truncated } =
        await exportApplicantsCsv(params);
      // Prepend a UTF-8 BOM (U+FEFF) so Excel honours the encoding for
      // non-ASCII candidate names.
      const blob = new Blob([String.fromCharCode(0xfeff) + csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${count} applicant${count === 1 ? "" : "s"}${
          truncated ? " (capped at 50k rows)" : ""
        }.`,
      );
    } catch (err) {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not export CSV.";
      toast.error(message);
    } finally {
      setExporting(null);
    }
  };

  const total = data?.count ?? 0;
  const totalPages = data?.totalPage ?? 0;
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  // How many of the pane's status/decision filters are active (non-default).
  // Sort + search are deliberately excluded (they live in the header and
  // aren't cleared by the pane Reset). Drives the Filters toggle's count
  // badge and gates the pane Reset button.
  const activeFilterCount =
    [
      initialFilter,
      aiFilter,
      labelFilter,
      schedulingFilter,
      finalDecisionFilter,
      activationFilter,
      manualRejectionFilter,
      finalRejectionFilter,
      responseFilter,
      preScheduleInterestFilter,
      postFinalInterestFilter,
      linkRequestedFilter,
      emailFilter,
    ].filter((v) => v !== "all").length + activeStatusKeys.length;

  // The "Scheduled At" column is only meaningful for scheduled applicants, so
  // keep it hidden until the operator narrows the list with the Scheduling
  // filter set to "Scheduled". Drives both the header cell and the per-row cell,
  // and feeds the empty/loading/error colSpan below.
  const showScheduledAt = schedulingFilter === "scheduled";
  const columnCount = showScheduledAt ? 11 : 10;

  // Reset just the pane filters back to "all", then refetch the first page.
  // Scoped to the pane: Search + Sort are intentionally left as-is.
  const resetFilters = () => {
    setInitialFilter("all");
    setAiFilter("all");
    setLabelFilter("all");
    setSchedulingFilter("all");
    setFinalDecisionFilter("all");
    setActivationFilter("all");
    setManualRejectionFilter("all");
    setFinalRejectionFilter("all");
    setResponseFilter("all");
    setPreScheduleInterestFilter("all");
    setPostFinalInterestFilter("all");
    setLinkRequestedFilter("all");
    setEmailFilter("all");
    setAdminStatusFilters({});
    setPage(1);
  };

  // The current filter state as a saveable snapshot (only the active, non-default
  // slots), so the Saved Views bar can persist exactly what the table is showing.
  const currentCriteria: SavedFilterCriteria = useMemo(
    () => ({
      ...(initialFilter !== "all" ? { initialDecision: initialFilter } : {}),
      ...(aiFilter !== "all" ? { aiDecision: aiFilter } : {}),
      ...(labelFilter !== "all" ? { label: labelFilter } : {}),
      ...(schedulingFilter !== "all" ? { scheduling: schedulingFilter } : {}),
      ...(finalDecisionFilter !== "all"
        ? { finalDecision: finalDecisionFilter }
        : {}),
      ...(activationFilter !== "all" ? { activation: activationFilter } : {}),
      ...(manualRejectionFilter !== "all"
        ? { manualRejection: manualRejectionFilter }
        : {}),
      ...(finalRejectionFilter !== "all"
        ? { finalRejection: finalRejectionFilter }
        : {}),
      ...(responseFilter !== "all" ? { response: responseFilter } : {}),
      ...(preScheduleInterestFilter !== "all"
        ? { notInterestedPreSchedule: preScheduleInterestFilter }
        : {}),
      ...(postFinalInterestFilter !== "all"
        ? { notInterestedPostFinal: postFinalInterestFilter }
        : {}),
      ...(linkRequestedFilter !== "all"
        ? { linkRequested: "pending" as const }
        : {}),
      ...(emailFilter !== "all"
        ? { emailSuppressed: "suppressed" as const }
        : {}),
      ...(sourceFilter !== "all" ? { source: sourceFilter } : {}),
      ...(activeStatusKeys.length ? { statusKeys: activeStatusKeys } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(sortOrder !== "newest" ? { sort: sortOrder } : {}),
    }),
    [
      initialFilter,
      aiFilter,
      labelFilter,
      schedulingFilter,
      finalDecisionFilter,
      activationFilter,
      manualRejectionFilter,
      finalRejectionFilter,
      responseFilter,
      preScheduleInterestFilter,
      postFinalInterestFilter,
      linkRequestedFilter,
      emailFilter,
      sourceFilter,
      activeStatusKeys,
      search,
      sortOrder,
    ],
  );

  // Apply a saved view: set every filter slot from the snapshot (absent slots
  // fall back to their default), then jump to page 1.
  const applySavedFilter = (criteria: SavedFilterCriteria) => {
    setInitialFilter(criteria.initialDecision ?? "all");
    setAiFilter(criteria.aiDecision ?? "all");
    setLabelFilter(criteria.label ?? "all");
    setSchedulingFilter(criteria.scheduling ?? "all");
    setFinalDecisionFilter(criteria.finalDecision ?? "all");
    setActivationFilter(criteria.activation ?? "all");
    setManualRejectionFilter(criteria.manualRejection ?? "all");
    setFinalRejectionFilter(criteria.finalRejection ?? "all");
    setResponseFilter(criteria.response ?? "all");
    setPreScheduleInterestFilter(criteria.notInterestedPreSchedule ?? "all");
    setPostFinalInterestFilter(criteria.notInterestedPostFinal ?? "all");
    setLinkRequestedFilter(criteria.linkRequested ?? "all");
    setEmailFilter(criteria.emailSuppressed ?? "all");
    setSourceFilter(criteria.source ?? "all");
    // Rebuild the per-group admin status filters from the flat saved keys.
    const statusMap: Record<string, string> = {};
    for (const key of criteria.statusKeys ?? []) {
      const groupKey = (pipelineCatalog?.statuses ?? []).find(
        (s) => s.key === key,
      )?.groupKey;
      if (groupKey) statusMap[groupKey] = key;
    }
    setAdminStatusFilters(statusMap);
    setSearch(criteria.search ?? "");
    setSortOrder(criteria.sort ?? "newest");
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Applicants</h1>
          <p className="text-sm text-muted-foreground">
            Marketing-funnel submissions, pre-screen verdicts, invite status,
            and CVs.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={exporting !== null}
              >
                {exporting !== null ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export CSV
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={exporting !== null}
                onSelect={() => handleExport(true)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Export with current filters
                {activeFilterCount > 0 ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {activeFilterCount} active
                  </span>
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={exporting !== null}
                onSelect={() => handleExport(false)}
              >
                <Download className="h-4 w-4" />
                Export all applicants
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 ? (
              <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </div>
      </div>

      {/* Saved views: quick-apply named snapshots of the current filter state. */}
      <SavedFilterBar
        currentCriteria={currentCriteria}
        onApply={applySavedFilter}
      />

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-6">
        <div className="min-w-0 flex-1 lg:flex lg:min-h-0 lg:flex-col">
          <Card className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <CardHeader className="border-b border-border">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Candidates</CardTitle>
                    <CardDescription>
                      {total > 0
                        ? `Showing ${showingFrom}–${showingTo} of ${total}`
                        : "No applicants yet."}
                    </CardDescription>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
                    <div className="relative w-full sm:w-72">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                        placeholder="Search name, email, phone…"
                        className="pl-9"
                      />
                    </div>
                    <Select
                      value={sortOrder}
                      onValueChange={(v) => {
                        setSortOrder(v as ApplicantSortOrder);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger
                        className="w-full shrink-0 sm:w-[180px]"
                        aria-label="Sort order"
                      >
                        <SelectValue placeholder="Newest first" />
                      </SelectTrigger>
                      <SelectContent>
                        {SORT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={sourceFilter}
                      onValueChange={(v) => {
                        setSourceFilter(v);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger
                        className={cn(
                          "w-full shrink-0 sm:w-[160px]",
                          sourceFilter !== "all" &&
                            "border-primary bg-primary/10 text-primary",
                        )}
                        aria-label="Source"
                      >
                        <SelectValue placeholder="All sources" />
                      </SelectTrigger>
                      <SelectContent>
                        {sourceOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>

            {selectedCount > 0 ? (
              <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{selectedCount} selected</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => setBulkAction("resend")}
                  >
                    {bulkResendMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Resend invites
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => setBulkSendOpen(true)}
                  >
                    <MessageSquareText className="h-4 w-4" />
                    Send Email / SMS
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => {
                      setRestartDays(10);
                      setRestartTarget({ mode: "bulk", count: selectedCount });
                    }}
                  >
                    {bulkRestartMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Restart follow-up
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkBusy}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setBulkAction("delete")}
                  >
                    {bulkDeleteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            ) : null}

            <CardContent className="p-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <Table
                className="min-w-[1000px]"
                containerClassName="max-h-[70vh] lg:max-h-none lg:min-h-0 lg:flex-1"
              >
                {/*
              Sticky header: with up to 100 rows per page, pin the column
              names to the top of the (now height-bounded) scroll area so
              they stay visible while scrolling. `bg-card` on the header cells
              keeps rows from showing through as they scroll underneath.
            */}
                <TableHeader className="sticky top-0 z-20 bg-card [&_th]:bg-card">
                  <TableRow>
                    <TableHead className="w-10 pl-6">
                      <Checkbox
                        checked={headerChecked}
                        onCheckedChange={toggleAll}
                        aria-label="Select all on this page"
                      />
                    </TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    {showScheduledAt ? (
                      <TableHead>Scheduled At</TableHead>
                    ) : null}
                    <TableHead>Profile</TableHead>
                    <TableHead>Interview</TableHead>
                    <TableHead>Invite sent</TableHead>
                    <TableHead className="pr-6 text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={columnCount}
                        className="py-16 text-center text-sm text-muted-foreground"
                      >
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
                        Loading applicants…
                      </TableCell>
                    </TableRow>
                  ) : isError ? (
                    <TableRow>
                      <TableCell
                        colSpan={columnCount}
                        className="py-16 text-center text-sm text-destructive"
                      >
                        Failed to load applicants.{" "}
                        <button onClick={() => refetch()} className="underline">
                          Retry
                        </button>
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={columnCount}
                        className="py-16 text-center text-sm text-muted-foreground"
                      >
                        <Inbox className="mx-auto mb-2 h-6 w-6" />
                        {search.trim()
                          ? "No matches for your search."
                          : "No applicants yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow
                        key={row.applicationId}
                        className={
                          selectedIds.has(row.applicationId)
                            ? "bg-primary/5"
                            : undefined
                        }
                      >
                        <TableCell className="w-10 pl-6">
                          <Checkbox
                            checked={selectedIds.has(row.applicationId)}
                            onCheckedChange={(c) =>
                              toggleOne(row.applicationId, c)
                            }
                            aria-label={`Select ${row.fullName || "applicant"}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5 font-medium leading-tight">
                            <span>{row.fullName || "—"}</span>
                            {row.interviewAttemptCount > 1 ? (
                              <Badge
                                variant="purple"
                                className="gap-1 px-1.5 py-0 text-[10px]"
                                title={`Reattempted the interview ${row.interviewAttemptCount - 1} time(s)`}
                              >
                                <RotateCcw className="h-2.5 w-2.5" />
                                Reattempted ×{row.interviewAttemptCount - 1}
                              </Badge>
                            ) : null}
                            {row.technicalInvite?.inviteSentAt ? (
                              <Badge
                                variant="secondary"
                                className="gap-1 px-1.5 py-0 text-[10px]"
                                title={`Technical invite sent${
                                  row.technicalInvite.questions?.length
                                    ? `: ${row.technicalInvite.questions
                                        .map((q) => q.name)
                                        .join(", ")}`
                                    : ""
                                }`}
                              >
                                <Code2 className="h-2.5 w-2.5" />
                                Tech invited
                              </Badge>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="mt-1 cursor-copy font-mono text-[10px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                            title={`Click to copy: ${row.applicationId}`}
                            onClick={() => {
                              navigator.clipboard.writeText(row.applicationId);
                              toast.success("ID copied");
                            }}
                          >
                            ID: {row.applicationId.slice(0, 8)}…
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate" title={row.email}>
                              {row.email}
                            </span>
                          </div>
                          <div className="mt-1">
                            <PhoneActions phoneNumber={row.phoneNumber} />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatCity(row.city) || "—"}
                        </TableCell>
                        <TableCell>
                          {/*
                        Marketing source (backend-derived from utmSource): the
                        raw tag as-is, or Direct when untagged. The raw tag is
                        surfaced on hover too.
                      */}
                          <Badge
                            variant={sourceBadgeVariant(row.source)}
                            className="font-normal"
                            title={
                              row.utmSource
                                ? `utm_source: ${row.utmSource}`
                                : undefined
                            }
                          >
                            {formatSourceLabel(row.source)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {/*
                        Status is rendered from the backend's unified
                        `chips` array: the derived Initial + AI verdicts
                        first, then any operator-assigned manual labels
                        (Manual Pass / Fail / Not Interested / future).
                        Each chip resolves to its label + colour via the
                        shared catalog, so new label types render here with
                        no code change. Manual chips show their remark and
                        who set it on hover.

                        Layout: a fixed two-per-row grid (two auto-width
                        columns) rather than a free-flowing wrap, so the
                        column stays tidy and predictable as more chips are
                        added. The tracks are `auto` (not `grid-cols-2`'s
                        equal `minmax(0,1fr)`) so each pill's track sizes to
                        its own content — a wider pill (e.g. "Initial pass")
                        can't overflow a half-width track and overlap the
                        neighbouring pill. `w-fit` keeps the grid only as
                        wide as the two columns need.
                      */}
                          <TooltipProvider delayDuration={300}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(() => {
                                const allChips = row.chips ?? [];
                                const shownChips = allChips.slice(-2);
                                const hiddenChips = allChips.slice(
                                  0,
                                  allChips.length - shownChips.length,
                                );
                                return (
                                  <>
                                    {shownChips.map((chip) => {
                                      const def = resolveChipDisplay(chip);
                                      if (!def) return null;
                                      const note =
                                        chip.source === "manual"
                                          ? [
                                              chip.scheduledAt
                                                ? formatDateTime(
                                                    chip.scheduledAt,
                                                  )
                                                : null,
                                              chip.link ?? null,
                                              chip.remarks ?? null,
                                              chip.setByName
                                                ? `by ${chip.setByName}`
                                                : null,
                                            ]
                                              .filter(Boolean)
                                              .join(" · ")
                                          : undefined;
                                      return note ? (
                                        <Tooltip
                                          key={`${chip.source}:${chip.key}`}
                                        >
                                          <TooltipTrigger asChild>
                                            <Badge
                                              variant={def.variant}
                                              className="cursor-default"
                                            >
                                              {def.label}
                                            </Badge>
                                          </TooltipTrigger>
                                          <TooltipContent side="top">
                                            {note}
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : (
                                        <Badge
                                          key={`${chip.source}:${chip.key}`}
                                          variant={def.variant}
                                        >
                                          {def.label}
                                        </Badge>
                                      );
                                    })}
                                    {hiddenChips.length > 0 ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Badge
                                            variant="muted"
                                            className="cursor-pointer"
                                          >
                                            +{hiddenChips.length}
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                          <p className="mb-2 font-medium">
                                            {hiddenChips.length} earlier{" "}
                                            {hiddenChips.length === 1
                                              ? "status"
                                              : "statuses"}
                                          </p>
                                          <div className="grid grid-cols-2 gap-2">
                                            {hiddenChips.map((c, i) => {
                                              const def = resolveChipDisplay(c);
                                              return (
                                                <Badge
                                                  key={i}
                                                  variant={
                                                    def?.variant ?? "muted"
                                                  }
                                                  className="justify-center"
                                                >
                                                  {def?.label ?? c.key}
                                                </Badge>
                                              );
                                            })}
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </div>
                          </TooltipProvider>
                          {row.rejectionReason ? (
                            // Allow the reason to wrap up to two lines and
                            // hand off to the tooltip for anything longer.
                            // The previous JS-side `.slice(0, 32) + "…"`
                            // chopped readable text mid-word ("Only Lahore
                            // applicants are eligi…") and the operator had
                            // to hover just to figure out what verdict
                            // reason they were looking at — `line-clamp-2`
                            // keeps the row height bounded while leaving
                            // typical reasons fully visible inline.
                            <div
                              className="mt-1 max-w-[16rem] text-[11px] leading-snug text-muted-foreground line-clamp-2"
                              title={row.rejectionReason}
                            >
                              {row.rejectionReason}
                            </div>
                          ) : null}
                        </TableCell>
                        {showScheduledAt ? (
                          <TableCell className="text-xs">
                            {(() => {
                              // Date/time the interview is scheduled for, read off
                              // the `scheduled` status chip (only present once an
                              // operator has scheduled this applicant). Shows a dash
                              // for everyone not currently in the Scheduled state.
                              const scheduledAt = (row.chips ?? []).find(
                                (c) => c.key === "scheduled",
                              )?.scheduledAt;
                              return scheduledAt ? (
                                <span
                                  className="text-foreground"
                                  title={scheduledAt}
                                >
                                  {formatDateTime(scheduledAt)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              );
                            })()}
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <div className="text-sm">
                            {row.primaryRole ? (
                              formatRole(row.primaryRole)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                          {/* Always render a line so rows stay vertically
                          aligned — a 0/undetected value reads as
                          "Experience N/A" rather than silently vanishing. */}
                          <div className="text-xs text-muted-foreground">
                            {row.yearsOfExperience > 0
                              ? `${formatYearsOfExperience(row.yearsOfExperience)}y experience`
                              : "Experience N/A"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.latestInterviewSessionId ||
                          row.interviewSessionId ? (
                            // Attempted — primary action: open the
                            // interview detail drawer with the full
                            // transcript, scores, and recordings.
                            // Reuses the same `InterviewDetailDrawer`
                            // the legacy Interviews tab used, so the
                            // review surface is identical regardless
                            // of which tab you came in from. Uses the
                            // VIEWING pointer so a reattempt (which clears
                            // interviewSessionId until the new attempt
                            // starts) still opens the prior attempt's history.
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => setActiveApplicant(row)}
                              className="gap-1.5"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View Result
                            </Button>
                          ) : (
                            <Badge variant="muted" className="gap-1">
                              <UserX className="h-3 w-3" />
                              Not started
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {(() => {
                            // The invite-sent timestamp sits on its own line; the
                            // status badges (Link requested / Suppressed / follow-up)
                            // go BELOW it in a content-sized two-per-row grid so the
                            // column lays out consistently no matter how many badges
                            // a row carries.
                            const fd = followupDisplay(row.followup);
                            const showFollowup = fd.showOnRow;
                            // Webhook-driven delivery chips. Skip the email chip
                            // when the suppression badge already shows the hard
                            // bounce / complaint, so we don't render it twice.
                            const emailChip = row.emailSuppressedAt
                              ? null
                              : deliveryBadge(
                                  row.emailDeliveryStatus,
                                  row.emailBounceType,
                                );
                            const smsChip = smsDeliveryBadge(
                              row.smsDeliveryStatus,
                              row.smsRetryCount,
                            );
                            const hasBadges =
                              Boolean(row.linkRequestedAt) ||
                              Boolean(row.emailSuppressedAt) ||
                              showFollowup ||
                              Boolean(emailChip) ||
                              Boolean(smsChip);
                            const next = row.followup.nextDueAt;
                            const followupTitle = next
                              ? row.followup.sent >= row.followup.total
                                ? `No-reply cutoff ${formatDateTime(next)} (day ${row.followup.noReplyDay})`
                                : `Next nudge ${formatDateTime(next)} (day ${row.followup.nextDueDay})`
                              : undefined;
                            return (
                              <div className="flex flex-col gap-1.5">
                                <div>
                                  {row.inviteSentAt ? (
                                    <span
                                      className="text-foreground"
                                      title={row.inviteSentAt}
                                    >
                                      {formatDateTime(row.inviteSentAt)}
                                    </span>
                                  ) : row.inviteEmailError ? (
                                    // Email send permanently failed (its own queue's
                                    // signal — independent of the profile pass).
                                    <span
                                      className="inline-flex items-center gap-1 text-destructive"
                                      title={row.inviteEmailError}
                                    >
                                      <X className="h-3 w-3" />
                                      Failed
                                    </span>
                                  ) : !row.interviewConfirmedAt ? (
                                    // Invite is deliberately withheld until the
                                    // candidate finishes the intro video step.
                                    <span
                                      className="inline-flex items-center gap-1 text-muted-foreground"
                                      title="Candidate hasn't finished the intro video yet. The invite email is sent automatically once they do."
                                    >
                                      <Video className="h-3 w-3" />
                                      Video pending
                                    </span>
                                  ) : (
                                    // Confirmed the video, invite is on the durable
                                    // queue and on its way (or being retried).
                                    <span
                                      className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500"
                                      title="Candidate finished the video. The invite email is queued and will arrive shortly."
                                    >
                                      <Mail className="h-3 w-3" />
                                      Email pending
                                    </span>
                                  )}
                                </div>
                                {hasBadges ? (
                                  <div className="grid w-fit grid-cols-[auto_auto] gap-1.5">
                                    {/* Candidate asked for a fresh link from the
                                    expired-link screen (resending clears it). */}
                                    {row.linkRequestedAt ? (
                                      <Badge
                                        variant="default"
                                        className="gap-1"
                                        title={`Candidate requested a new link on ${formatDateTime(row.linkRequestedAt)}`}
                                      >
                                        <MailWarning className="h-3 w-3" />
                                        Link requested
                                      </Badge>
                                    ) : null}
                                    {/* Email suppressed: hard bounce / spam complaint. */}
                                    {row.emailSuppressedAt ? (
                                      <Badge
                                        variant="destructive"
                                        className="gap-1"
                                        title={`No further email is sent (${emailSuppressionLabel(row.emailSuppressionReason)}) since ${formatDateTime(row.emailSuppressedAt)}`}
                                      >
                                        <X className="h-3 w-3 shrink-0" />
                                        {emailSuppressionLabel(
                                          row.emailSuppressionReason,
                                        )}
                                      </Badge>
                                    ) : null}
                                    {/* In-flight follow-up stage (terminal No Reply /
                                    Opted out show as Status chips instead). */}
                                    {showFollowup ? (
                                      <Badge
                                        variant={fd.variant}
                                        className="gap-1"
                                        title={followupTitle}
                                      >
                                        <Send className="h-3 w-3 shrink-0" />
                                        {fd.label}
                                      </Badge>
                                    ) : null}
                                    {/* Email delivery outcome (Resend webhook). */}
                                    {emailChip ? (
                                      <Badge
                                        variant={emailChip.variant}
                                        className="gap-1"
                                        title={`Latest email ${emailChip.label.toLowerCase()}`}
                                      >
                                        <Mail className="h-3 w-3 shrink-0" />
                                        {emailChip.label}
                                      </Badge>
                                    ) : null}
                                    {/* SMS delivery outcome (VeevoTech DLR). */}
                                    {smsChip ? (
                                      <Badge
                                        variant={smsChip.variant}
                                        className="gap-1"
                                        title={`Latest SMS ${smsChip.label.toLowerCase()}`}
                                      >
                                        <MessageSquareText className="h-3 w-3 shrink-0" />
                                        {smsChip.label}
                                      </Badge>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="pr-6 text-center">
                          {/*
                        Row actions are tucked behind a kebab (three-dot)
                        menu rather than rendered inline. The action set is
                        expected to grow (export, notes, status overrides,
                        etc.) and a widening strip of icons per row gets
                        noisy fast — the menu keeps the column compact and
                        gives every action a readable label.
                      */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Actions"
                                aria-label="Open actions menu"
                              >
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">
                                  Open actions menu
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {row.cvUrl ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    handleOpenCv(row.applicationId)
                                  }
                                >
                                  <FileText className="h-4 w-4" />
                                  Open CV
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                disabled={resendMutation.isPending}
                                onSelect={() =>
                                  setResendTarget({
                                    applicationId: row.applicationId,
                                    name: row.fullName,
                                    email: row.email,
                                  })
                                }
                              >
                                <Send className="h-4 w-4" />
                                Resend invite
                              </DropdownMenuItem>
                              {/*
                            Technical invite: pick one catalog question (filtered
                            by type/difficulty) and email a technical-round link.
                            Shown for every candidate.
                          */}
                              <DropdownMenuItem
                                onSelect={() =>
                                  setTechInviteTarget({
                                    applicationId: row.applicationId,
                                    name: row.fullName,
                                    email: row.email,
                                    technicalInvite: row.technicalInvite,
                                  })
                                }
                              >
                                <Code2 className="h-4 w-4" />
                                {row.technicalInvite?.inviteSentAt
                                  ? "Resend technical invite"
                                  : "Send technical invite"}
                              </DropdownMenuItem>
                              {/*
                            Restart follow-up: re-open the AI-interview nudge
                            cycle (custom no-reply cutoff) and email a fresh
                            invite now. Hidden for candidates the backend would
                            reject anyway: already responded, opted out, or a
                            suppressed (bounced/complained) address.
                          */}
                              {row.followup.stage !== "responded" &&
                              row.followup.stage !== "opted_out" &&
                              !row.emailSuppressedAt ? (
                                <DropdownMenuItem
                                  disabled={restartMutation.isPending}
                                  onSelect={() => {
                                    setRestartDays(10);
                                    setRestartTarget({
                                      mode: "single",
                                      applicationId: row.applicationId,
                                      name: row.fullName,
                                      email: row.email,
                                    });
                                  }}
                                >
                                  <RefreshCw className="h-4 w-4" />
                                  Restart follow-up
                                </DropdownMenuItem>
                              ) : null}
                              {/*
                            Reattempt: re-open the AI interview for a fresh
                            attempt, keeping prior attempts as history. Shown
                            once the candidate has attempted at least once
                            (has a session or a recorded attempt count). The
                            backend blocks an in-progress interview and 400s a
                            never-attempted one, surfaced via the error toast.
                          */}
                              {row.interviewSessionId ||
                              row.interviewAttemptCount > 0 ? (
                                <DropdownMenuItem
                                  disabled={reattemptMutation.isPending}
                                  onSelect={() =>
                                    setReattemptTarget({
                                      applicationId: row.applicationId,
                                      name: row.fullName,
                                      email: row.email,
                                    })
                                  }
                                >
                                  <RotateCcw className="h-4 w-4" />
                                  Reattempt interview
                                </DropdownMenuItem>
                              ) : null}
                              {/*
                            A manual status is only meaningful once the AI
                            interview has been scored (passed or failed),
                            which is when the operator forms a verdict, so
                            the action surfaces only then.
                          */}
                              {row.aiDecision != null ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    // Pre-select the currently-set verdict (Pass /
                                    // Reject / Backlog). The derived
                                    // "manual_pending" placeholder is NOT a set
                                    // verdict, so it's intentionally excluded — the
                                    // modal opens fresh in that case.
                                    const verdict = (row.chips ?? []).find(
                                      (c) =>
                                        [
                                          "manual_pass",
                                          "manual_fail",
                                          "manual_backlog",
                                        ].includes(c.key),
                                    );
                                    setLabelTarget({
                                      applicationId: row.applicationId,
                                      name: row.fullName,
                                      currentKey: verdict?.key,
                                    });
                                    setLabelKey(verdict?.key ?? "");
                                    setLabelRemarks(verdict?.remarks ?? "");
                                  }}
                                >
                                  <Tag className="h-4 w-4" />
                                  Manual Decision
                                </DropdownMenuItem>
                              ) : null}
                              {/* Stage 4B/5: schedule the interview (Manual Pass).
                            Stays available even after a pre-schedule drop-out:
                            scheduling re-engages the candidate and clears that
                            "Not Interested" marker (backend STATUS_CLEARS). */}
                              {(row.chips ?? []).some(
                                (c) => c.key === "manual_pass",
                              ) ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    const sched = (row.chips ?? []).find(
                                      (c) => c.key === "scheduled",
                                    );
                                    setScheduleTarget(row);
                                    setScheduleAt(
                                      toDatetimeLocal(sched?.scheduledAt),
                                    );
                                    setScheduleNote(sched?.remarks ?? "");
                                  }}
                                >
                                  <CalendarClock className="h-4 w-4" />
                                  Scheduling
                                </DropdownMenuItem>
                              ) : null}
                              {/*
                            Drop-out before scheduling: unlocked at the same
                            point as Scheduling (Manual Pass), so the operator
                            can record that the candidate declined before any
                            interview was booked.
                          */}
                              {(row.chips ?? []).some(
                                (c) => c.key === "manual_pass",
                              ) ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setPreScheduleInterestTarget({
                                      applicationId: row.applicationId,
                                      name: row.fullName,
                                    })
                                  }
                                >
                                  <UserX className="h-4 w-4" />
                                  Not Interested Pre-Schedule
                                </DropdownMenuItem>
                              ) : null}
                              {/* Stage 5/6: final decision (unlocked by Scheduled). */}
                              {(row.chips ?? []).some(
                                (c) => c.key === "scheduled",
                              ) ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    const outcome = (row.chips ?? []).find(
                                      (c) =>
                                        ["final_reject", "final_pass"].includes(
                                          c.key,
                                        ),
                                    );
                                    setOutcomeTarget(row);
                                    setOutcomeLink(outcome?.link ?? "");
                                    setOutcomeNote(outcome?.remarks ?? "");
                                  }}
                                >
                                  <BadgeCheck className="h-4 w-4" />
                                  Final Decision
                                </DropdownMenuItem>
                              ) : null}
                              {/* Stage 7B: activation (Final Pass). Stays available
                            even after a post-final drop-out: marking the
                            candidate active or not active clears that "Not
                            Interested" marker (the operator can re-engage). */}
                              {(row.chips ?? []).some(
                                (c) => c.key === "final_pass",
                              ) ? (
                                <DropdownMenuItem
                                  onSelect={() => setActivationTarget(row)}
                                >
                                  <UserCheck className="h-4 w-4" />
                                  Activation
                                </DropdownMenuItem>
                              ) : null}
                              {/*
                            Drop-out after the final decision: unlocked once
                            Final Pass is recorded (the offer is on the table),
                            so the operator can record that the candidate
                            declined after clearing the final round.
                          */}
                              {(row.chips ?? []).some(
                                (c) => c.key === "final_pass",
                              ) ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setPostFinalInterestTarget({
                                      applicationId: row.applicationId,
                                      name: row.fullName,
                                    })
                                  }
                                >
                                  <UserX className="h-4 w-4" />
                                  Not Interested Post-Final
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                onSelect={() =>
                                  setSendTemplateTarget({
                                    applicationId: row.applicationId,
                                    name: row.fullName,
                                    email: row.email,
                                    phone: row.phoneNumber,
                                  })
                                }
                              >
                                <Send className="h-4 w-4" />
                                Send Email / SMS
                              </DropdownMenuItem>
                              {/* Admin-created pipeline statuses: gated by the
                                  row's present statuses, set via single-select. */}
                              {(() => {
                                const present = new Set(
                                  (row.chips ?? []).map((c) => c.key),
                                );
                                const settable = adminAssignableStatuses.filter(
                                  (s) =>
                                    !s.unlockedByKey ||
                                    present.has(s.unlockedByKey),
                                );
                                if (settable.length === 0) return null;
                                return (
                                  <>
                                    <DropdownMenuSeparator />
                                    {settable.map((s) => (
                                      <DropdownMenuItem
                                        key={s.key}
                                        disabled={labelMutation.isPending}
                                        onSelect={() =>
                                          labelMutation.mutate({
                                            applicationId: row.applicationId,
                                            key: s.key,
                                          })
                                        }
                                      >
                                        <Tag className="h-4 w-4" />
                                        Set: {s.label}
                                      </DropdownMenuItem>
                                    ))}
                                  </>
                                );
                              })()}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                onSelect={() =>
                                  setDeleteTarget({
                                    applicationId: row.applicationId,
                                    name: row.fullName,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete applicant
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>

            <div className="flex flex-col gap-3 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {/* Records-per-page selector */}
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
                    <SelectTrigger className="h-8 w-[72px]">
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
                  {/* Pagination loader — visible while a page / page-size
                  change is fetching (rows stay put via keepPreviousData,
                  so without this the change would feel like nothing
                  happened). */}
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
        </div>
        {/*
          Filters are an inline collapsible panel docked to the right of the
          table (no overlay/backdrop), same posture as the left sidebar. Open
          takes layout space so the table shrinks to its left; closed it's
          unmounted so the table is full width. Sticky so it stays in view as
          the page scrolls. Two filters per row; each applies immediately (no
          Apply button) and Reset clears only these filters.
        */}
        {filtersOpen ? (
          <aside
            aria-label="Filters"
            className="w-full shrink-0 self-start rounded-xl border border-border bg-card shadow-sm animate-in fade-in-0 slide-in-from-right duration-200 lg:w-sm"
          >
            <div className="max-h-[calc(100vh-5rem)] overflow-y-auto p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Filters</h3>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={resetFilters}
                    disabled={activeFilterCount === 0}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => setFiltersOpen(false)}
                    aria-label="Close filters"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Always-on funnel filters (pre-pipeline signals). */}
                <div className="flex flex-col gap-1">
                  <label
                    id="filter-initial-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Initial Decision
                  </label>
                  <Select
                    value={initialFilter}
                    onValueChange={(v) => {
                      setInitialFilter(v as "all" | InitialDecision);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("initial", initialFilter),
                      )}
                      aria-labelledby="filter-initial-label"
                    >
                      <SelectValue placeholder="All initial" />
                    </SelectTrigger>
                    <SelectContent>
                      {INITIAL_FILTER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-email-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Initial Email
                  </label>
                  <Select
                    value={emailFilter}
                    onValueChange={(v) => {
                      setEmailFilter(v as "all" | "suppressed");
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("email", emailFilter),
                      )}
                      aria-labelledby="filter-email-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="suppressed">
                        Bounced / suppressed
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-response-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Candidate Response
                  </label>
                  <Select
                    value={responseFilter}
                    onValueChange={(v) => {
                      setResponseFilter(v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("catalog", responseFilter),
                      )}
                      aria-labelledby="filter-response-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {RESPONSE_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-link-requested-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Link Request
                  </label>
                  <Select
                    value={linkRequestedFilter}
                    onValueChange={(v) => {
                      setLinkRequestedFilter(v as "all" | "pending");
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant(
                          "linkRequested",
                          linkRequestedFilter,
                        ),
                      )}
                      aria-labelledby="filter-link-requested-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="pending">
                        Requested new link
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-ai-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    AI Decision
                  </label>
                  <Select
                    value={aiFilter}
                    onValueChange={(v) => {
                      setAiFilter(v as "all" | AiDecisionFilter);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("ai", aiFilter),
                      )}
                      aria-labelledby="filter-ai-label"
                    >
                      <SelectValue placeholder="All AI" />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_FILTER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/*
                  All hiring-pipeline filters are shown together (no progressive
                  disclosure) so an operator can slice on any stage directly.
                  Each applies independently and resets to page 1 on change.
                */}
                <div className="flex flex-col gap-1">
                  <label
                    id="filter-label-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Manual Decision
                  </label>
                  <Select
                    value={manualDecisionFilter.value}
                    onValueChange={manualDecisionFilter.onValueChange}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(manualDecisionFilter.variant)}
                      aria-labelledby="filter-label-label"
                    >
                      <SelectValue placeholder="All manual" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All manual</SelectItem>
                      {VERDICT_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {/* Shorter label in the filter only; the chip keeps
                              the full "Manual Decision Pending". */}
                          {def.key === "manual_pending"
                            ? "Manual Pending"
                            : def.label}
                        </SelectItem>
                      ))}
                      {manualDecisionFilter.customStatuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Data-driven filters for admin-created pipeline groups. */}
                {adminFilterGroups.map(({ group, statuses }) => {
                  const value = adminStatusFilters[group.key] ?? "all";
                  return (
                    <div key={group.key} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        {group.label}
                      </label>
                      <Select
                        value={value}
                        onValueChange={(v) => {
                          setAdminStatusFilters((prev) => ({
                            ...prev,
                            [group.key]: v,
                          }));
                          setPage(1);
                        }}
                      >
                        <SelectTrigger
                          className={filterTriggerClass(
                            value === "all"
                              ? null
                              : ((statuses.find((s) => s.key === value)
                                  ?.color ?? "default") as BadgeVariant),
                          )}
                        >
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {statuses.map((s) => (
                            <SelectItem key={s.key} value={s.key}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-manual-rejection-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Manual Rejection Email
                  </label>
                  <Select
                    value={manualRejectionFilter}
                    onValueChange={(v) => {
                      setManualRejectionFilter(v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("catalog", manualRejectionFilter),
                      )}
                      aria-labelledby="filter-manual-rejection-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {MANUAL_REJECTION_EMAIL_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Stage-specific drop-out: candidate not interested before
                    scheduling (unlocked by Manual Pass). Its own filter, shown
                    just before Scheduling so it reads in pipeline order. */}
                <div className="flex flex-col gap-1">
                  <label
                    id="filter-pre-schedule-interest-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Not Interested Pre-Schedule
                  </label>
                  <Select
                    value={preScheduleFilter.value}
                    onValueChange={preScheduleFilter.onValueChange}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(preScheduleFilter.variant)}
                      aria-labelledby="filter-pre-schedule-interest-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {PRE_SCHEDULE_INTEREST_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label}
                        </SelectItem>
                      ))}
                      {preScheduleFilter.customStatuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-scheduling-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Scheduling
                  </label>
                  <Select
                    value={schedulingFilter}
                    onValueChange={(v) => {
                      setSchedulingFilter(v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("catalog", schedulingFilter),
                      )}
                      aria-labelledby="filter-scheduling-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {SCHEDULING_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-outcome-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Final Decision
                  </label>
                  <Select
                    value={finalDecisionGroupFilter.value}
                    onValueChange={finalDecisionGroupFilter.onValueChange}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        finalDecisionGroupFilter.variant,
                      )}
                      aria-labelledby="filter-outcome-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {FINAL_DECISION_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {/* Filter shows the shorter "Final Pending"; the chip
                              itself keeps the full "Final Decision Pending". */}
                          {def.key === "final_decision_pending"
                            ? "Final Pending"
                            : def.label}
                        </SelectItem>
                      ))}
                      {finalDecisionGroupFilter.customStatuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Stage-specific drop-out: candidate not interested after the
                    final decision (unlocked by Final Pass). Its own filter. */}
                <div className="flex flex-col gap-1">
                  <label
                    id="filter-post-final-interest-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Not Interested Post-Final
                  </label>
                  <Select
                    value={postFinalFilter.value}
                    onValueChange={postFinalFilter.onValueChange}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(postFinalFilter.variant)}
                      aria-labelledby="filter-post-final-interest-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {POST_FINAL_INTEREST_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label}
                        </SelectItem>
                      ))}
                      {postFinalFilter.customStatuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-final-rejection-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Final Rejection Email
                  </label>
                  <Select
                    value={finalRejectionFilter}
                    onValueChange={(v) => {
                      setFinalRejectionFilter(v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("catalog", finalRejectionFilter),
                      )}
                      aria-labelledby="filter-final-rejection-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {FINAL_REJECTION_EMAIL_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    id="filter-activation-label"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Activation
                  </label>
                  <Select
                    value={activationFilter}
                    onValueChange={(v) => {
                      setActivationFilter(v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className={filterTriggerClass(
                        activeFilterVariant("catalog", activationFilter),
                      )}
                      aria-labelledby="filter-activation-label"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {ACTIVATION_LABELS.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete applicant?"
        description={
          <>
            This permanently removes{" "}
            <strong>{deleteTarget?.name || "this applicant"}</strong> from the
            applicants table. The linked interview record (if any), their CV,
            recorded answer audios, and webcam video will also be deleted from
            storage. <strong>This action can&apos;t be undone.</strong>
          </>
        }
        confirmLabel="Delete applicant"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.applicationId);
        }}
      />

      <ConfirmDialog
        open={Boolean(resendTarget)}
        onOpenChange={(open) => !open && setResendTarget(null)}
        title="Re-send interview invite?"
        description={
          <>
            We&apos;ll mint a fresh 48-hour interview link and email it to{" "}
            <strong>{resendTarget?.email || "the candidate"}</strong>. This
            refreshes the link only, if the candidate already finished their
            interview they&apos;ll just resume it. To let them take it again,
            use <strong>Reattempt interview</strong> instead.
          </>
        }
        confirmLabel="Send invite"
        loading={resendMutation.isPending}
        onConfirm={() => {
          if (!resendTarget) return;
          resendMutation.mutate(resendTarget.applicationId);
        }}
      />

      <ConfirmDialog
        open={Boolean(reattemptTarget)}
        onOpenChange={(open) => !open && setReattemptTarget(null)}
        title="Re-open interview for a fresh attempt?"
        description={
          <>
            We&apos;ll reset the whole pipeline for{" "}
            <strong>{reattemptTarget?.email || "the candidate"}</strong>, the AI
            verdict goes back to pending and every manual status (verdict,
            scheduling, final decision, activation, rejection email) is cleared,
            then a fresh 48-hour link is emailed now. Their previous interview
            results stay as history, you can still review the recording and
            scores from the version dropdown in the interview detail. The new
            attempt starts when they open the link.
          </>
        }
        confirmLabel="Re-open and send link"
        loading={reattemptMutation.isPending}
        onConfirm={() => {
          if (!reattemptTarget) return;
          reattemptMutation.mutate(reattemptTarget.applicationId);
        }}
      />

      {/*
        Interview detail drawer — opened by per-row "View Result".
        Same component the legacy Interviews tab used, so the review
        UX (transcript / score breakdown / video player / proctoring
        badges) is identical. The drawer's Delete CTA cascades all
        the way: clicking it raises the per-row delete-applicant
        confirm dialog (NOT a separate "delete-interview-only"
        flow), so confirming wipes the applicant + interview + S3
        artefacts in a single shot. This matches the operator's
        mental model of "I'm wiping this candidate"; the old
        interview-only delete left an orphan applicant in the
        table that forced a second click to clean up.
      */}
      <InterviewDetailDrawer
        sessionId={
          activeApplicant?.latestInterviewSessionId ||
          activeApplicant?.interviewSessionId ||
          null
        }
        open={Boolean(
          activeApplicant?.latestInterviewSessionId ||
          activeApplicant?.interviewSessionId,
        )}
        // Mirror the table's Status column inside the drawer: hand over the
        // applicant's full chip set so the drawer can render every status
        // tag (incl. the Scheduled time). The interview document has no
        // pipeline/scheduling concept, so this rides along from the row.
        chips={activeApplicant?.chips ?? null}
        applicationId={activeApplicant?.applicationId ?? null}
        onOpenChange={(open) => !open && setActiveApplicant(null)}
        onRequestDelete={() => {
          if (!activeApplicant) return;
          setDeleteTarget({
            applicationId: activeApplicant.applicationId,
            name: activeApplicant.fullName,
          });
        }}
      />

      {/* Technical-round invite: pick a catalog question + email the link. */}
      <SendTechnicalInviteDialog
        open={Boolean(techInviteTarget)}
        onOpenChange={(open) => !open && setTechInviteTarget(null)}
        applicant={techInviteTarget}
      />

      {/*
        Bulk action confirm — shared by the multi-select "Delete" and
        "Resend invites" bar buttons. `bulkAction` selects the copy +
        destructiveness; both operate on the current `selectedIds`.
      */}
      <ConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (bulkBusy) return;
          if (!open) setBulkAction(null);
        }}
        title={
          bulkAction === "delete"
            ? `Delete ${selectedCount} applicant${selectedCount === 1 ? "" : "s"}?`
            : `Re-send ${selectedCount} invite${selectedCount === 1 ? "" : "s"}?`
        }
        description={
          bulkAction === "delete" ? (
            <>
              This permanently removes the <strong>{selectedCount}</strong>{" "}
              selected applicant{selectedCount === 1 ? "" : "s"}, along with
              each linked interview record, CV, recorded answer audios, and
              webcam video. <strong>This action can&apos;t be undone.</strong>
            </>
          ) : (
            <>
              We&apos;ll mint a fresh 48-hour interview link and email it to the{" "}
              <strong>{selectedCount}</strong> selected applicant
              {selectedCount === 1 ? "" : "s"}. Anyone who already started their
              interview keeps their existing session (delete it first if you
              want them to start over). Sending runs in the background, so you
              can keep working once you confirm.
            </>
          )
        }
        confirmLabel={
          bulkAction === "delete" ? "Delete selected" : "Send invites"
        }
        destructive={bulkAction === "delete"}
        loading={bulkBusy}
        onConfirm={() => {
          const ids = Array.from(selectedIds);
          if (ids.length === 0) return;
          if (bulkAction === "delete") bulkDeleteMutation.mutate(ids);
          else if (bulkAction === "resend") bulkResendMutation.mutate(ids);
        }}
      />

      {/*
        "Restart follow-up" dialog — shared by the per-row action and the
        multi-select bar button. Picks the no-reply cutoff (2-10 days), then
        re-opens the cycle and emails a fresh invite now. Ineligible applicants
        (already attempted / opted out / suppressed) are skipped server-side.
      */}
      <Dialog
        open={Boolean(restartTarget)}
        onOpenChange={(open) => {
          if (restartMutation.isPending || bulkRestartMutation.isPending)
            return;
          if (!open) setRestartTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart follow-up lifecycle</DialogTitle>
            <DialogDescription>
              {restartTarget?.mode === "bulk" ? (
                <>
                  Re-open the AI-interview follow-up cycle for the{" "}
                  <strong>{restartTarget.count}</strong> selected applicant
                  {restartTarget.count === 1 ? "" : "s"} and email a fresh
                  invite to each now. Anyone who already attempted, opted out,
                  or has a suppressed address is skipped automatically.
                </>
              ) : (
                <>
                  Re-open the AI-interview follow-up cycle for{" "}
                  <strong>{restartTarget?.email || "this applicant"}</strong>{" "}
                  and email a fresh invite now. Reminder emails then go out
                  every 2 days until the no-reply cutoff below.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <label
              htmlFor="restart-days"
              className="text-xs font-medium text-foreground"
            >
              No-reply cutoff
            </label>
            <Select
              value={String(restartDays)}
              onValueChange={(v) => setRestartDays(Number(v))}
            >
              <SelectTrigger id="restart-days" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 4, 6, 8, 10].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              The candidate is marked No Reply after this many days; reminder
              emails go out every 2 days up to it.
            </p>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              onClick={() => setRestartTarget(null)}
              disabled={
                restartMutation.isPending || bulkRestartMutation.isPending
              }
            >
              Cancel
            </Button>
            <Button
              disabled={
                restartMutation.isPending || bulkRestartMutation.isPending
              }
              onClick={() => {
                if (!restartTarget) return;
                if (restartTarget.mode === "single") {
                  restartMutation.mutate({
                    applicationId: restartTarget.applicationId,
                    days: restartDays,
                  });
                } else {
                  const ids = Array.from(selectedIds);
                  if (ids.length === 0) return;
                  bulkRestartMutation.mutate({ ids, days: restartDays });
                }
              }}
            >
              {restartMutation.isPending || bulkRestartMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Restart and send invite{restartTarget?.mode === "bulk" ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        "Manual Verification" dialog — manage the applicant's manual status:
        set it, change it, edit its remark, or remove it. Opened from the
        row actions menu. The label is recorded alongside (never
        overwriting) the automatic Initial / AI verdicts.
      */}
      <Dialog
        open={Boolean(labelTarget)}
        onOpenChange={(open) => {
          if (labelMutation.isPending || removeLabelMutation.isPending) return;
          if (!open) {
            setLabelTarget(null);
            setLabelKey("");
            setLabelRemarks("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Decision</DialogTitle>
            <DialogDescription>
              Set a manual status for{" "}
              <strong>{labelTarget?.name || "this applicant"}</strong>. It is
              recorded alongside the automatic Initial and AI verdicts, not
              instead of them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label
                htmlFor="manual-status"
                className="text-xs font-medium text-foreground"
              >
                Status
              </label>
              <Select value={labelKey} onValueChange={setLabelKey}>
                <SelectTrigger id="manual-status" className="w-full">
                  <SelectValue placeholder="Choose a status" />
                </SelectTrigger>
                <SelectContent>
                  {/* Pending placeholders (Manual Decision Pending) are
                      derived, not directly assignable, so the modal offers
                      only the real verdicts. */}
                  {VERDICT_LABELS.filter((def) => !def.pending).map((def) => (
                    <SelectItem key={def.key} value={def.key}>
                      {def.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="manual-remarks"
                className="text-xs font-medium text-foreground"
              >
                Remarks (optional)
              </label>
              <Textarea
                id="manual-remarks"
                value={labelRemarks}
                onChange={(e) => setLabelRemarks(e.target.value)}
                placeholder="Add a short note for the team…"
                maxLength={1000}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            {/* Remove only appears once the row already carries a manual
                status; it clears it entirely. */}
            {labelTarget?.currentKey ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  if (!labelTarget?.currentKey) return;
                  removeLabelMutation.mutate({
                    applicationId: labelTarget.applicationId,
                    key: labelTarget.currentKey,
                  });
                }}
                disabled={
                  labelMutation.isPending || removeLabelMutation.isPending
                }
              >
                {removeLabelMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Remove status
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setLabelTarget(null)}
                disabled={
                  labelMutation.isPending || removeLabelMutation.isPending
                }
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!labelTarget || !labelKey) return;
                  labelMutation.mutate({
                    applicationId: labelTarget.applicationId,
                    key: labelKey,
                    remarks: labelRemarks,
                  });
                }}
                disabled={
                  !labelKey ||
                  labelMutation.isPending ||
                  removeLabelMutation.isPending
                }
              >
                {labelMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save status
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule interview (Manual Pass). Own focused modal. */}
      <Dialog
        open={Boolean(scheduleTarget)}
        onOpenChange={(open) => {
          if (
            pipelineAssignMutation.isPending ||
            pipelineRemoveMutation.isPending
          )
            return;
          if (!open) setScheduleTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scheduling</DialogTitle>
            <DialogDescription>
              Set the final-round date and time for{" "}
              <strong>{scheduleTarget?.fullName || "this applicant"}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label
                htmlFor="schedule-when"
                className="text-xs font-medium text-foreground"
              >
                Date & time
              </label>
              <Input
                id="schedule-when"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="schedule-note"
                className="text-xs font-medium text-foreground"
              >
                Remarks (optional)
              </label>
              <Textarea
                id="schedule-note"
                rows={3}
                value={scheduleNote}
                onChange={(e) => setScheduleNote(e.target.value)}
                maxLength={1000}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            {(scheduleTarget?.chips ?? []).some(
              (c) => c.key === "scheduled",
            ) ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={
                  pipelineAssignMutation.isPending ||
                  pipelineRemoveMutation.isPending
                }
                onClick={() => {
                  if (!scheduleTarget) return;
                  pipelineRemoveMutation.mutate({
                    applicationId: scheduleTarget.applicationId,
                    key: "scheduled",
                  });
                }}
              >
                {pipelineRemoveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Unschedule
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setScheduleTarget(null)}>
                Cancel
              </Button>
              <Button
                disabled={!scheduleAt || pipelineAssignMutation.isPending}
                onClick={() => {
                  if (!scheduleTarget || !scheduleAt) return;
                  pipelineAssignMutation.mutate({
                    applicationId: scheduleTarget.applicationId,
                    key: "scheduled",
                    scheduledAt: new Date(scheduleAt).toISOString(),
                    remarks: scheduleNote,
                  });
                }}
              >
                {pipelineAssignMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {(scheduleTarget?.chips ?? []).some(
                  (c) => c.key === "scheduled",
                )
                  ? "Update schedule"
                  : "Schedule"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Final decision (Scheduled). Own focused modal. */}
      <Dialog
        open={Boolean(outcomeTarget)}
        onOpenChange={(open) => {
          if (pipelineAssignMutation.isPending) return;
          if (!open) setOutcomeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Final Decision</DialogTitle>
            <DialogDescription>
              Pass or reject{" "}
              <strong>{outcomeTarget?.fullName || "this applicant"}</strong>{" "}
              after the final interview. A reject lets you send a feedback
              email; a pass sends the offer letter.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const finalReject = (outcomeTarget?.chips ?? []).find(
              (c) => c.key === "final_reject",
            );
            const finalPass = (outcomeTarget?.chips ?? []).find(
              (c) => c.key === "final_pass",
            );
            return (
              <div className="space-y-4 py-2">
                {finalReject || finalPass ? (
                  <Badge
                    variant={finalPass ? "successSolid" : "destructiveSolid"}
                  >
                    {finalPass ? "Passed" : "Rejected"}
                  </Badge>
                ) : null}
                <div className="space-y-1.5">
                  <label
                    htmlFor="outcome-link"
                    className="text-xs font-medium text-foreground"
                  >
                    Meeting link (optional)
                  </label>
                  <Input
                    id="outcome-link"
                    type="url"
                    placeholder="https://meet.google.com/..."
                    value={outcomeLink}
                    onChange={(e) => setOutcomeLink(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="outcome-note"
                    className="text-xs font-medium text-foreground"
                  >
                    Remarks (optional, used in the rejection email)
                  </label>
                  <Textarea
                    id="outcome-note"
                    rows={3}
                    value={outcomeNote}
                    onChange={(e) => setOutcomeNote(e.target.value)}
                    maxLength={1000}
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={() => setOutcomeTarget(null)}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                disabled={pipelineAssignMutation.isPending}
                onClick={() => {
                  if (!outcomeTarget) return;
                  pipelineAssignMutation.mutate({
                    applicationId: outcomeTarget.applicationId,
                    key: "final_reject",
                    link: outcomeLink.trim() || undefined,
                    remarks: outcomeNote,
                  });
                }}
              >
                {pipelineAssignMutation.isPending &&
                pipelineAssignMutation.variables?.key === "final_reject" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Final Reject
              </Button>
              <Button
                disabled={pipelineAssignMutation.isPending}
                onClick={() => {
                  if (!outcomeTarget) return;
                  pipelineAssignMutation.mutate({
                    applicationId: outcomeTarget.applicationId,
                    key: "final_pass",
                    link: outcomeLink.trim() || undefined,
                    remarks: outcomeNote,
                  });
                }}
              >
                {pipelineAssignMutation.isPending &&
                pipelineAssignMutation.variables?.key === "final_pass" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Final Pass
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Activation. When the candidate isn't active yet, open the onboarding
        modal: it marks them Active AND captures their onboarding info (deposit
        / WhatsApp group / links / documents, resume prefilled from their CV),
        mirroring them into the unified active-candidates roster. When already
        active, their onboarding lives on the Active Candidates page, so this
        is just a pointer there.
      */}
      <Dialog
        open={
          Boolean(activationTarget) &&
          (activationTarget?.chips ?? []).some((c) => c.key === "active")
        }
        onOpenChange={(open) => {
          if (pipelineRemoveMutation.isPending) return;
          if (!open) setActivationTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activation</DialogTitle>
            <DialogDescription>
              <strong>{activationTarget?.fullName || "This applicant"}</strong>{" "}
              is active. Manage their onboarding details and documents on the
              Active Candidates page. Marking them not active returns them to
              Non Active and removes their row (and uploaded documents) from the
              active roster.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActivationTarget(null)}
              disabled={pipelineRemoveMutation.isPending}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={pipelineRemoveMutation.isPending}
              onClick={() => {
                if (!activationTarget) return;
                pipelineRemoveMutation.mutate({
                  applicationId: activationTarget.applicationId,
                  key: "active",
                });
              }}
            >
              {pipelineRemoveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Mark Not Active
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Post-final drop-out: the candidate declined after the final round but
        the operator can still re-engage them. Either choice clears the
        "Not Interested Post-Final" marker: Mark Active opens the onboarding
        modal (which sets `active`); Mark Not Active drops the marker so they
        return to Non Active.
      */}
      <Dialog
        open={
          Boolean(activationTarget) &&
          !(activationTarget?.chips ?? []).some((c) => c.key === "active") &&
          (activationTarget?.chips ?? []).some(
            (c) => c.key === "not_interested_post_final",
          ) &&
          !forceOnboarding
        }
        onOpenChange={(open) => {
          if (pipelineRemoveMutation.isPending) return;
          if (!open) {
            setActivationTarget(null);
            setForceOnboarding(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activation</DialogTitle>
            <DialogDescription>
              <strong>{activationTarget?.fullName || "This applicant"}</strong>{" "}
              is marked Not Interested Post-Final. You can still mark them
              active or not active. Either choice clears the Not Interested
              status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pipelineRemoveMutation.isPending}
              onClick={() => {
                if (!activationTarget) return;
                pipelineRemoveMutation.mutate({
                  applicationId: activationTarget.applicationId,
                  key: "not_interested_post_final",
                });
              }}
            >
              {pipelineRemoveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Mark Not Active
            </Button>
            <Button onClick={() => setForceOnboarding(true)}>
              Mark Active
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IndirectCandidateFormDialog
        open={
          Boolean(activationTarget) &&
          !(activationTarget?.chips ?? []).some((c) => c.key === "active") &&
          (!(activationTarget?.chips ?? []).some(
            (c) => c.key === "not_interested_post_final",
          ) ||
            forceOnboarding)
        }
        onOpenChange={(open) => {
          if (!open) {
            setActivationTarget(null);
            setForceOnboarding(false);
          }
        }}
        candidate={null}
        activateTarget={
          activationTarget
            ? ({
                applicationId: activationTarget.applicationId,
                fullName: activationTarget.fullName,
                email: activationTarget.email,
                phoneNumber: activationTarget.phoneNumber,
              } satisfies ActivateApplicantTarget)
            : null
        }
      />

      {/* Mark Not Interested (candidate response, terminal). Confirm modal. */}
      <Dialog
        open={Boolean(notInterestedTarget)}
        onOpenChange={(open) => {
          if (pipelineAssignMutation.isPending) return;
          if (!open) setNotInterestedTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Not Interested</DialogTitle>
            <DialogDescription>
              Mark{" "}
              <strong>{notInterestedTarget?.name || "this applicant"}</strong>{" "}
              as no longer interested. This is a terminal status and stops any
              further follow-ups.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNotInterestedTarget(null)}
              disabled={pipelineAssignMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!notInterestedTarget) return;
                pipelineAssignMutation.mutate({
                  applicationId: notInterestedTarget.applicationId,
                  key: "not_interested",
                });
              }}
              disabled={pipelineAssignMutation.isPending}
            >
              {pipelineAssignMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserX className="h-4 w-4" />
              )}
              Mark Not Interested
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Not Interested Pre-Schedule (terminal). Confirm modal. */}
      <Dialog
        open={Boolean(preScheduleInterestTarget)}
        onOpenChange={(open) => {
          if (pipelineAssignMutation.isPending) return;
          if (!open) setPreScheduleInterestTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Not Interested Pre-Schedule</DialogTitle>
            <DialogDescription>
              Mark{" "}
              <strong>
                {preScheduleInterestTarget?.name || "this applicant"}
              </strong>{" "}
              as no longer interested before any interview is scheduled. This is
              a terminal status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreScheduleInterestTarget(null)}
              disabled={pipelineAssignMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!preScheduleInterestTarget) return;
                pipelineAssignMutation.mutate({
                  applicationId: preScheduleInterestTarget.applicationId,
                  key: "not_interested_pre_schedule",
                });
              }}
              disabled={pipelineAssignMutation.isPending}
            >
              {pipelineAssignMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserX className="h-4 w-4" />
              )}
              Mark Not Interested
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Not Interested Post-Final (terminal). Confirm modal. */}
      <Dialog
        open={Boolean(postFinalInterestTarget)}
        onOpenChange={(open) => {
          if (pipelineAssignMutation.isPending) return;
          if (!open) setPostFinalInterestTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Not Interested Post-Final</DialogTitle>
            <DialogDescription>
              Mark{" "}
              <strong>
                {postFinalInterestTarget?.name || "this applicant"}
              </strong>{" "}
              as no longer interested after the final decision. This is a
              terminal status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPostFinalInterestTarget(null)}
              disabled={pipelineAssignMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!postFinalInterestTarget) return;
                pipelineAssignMutation.mutate({
                  applicationId: postFinalInterestTarget.applicationId,
                  key: "not_interested_post_final",
                });
              }}
              disabled={pipelineAssignMutation.isPending}
            >
              {pipelineAssignMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserX className="h-4 w-4" />
              )}
              Mark Not Interested
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generic "send a template" modal: pick any active email/SMS template
          and send it to the candidate ad-hoc. */}
      <SendTemplateDialog
        target={sendTemplateTarget}
        onClose={() => setSendTemplateTarget(null)}
      />

      {/* Generic BULK "Send email / SMS": a chosen template to every selected
          row, blocked if it uses a token a generic send can't fill. */}
      <BulkSendTemplateDialog
        open={bulkSendOpen}
        applicationIds={Array.from(selectedIds)}
        onClose={() => setBulkSendOpen(false)}
        onSent={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
