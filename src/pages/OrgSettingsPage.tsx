import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Loader2, Lock, Settings, Trash2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrganization } from "@/features/organization/useOrganization";
import {
  presignLogo,
  updateOrganization,
  uploadLogoToPresignedUrl,
} from "@/features/organization/organizationApi";
import type {
  OrganizationSettings,
  OrgProfile,
  UpdateOrganizationPayload,
} from "@/features/organization/types";
import {
  getNotificationPrefs,
  updateNotificationPrefs,
} from "@/features/users/usersApi";
import type { NotificationPrefs } from "@/features/users/types";
import { useAuth } from "@/features/auth/AuthContext";
import { errorMessage as apiError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const MAX_ATTEMPTS_MIN = 1;
const MAX_ATTEMPTS_MAX = 10;
const EXPIRY_DAYS_MIN = 1;
const EXPIRY_DAYS_MAX = 365;

/**
 * The IANA zones the runtime knows about — the picker's OPTIONS, not the
 * validity test (see `isValidTimezone`). Empty on engines without
 * `Intl.supportedValuesOf` (pre-2022), in which case the field falls back to a
 * plain text input and the backend does the validating.
 */
function loadTimezones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    /* not supported here — the fallback below is the whole point */
  }
  return [];
}

/**
 * `Intl.supportedValuesOf("timeZone")` lists canonical IANA zones and omits
 * the "UTC" alias — which is exactly what the org schema DEFAULTS
 * `settings.timezone` to. So UTC has to be offered explicitly, or a
 * default-timezone org can't even see its own saved value in the picker.
 */
const TIMEZONES = loadTimezones();
const TIMEZONE_OPTIONS = (
  TIMEZONES.includes("UTC") ? TIMEZONES : ["UTC", ...TIMEZONES]
).map((value) => ({ value }));

/**
 * Is this a zone the runtime (and therefore the backend) accepts?
 *
 * This MUST be a try/catch on `Intl.DateTimeFormat`, not a lookup in
 * `TIMEZONES`. class-validator's `@IsTimeZone` — the backend's gate — does
 * exactly this, and it accepts aliases like "UTC" that the canonical catalog
 * leaves out. Testing catalog membership instead made this form STRICTER than
 * the server: every org on the default "UTC" failed validation, which
 * disabled Save permanently and made the whole page unsaveable.
 */
function isValidTimezone(value: string): boolean {
  const tz = value.trim();
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirrors the backend's `ALLOWED_LOGO_CONTENT_TYPES` / `MAX_LOGO_BYTES`. The
 * presign is what S3 signs the PUT for, so a type this list allows but the
 * backend doesn't surfaces as a 422 from our own API, not an S3 error.
 */
const ALLOWED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
] as const;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPT = ALLOWED_LOGO_TYPES.join(",");

const toInt = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
};

export function OrgSettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: org, isLoading, isError, refetch } = useOrganization();

  const canWrite = user?.role === "org_admin";

  const [name, setName] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [timezone, setTimezone] = useState("");
  // A fresh page never opens covered in red — errors appear once a field has
  // been edited (which also covers a saved timezone this browser doesn't know).
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [logoBroken, setLogoBroken] = useState(false);

  /**
   * The logo is an upload, not a text field, so it doesn't follow the
   * "edit → compare to profile" shape of the others:
   *
   * - `logoKey === null` means untouched; the PATCH omits it entirely.
   * - a string means pending — either a fresh key (uploaded, not yet saved)
   *   or `""` (remove on save).
   *
   * `localPreview` is an object URL for the file just picked, so the preview
   * updates before the save round-trips. Falls back to the server's
   * `org.logoUrl` whenever there's no pending change.
   */
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seed once the profile lands, and re-seed after a save so the form's
  // baseline is whatever the server last confirmed.
  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setMaxAttempts(String(org.settings.maxInterviewAttempts));
    setExpiryDays(String(org.settings.interviewExpiryDays));
    setTimezone(org.settings.timezone);
    setTouched({});
    setLogoKey(null);
    setLogoError(null);
  }, [org]);

  useEffect(() => {
    setLogoBroken(false);
  }, [org?.logoUrl, localPreview]);

  // Object URLs leak until revoked, and this one outlives its <img> on every
  // re-pick and on unmount.
  useEffect(() => {
    if (!localPreview) return;
    return () => URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  const saveMutation = useMutation({
    mutationFn: (payload: UpdateOrganizationPayload) =>
      updateOrganization(payload),
    onSuccess: (updated) => {
      // Write straight into the cache the shell reads, so the TopBar logo and
      // the sidebar name change with the form instead of after a 5min stale tick.
      queryClient.setQueryData<OrgProfile>(["organization"], updated);
      toast.success("Organization updated.");
    },
    onError: (err) =>
      toast.error(apiError(err, "Could not update organization.")),
  });

  /**
   * Pick → validate → presign → PUT straight to S3. The key is only held in
   * state; the org doesn't point at it until Save. An abandoned upload just
   * orphans an object under this org's own logo prefix.
   */
  const handleLogoFile = async (file: File) => {
    setLogoError(null);

    if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(file.type)) {
      setLogoError("Use a PNG, JPEG, SVG or WebP image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("That image is over 2 MB — use a smaller one.");
      return;
    }

    setUploadPct(0);
    try {
      const presigned = await presignLogo({
        contentType: file.type,
        sizeBytes: file.size,
        fileName: file.name,
      });
      await uploadLogoToPresignedUrl(
        presigned.uploadUrl,
        file,
        presigned.contentType,
        setUploadPct,
      );
      setLogoKey(presigned.key);
      setLocalPreview(URL.createObjectURL(file));
    } catch (err) {
      setLogoError(apiError(err, "Could not upload that image."));
    } finally {
      setUploadPct(null);
      // Let the same file be re-picked after a failure — without this the
      // input's value is unchanged and onChange never fires again.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeLogo = () => {
    setLogoKey("");
    setLocalPreview(null);
    setLogoError(null);
  };

  const previewUrl = localPreview ?? (logoKey === "" ? "" : (org?.logoUrl ?? ""));
  const isUploading = uploadPct !== null;

  const nameError = name.trim().length === 0 ? "A name is required." : null;
  const attemptsValue = toInt(maxAttempts);
  const attemptsError =
    Number.isNaN(attemptsValue) ||
    attemptsValue < MAX_ATTEMPTS_MIN ||
    attemptsValue > MAX_ATTEMPTS_MAX
      ? `Enter a whole number between ${MAX_ATTEMPTS_MIN} and ${MAX_ATTEMPTS_MAX}.`
      : null;
  const expiryValue = toInt(expiryDays);
  const expiryError =
    Number.isNaN(expiryValue) ||
    expiryValue < EXPIRY_DAYS_MIN ||
    expiryValue > EXPIRY_DAYS_MAX
      ? `Enter a whole number between ${EXPIRY_DAYS_MIN} and ${EXPIRY_DAYS_MAX}.`
      : null;
  // Same test the backend's @IsTimeZone runs — see `isValidTimezone`.
  const timezoneError = !isValidTimezone(timezone)
    ? "Pick a time zone from the list."
    : null;

  const hasErrors = Boolean(
    nameError || attemptsError || expiryError || timezoneError,
  );

  // Only changed fields are sent. The PATCH is partial and settings are written
  // as dot-paths, so a partial body can't clobber the siblings it omits.
  const buildPatch = (profile: OrgProfile): UpdateOrganizationPayload => {
    const patch: UpdateOrganizationPayload = {};
    if (name.trim() !== profile.name) patch.name = name.trim();
    // null = untouched. Any string (including "" for removal) is a change —
    // there's no `logoKey` on the profile to diff against, since responses
    // carry the resolved URL instead.
    if (logoKey !== null) patch.logoKey = logoKey;
    const settings: Partial<OrganizationSettings> = {};
    if (attemptsValue !== profile.settings.maxInterviewAttempts) {
      settings.maxInterviewAttempts = attemptsValue;
    }
    if (expiryValue !== profile.settings.interviewExpiryDays) {
      settings.interviewExpiryDays = expiryValue;
    }
    if (timezone.trim() !== profile.settings.timezone) {
      settings.timezone = timezone.trim();
    }
    if (Object.keys(settings).length > 0) patch.settings = settings;
    return patch;
  };

  const patch = org ? buildPatch(org) : {};
  const isDirty = Object.keys(patch).length > 0;
  const canSave =
    canWrite && isDirty && !hasErrors && !isUploading && !saveMutation.isPending;

  const reset = () => {
    if (!org) return;
    setName(org.name);
    setMaxAttempts(String(org.settings.maxInterviewAttempts));
    setExpiryDays(String(org.settings.interviewExpiryDays));
    setTimezone(org.settings.timezone);
    setTouched({});
    setLogoKey(null);
    setLocalPreview(null);
    setLogoError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched({
      name: true,
      maxAttempts: true,
      expiryDays: true,
      timezone: true,
    });
    if (!canSave || !org) return;
    saveMutation.mutate(patch);
  };

  const header = (
    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings className="h-6 w-6 text-primary" />
          Organization settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Your organization&apos;s identity and the defaults every job inherits.
        </p>
      </div>
      {canWrite ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={!isDirty || saveMutation.isPending}
          >
            Reset
          </Button>
          <Button type="submit" form="org-settings-form" disabled={!canSave}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
            Loading organization…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !org) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="py-16 text-center text-sm text-destructive">
            Could not load organization.{" "}
            <button onClick={() => refetch()} className="underline">
              Retry
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {!canWrite ? (
        <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          You have read-only access to these settings. Ask an org admin in your
          organization to change them.
        </p>
      ) : null}

      <form id="org-settings-form" onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>
              How your organization is presented to candidates and inside this
              dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                disabled={!canWrite}
                aria-invalid={Boolean(touched.name && nameError)}
              />
              {touched.name && nameError ? (
                <p className="text-xs text-destructive">{nameError}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="org-logo">Logo</Label>
              <p className="text-xs text-muted-foreground">
                Goes out on every candidate invite email and heads the screening
                page candidates take their interview on — for most candidates
                it&apos;s the only branding they ever see.
              </p>

              <div
                onDragOver={(e) => {
                  if (!canWrite || isUploading) return;
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  // Fires when crossing into a CHILD too, which would flicker
                  // the highlight — only clear when the cursor has actually
                  // left the drop zone's subtree.
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  if (!canWrite || isUploading) return;
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleLogoFile(file);
                }}
                className={cn(
                  "flex items-center gap-4 rounded-xl border p-4 transition-colors",
                  isDragging
                    ? "border-primary border-dashed bg-primary/5"
                    : "border-border bg-muted/20",
                )}
              >
                {/* Fixed-size tile so the row never reflows between the empty,
                    uploading and loaded states. */}
                <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
                  {isUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : previewUrl && !logoBroken ? (
                    <img
                      src={previewUrl}
                      alt={`${name || "Organization"} logo`}
                      className="h-full w-full object-contain p-2"
                      onError={() => setLogoBroken(true)}
                    />
                  ) : (
                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {isUploading ? (
                    <>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">Uploading…</span>
                        <span className="tabular-nums text-muted-foreground">
                          {uploadPct}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-200"
                          style={{ width: `${uploadPct ?? 0}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {logoBroken
                          ? "That image didn't load — candidates would see the Jobjen mark."
                          : previewUrl
                            ? "PNG, JPEG, SVG or WebP · up to 2 MB"
                            : "No logo set — the Jobjen mark is used instead."}
                      </p>
                      {canWrite ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={fileInputRef}
                            id="org-logo"
                            type="file"
                            accept={LOGO_ACCEPT}
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleLogoFile(file);
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            {previewUrl ? "Replace" : "Upload logo"}
                          </Button>
                          {previewUrl ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={removeLogo}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            or drop an image here
                          </span>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {logoError ? (
                <p className="text-xs text-destructive">{logoError}</p>
              ) : logoKey !== null && !isUploading ? (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
                  Not saved yet — hit Save changes.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Interview defaults</CardTitle>
            <CardDescription>
              Applied to every job that doesn&apos;t override them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <Label htmlFor="org-attempts">Max interview attempts</Label>
                <Input
                  id="org-attempts"
                  type="number"
                  min={MAX_ATTEMPTS_MIN}
                  max={MAX_ATTEMPTS_MAX}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, maxAttempts: true }))}
                  disabled={!canWrite}
                  aria-invalid={Boolean(touched.maxAttempts && attemptsError)}
                />
                {touched.maxAttempts && attemptsError ? (
                  <p className="text-xs text-destructive">{attemptsError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    How many times a candidate may sit an interview before
                    re-invites are refused ({MAX_ATTEMPTS_MIN}–{MAX_ATTEMPTS_MAX}
                    ). A job can set its own.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2.5">
                <Label htmlFor="org-expiry">Interview link expiry (days)</Label>
                <Input
                  id="org-expiry"
                  type="number"
                  min={EXPIRY_DAYS_MIN}
                  max={EXPIRY_DAYS_MAX}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, expiryDays: true }))}
                  disabled={!canWrite}
                  aria-invalid={Boolean(touched.expiryDays && expiryError)}
                />
                {touched.expiryDays && expiryError ? (
                  <p className="text-xs text-destructive">{expiryError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    How long an invite link stays usable ({EXPIRY_DAYS_MIN}–
                    {EXPIRY_DAYS_MAX}).
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2.5 sm:max-w-sm">
              <Label htmlFor="org-timezone">Time zone</Label>
              <Combobox
                id="org-timezone"
                value={timezone}
                onValueChange={(v) => {
                  setTouched((t) => ({ ...t, timezone: true }));
                  setTimezone(v);
                }}
                options={TIMEZONE_OPTIONS}
                allowCustom={false}
                placeholder="Asia/Karachi"
                disabled={!canWrite}
                aria-invalid={Boolean(touched.timezone && timezoneError)}
              />
              {touched.timezone && timezoneError ? (
                <p className="text-xs text-destructive">{timezoneError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Type to search the IANA zones. Used for scheduling and the
                  dates shown to candidates.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Shown, not editable: the PATCH whitelist silently strips these, so
            offering them as fields would look like a save that did nothing. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Managed by the platform admin
            </CardTitle>
            <CardDescription>
              These are set when your organization is provisioned. Contact the
              platform admin to change any of them.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="org-slug">Slug</Label>
              <Input id="org-slug" value={org.slug} disabled readOnly />
            </div>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="org-status">Status</Label>
              <Input
                id="org-status"
                value={org.status === "active" ? "Active" : "Inactive"}
                disabled
                readOnly
              />
            </div>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="org-seats">Seats</Label>
              <Input id="org-seats" value={String(org.seats)} disabled readOnly />
              <p className="text-xs text-muted-foreground">
                The cap on active team members.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="org-industry">Industry</Label>
              <Input
                id="org-industry"
                value={org.industry || "—"}
                disabled
                readOnly
              />
            </div>
          </CardContent>
        </Card>
      </form>

      <NotificationPrefsCard />
    </div>
  );
}

/**
 * Self-scoped preferences (`/admin/users/me/...`), so this sits here rather
 * than on the org_admin-only Team page — otherwise `hr` could never reach their
 * own notification settings.
 */
function NotificationPrefsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notificationPrefs"],
    queryFn: getNotificationPrefs,
  });

  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    if (data) setPrefs(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: NotificationPrefs) => updateNotificationPrefs(payload),
    onSuccess: (updated) => {
      queryClient.setQueryData<NotificationPrefs>(
        ["notificationPrefs"],
        updated,
      );
      toast.success("Notification preferences saved.");
    },
    onError: (err) =>
      toast.error(apiError(err, "Could not save notification preferences.")),
  });

  const isDirty = Boolean(
    data &&
      prefs &&
      (prefs.interviewCompleted !== data.interviewCompleted ||
        prefs.statusChange !== data.statusChange),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>My notifications</CardTitle>
        <CardDescription>
          Emails sent to you personally. Everyone else on the team sets their
          own.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
            Loading preferences…
          </p>
        ) : isError || !prefs ? (
          <p className="py-6 text-center text-sm text-destructive">
            Could not load preferences.{" "}
            <button onClick={() => refetch()} className="underline">
              Retry
            </button>
          </p>
        ) : (
          <div className="space-y-4">
            {/* A <label> wrapper would be safe here — `Checkbox` renders a
                <button>, which is interactive content, so label activation bails
                when the box itself is clicked (see the select-all in
                OverviewPage). It's a plain <div> only because the visible text is
                a two-line title + description block, which reads better as an
                aria-label than as a giant click target. */}
            <div className="flex items-start gap-3">
              <Checkbox
                checked={prefs.interviewCompleted}
                onCheckedChange={(checked) =>
                  setPrefs({ ...prefs, interviewCompleted: checked })
                }
                disabled={mutation.isPending}
                className="mt-0.5"
                aria-label="Email me when a candidate submits an interview"
              />
              <div>
                <p className="text-sm font-medium leading-none">
                  Interview completed
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Email me when a candidate submits an interview.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                checked={prefs.statusChange}
                onCheckedChange={(checked) =>
                  setPrefs({ ...prefs, statusChange: checked })
                }
                disabled={mutation.isPending}
                className="mt-0.5"
                aria-label="Email me when a candidate moves to a different stage"
              />
              <div>
                <p className="text-sm font-medium leading-none">Status change</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Email me when a candidate moves to a different stage.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => mutation.mutate(prefs)}
                disabled={!isDirty || mutation.isPending}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save preferences"
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
