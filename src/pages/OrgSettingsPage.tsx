import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ImageOff,
  Loader2,
  Lock,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@/features/organization/useOrganization";
import { EmailDomainCard } from "@/features/organization/components/EmailDomainCard";
import {
  presignFavicon,
  presignLogo,
  updateOrganization,
  uploadFaviconToPresignedUrl,
  uploadLogoToPresignedUrl,
} from "@/features/organization/organizationApi";
import type {
  OrganizationSettings,
  OrgProfile,
  UpdateOrganizationPayload,
} from "@/features/organization/types";
import { ApplyVideoCard } from "@/features/organization/components/ApplyVideoCard";
import { PortalDomainsCard } from "@/features/organization/components/PortalDomainsCard";
import {
  getNotificationPrefs,
  updateNotificationPrefs,
} from "@/features/users/usersApi";
import type { NotificationPrefs } from "@/features/users/types";
import { useAuth } from "@/features/auth/AuthContext";
import { errorMessage as apiError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { PLATFORM_NAME } from "@/lib/platform";
import { trimTransparentEdges } from "@/lib/imageTrim";

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

/**
 * Mirrors the backend's `ALLOWED_FAVICON_CONTENT_TYPES` / `MAX_FAVICON_BYTES`.
 * Narrower than the logo's and for a reason: a favicon is drawn by a browser
 * (so SVG and .ico are in, JPEG and WebP are out) and cached hard, so it is
 * capped far smaller. The `accept` string also lists `.ico` because some
 * browsers report an .ico file's type only from its extension.
 */
const ALLOWED_FAVICON_TYPES = [
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
] as const;
const MAX_FAVICON_BYTES = 512 * 1024;
const FAVICON_ACCEPT =
  ".ico,image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml";

const toInt = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
};

/**
 * One tab per THING BEING CONFIGURED, not one per storage mechanism.
 *
 * "Identity" used to hold the name, the logo, the favicon, the apply video, the
 * portal domains and the email domain — six unrelated concerns that shared a tab
 * only because they happened to live on the same Mongo document. It had become
 * the page's dumping ground, and a reader looking for "where do I set the DNS"
 * had no reason to guess "Identity".
 *
 * `saves` marks the tabs whose fields feed the org PATCH. The others own their
 * own writes (notifications) or are read-only (platform, domains) — the shared
 * Save bar is hidden on those rather than sitting there permanently disabled,
 * which reads as broken.
 */
type SettingsTab =
  | "general"
  | "branding"
  | "domains"
  | "video"
  | "defaults"
  | "platform"
  | "notifications";

const TABS: Array<{ id: SettingsTab; label: string; saves: boolean }> = [
  { id: "general", label: "General", saves: true },
  { id: "branding", label: "Branding", saves: true },
  { id: "domains", label: "Domains", saves: false },
  { id: "video", label: "Apply video", saves: false },
  { id: "defaults", label: "Interview defaults", saves: true },
  { id: "platform", label: "Platform", saves: false },
  { id: "notifications", label: "My notifications", saves: false },
];

/** Tabs whose edits go through the shared org PATCH + Save bar. */
const SAVING_TABS = new Set<SettingsTab>(
  TABS.filter((t) => t.saves).map((t) => t.id),
);

const inputBase =
  "h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)] disabled:cursor-not-allowed disabled:bg-ink-faint disabled:text-ink-muted";
const labelBase = "mb-1.5 block text-[13px] font-semibold text-ink";

interface ImageUploadRowProps {
  /** DOM id for the hidden file input; also its stable handle. */
  idBase: string;
  label: string;
  description: ReactNode;
  canWrite: boolean;
  /** The image the server currently has, or "" for none. */
  serverUrl: string;
  alt: string;
  allowedTypes: readonly string[];
  maxBytes: number;
  /** `accept` attribute for the file input. */
  accept: string;
  /** The hint under the drop zone, e.g. "PNG, JPG · up to 2 MB". */
  acceptHint: string;
  typeErrorText: string;
  sizeErrorText: string;
  /** Shown when the server's own image fails to load. */
  brokenText: ReactNode;
  presign: (payload: {
    contentType: string;
    sizeBytes: number;
    fileName: string;
  }) => Promise<{ uploadUrl: string; key: string; contentType: string }>;
  upload: (
    uploadUrl: string,
    file: File,
    contentType: string,
    onProgress?: (pct: number) => void,
  ) => Promise<void>;
  /** null = untouched, "" = clear on save, string = new key. */
  onKeyChange: (key: string | null) => void;
  onUploadingChange: (uploading: boolean) => void;
  /**
   * Crop transparent padding off the picked file before uploading. On for the
   * LOGO, where a padded canvas silently shrinks the mark at every render site
   * (see `trimTransparentEdges`); off for the favicon, where a square icon with
   * intentional breathing room is a legitimate design and trimming it would
   * change how the tab icon reads.
   */
  trimTransparentPadding?: boolean;
}

/**
 * One "drag & drop or click to upload" image field: a fixed 72px preview tile,
 * a drop zone, an inline progress bar, and Replace / Remove actions.
 *
 * Fully self-contained. It owns the whole pick → validate → presign → S3 PUT
 * lifecycle and every piece of transient state that goes with it, and talks to
 * the page through exactly two callbacks (`onKeyChange`, `onUploadingChange`)
 * plus one convention: the page remounts it via its React `key` to snap back to
 * `serverUrl` and forget a pending pick. The logo and the favicon are both
 * instances of this, so the two upload experiences cannot drift apart.
 */
function ImageUploadRow({
  idBase,
  label,
  description,
  canWrite,
  serverUrl,
  alt,
  allowedTypes,
  maxBytes,
  accept,
  acceptHint,
  typeErrorText,
  sizeErrorText,
  brokenText,
  presign,
  upload,
  onKeyChange,
  onUploadingChange,
  trimTransparentPadding = false,
}: ImageUploadRowProps) {
  // null = untouched, "" = remove on save, string = uploaded (not yet saved).
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Object URL for the file just picked, so the preview updates before the save
  // round-trips. Falls back to `serverUrl` whenever there's no pending pick.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [broken, setBroken] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isUploading = uploadPct !== null;

  // If the row unmounts mid-upload (a form reset while the PUT is in flight),
  // clear the page's "uploading" flag so Save can't stay blocked forever.
  useEffect(() => {
    return () => onUploadingChange(false);
  }, [onUploadingChange]);

  useEffect(() => {
    setBroken(false);
  }, [serverUrl, localPreview]);

  // Object URLs leak until revoked; this one outlives its <img> on every
  // re-pick and on unmount (which a form reset triggers via the row's key).
  useEffect(() => {
    if (!localPreview) return;
    return () => URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  /**
   * Pick → validate → presign → PUT straight to S3. The key is only reported
   * up; the org doesn't point at it until Save. An abandoned upload just
   * orphans an object under this org's own prefix.
   */
  const handleFile = async (rawFile: File) => {
    setError(null);
    // Validate the file the OPERATOR picked, not the trimmed one. The size cap
    // is a "don't upload huge files" rule about their choice, and trimming only
    // ever shrinks — checking after would let a 5 MB padded PNG slip through
    // just because the crop happened to land under the limit.
    if (!allowedTypes.includes(rawFile.type)) {
      setError(typeErrorText);
      return;
    }
    if (rawFile.size > maxBytes) {
      setError(sizeErrorText);
      return;
    }

    setUploadPct(0);
    onUploadingChange(true);
    try {
      // Crop baked-in transparent margins BEFORE presigning: the presign is
      // signed against a specific content type and the S3 PUT must match it,
      // so the file has to reach its final form first. Falls back to the
      // original on any failure, so this can't block an upload.
      const { file, trimmed, inkHeightRatio } = trimTransparentPadding
        ? await trimTransparentEdges(rawFile)
        : { file: rawFile, trimmed: false, inkHeightRatio: 1 };
      if (trimmed) {
        toast.success(
          `Cropped ${Math.round((1 - inkHeightRatio) * 100)}% empty space from your logo so it fills the space properly.`,
        );
      }

      const presigned = await presign({
        contentType: file.type,
        sizeBytes: file.size,
        fileName: file.name,
      });
      await upload(presigned.uploadUrl, file, presigned.contentType, setUploadPct);
      setPendingKey(presigned.key);
      onKeyChange(presigned.key);
      setLocalPreview(URL.createObjectURL(file));
    } catch (err) {
      setError(apiError(err, "Could not upload that image."));
    } finally {
      setUploadPct(null);
      onUploadingChange(false);
      // Let the same file be re-picked after a failure — without this the
      // input's value is unchanged and onChange never fires again.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = () => {
    setPendingKey("");
    onKeyChange("");
    setLocalPreview(null);
    setError(null);
  };

  const previewUrl = localPreview ?? (pendingKey === "" ? "" : serverUrl);

  return (
    <div>
      <label className={labelBase}>{label}</label>
      <p className="mb-3 text-[12px] text-ink-muted">{description}</p>

      <div className="flex items-center gap-4">
        {/* Fixed-size 72px tile so the row never reflows between the empty,
            uploading and loaded states. */}
        <div className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-line-2 bg-surface-3 text-ink-subtle">
          {isUploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
          ) : previewUrl && !broken ? (
            <img
              src={previewUrl}
              alt={alt}
              className="h-full w-full object-contain p-2"
              onError={() => setBroken(true)}
            />
          ) : (
            <ImageOff className="h-6 w-6" strokeWidth={1.6} />
          )}
        </div>

        <div
          onDragOver={(e) => {
            if (!canWrite || isUploading) return;
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            // Fires when crossing into a CHILD too, which would flicker the
            // highlight — only clear when the cursor has actually left the
            // drop zone's subtree.
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setIsDragging(false);
          }}
          onDrop={(e) => {
            if (!canWrite || isUploading) return;
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          onClick={() => {
            if (!canWrite || isUploading) return;
            inputRef.current?.click();
          }}
          className={cn(
            "flex-1 rounded-[12px] border-2 border-dashed px-5 py-4 text-center transition-colors",
            canWrite && !isUploading
              ? "cursor-pointer bg-surface-2"
              : "bg-surface-2",
            isDragging
              ? "border-primary bg-accent"
              : "border-line-2 hover:border-primary/50",
          )}
        >
          {isUploading ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-ink">Uploading…</span>
                <span className="mono text-ink-muted">{uploadPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${uploadPct ?? 0}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="text-[13.5px] font-semibold text-ink">
                Drag &amp; drop or click to upload
              </div>
              <p className="mt-1 text-[12px] text-ink-muted">{acceptHint}</p>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          id={idBase}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {canWrite && previewUrl && !isUploading ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-4 w-4" strokeWidth={1.9} />
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-ink-muted hover:text-[var(--danger)]"
            onClick={remove}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
            Remove
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-[12px] text-[var(--danger)]">{error}</p>
      ) : pendingKey !== null && !isUploading ? (
        <p className="mt-2 text-[12px] font-semibold text-[var(--warning)]">
          Not saved yet, hit Save changes.
        </p>
      ) : broken ? (
        <p className="mt-2 text-[12px] text-ink-muted">{brokenText}</p>
      ) : null}
    </div>
  );
}

export function OrgSettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: org, isLoading, isError, refetch } = useOrganization();

  const canWrite = user?.role === "org_admin";

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [name, setName] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [timezone, setTimezone] = useState("");
  // A fresh page never opens covered in red — errors appear once a field has
  // been edited (which also covers a saved timezone this browser doesn't know).
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  /**
   * The logo and favicon are uploads, not text fields, so they don't follow the
   * "edit → compare to profile" shape of the others. Each `<ImageUploadRow>`
   * owns its own pick / preview / progress state; this page holds only the two
   * things it needs at save time:
   *
   * - the PENDING KEY reported up by the row (`null` = untouched, so the PATCH
   *   omits it; a string = a fresh key, or `""` to clear), and
   * - whether the row is mid-upload, so Save waits until S3 has the bytes.
   *
   * `formVersion` is the rows' React `key`. Bumping it on (re)load and on Reset
   * remounts them onto the server's current image and drops any pending pick in
   * one move, which is why there's no per-row reset plumbing here.
   */
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [faviconKey, setFaviconKey] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [faviconUploading, setFaviconUploading] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

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
    setFaviconKey(null);
    setFormVersion((v) => v + 1);
  }, [org]);

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
    // there's no `logoKey`/`faviconKey` on the profile to diff against, since
    // responses carry the resolved URL instead.
    if (logoKey !== null) patch.logoKey = logoKey;
    if (faviconKey !== null) patch.faviconKey = faviconKey;
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
    // The apply video is NOT part of this PATCH — it has its own routes and
    // manages its own state in `ApplyVideoCard`.
    return patch;
  };

  const patch = org ? buildPatch(org) : {};
  const isDirty = Object.keys(patch).length > 0;
  const canSave =
    canWrite &&
    isDirty &&
    !hasErrors &&
    !logoUploading &&
    !faviconUploading &&
    !saveMutation.isPending;

  const reset = () => {
    if (!org) return;
    setName(org.name);
    setMaxAttempts(String(org.settings.maxInterviewAttempts));
    setExpiryDays(String(org.settings.interviewExpiryDays));
    setTimezone(org.settings.timezone);
    setTouched({});
    setLogoKey(null);
    setFaviconKey(null);
    setFormVersion((v) => v + 1);
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="text-primary">
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </span>
          <h1 className="text-[23px] font-semibold tracking-tight text-ink">
            Settings
          </h1>
        </div>
        <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
          Your branding, domains and the defaults every job inherits.
        </p>
      </div>
      {/* Save/Reset on tabs that feed the org PATCH — Domains and Platform are
          read-only, and the apply video and notifications own their own writes,
          so a permanently disabled Save button there reads as broken rather
          than as "nothing to save here".
          `|| isDirty` is the safety catch: the form spans several tabs, so
          edits made on General and then abandoned by switching to Domains must
          not vanish behind a hidden Save bar. Unsaved work always keeps a way
          out. */}
      {canWrite && (SAVING_TABS.has(activeTab) || isDirty) ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={reset}
            disabled={!isDirty || saveMutation.isPending}
          >
            Reset
          </Button>
          <Button
            type="submit"
            size="sm"
            form="org-settings-form"
            disabled={!canSave}
          >
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
      <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
        {header}
        <SettingsSkeleton />
      </div>
    );
  }

  if (isError || !org) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
        {header}
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-[13.5px] text-[var(--danger)]">
              Could not load organization.
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const generalBody = (
    <div className="grid gap-5">
      <div>
        <label htmlFor="org-name" className={labelBase}>
          Name
        </label>
        <input
          id="org-name"
          className={inputBase}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          disabled={!canWrite}
          aria-invalid={Boolean(touched.name && nameError)}
        />
        {touched.name && nameError ? (
          <p className="mt-1.5 text-[12px] text-[var(--danger)]">{nameError}</p>
        ) : (
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Shown to candidates on every page and email they receive from you.
          </p>
        )}
      </div>
    </div>
  );

  const brandingBody = (
    <div className="grid gap-5">
      <ImageUploadRow
        key={`logo-${formVersion}`}
        idBase="org-logo"
        label="Organization logo"
        description={
          <>
            Goes out on every candidate invite email and heads the screening
            page candidates take their interview on. For most candidates it&apos;s
            the only branding they ever see.
          </>
        }
        canWrite={canWrite}
        serverUrl={org.logoUrl}
        alt={`${name || "Organization"} logo`}
        allowedTypes={ALLOWED_LOGO_TYPES}
        maxBytes={MAX_LOGO_BYTES}
        accept={LOGO_ACCEPT}
        acceptHint="PNG, JPG, SVG or WebP · up to 2 MB"
        typeErrorText="Use a PNG, JPEG, SVG or WebP image."
        sizeErrorText="That image is over 2 MB. Use a smaller one."
        brokenText={`That image didn't load. Candidates would see the ${PLATFORM_NAME} mark.`}
        presign={presignLogo}
        upload={uploadLogoToPresignedUrl}
        onKeyChange={setLogoKey}
        onUploadingChange={setLogoUploading}
        trimTransparentPadding
      />

      <ImageUploadRow
        key={`favicon-${formVersion}`}
        idBase="org-favicon"
        label="Browser favicon"
        description={
          <>
            The small icon in the browser tab on your careers and apply pages. A
            square mark reads best at this size. Leave it empty to use the
            platform icon.
          </>
        }
        canWrite={canWrite}
        serverUrl={org.faviconUrl}
        alt={`${name || "Organization"} favicon`}
        allowedTypes={ALLOWED_FAVICON_TYPES}
        maxBytes={MAX_FAVICON_BYTES}
        accept={FAVICON_ACCEPT}
        acceptHint="ICO, PNG or SVG · up to 512 KB"
        typeErrorText="Use an ICO, PNG or SVG icon."
        sizeErrorText="That icon is over 512 KB. Use a smaller one."
        brokenText="That icon didn't load. The browser tab would show the platform icon."
        presign={presignFavicon}
        upload={uploadFaviconToPresignedUrl}
        onKeyChange={setFaviconKey}
        onUploadingChange={setFaviconUploading}
      />

    </div>
  );

  /**
   * Both domains on one tab: they are the same job (publish DNS records with
   * your provider) done twice, usually in one sitting by the same person.
   * Portal domains come first — a branded careers URL is what a candidate hits
   * before any email is ever sent.
   *
   * Read-only, so this tab has no Save bar: both are provisioned by the backend
   * and progress on their own as DNS resolves.
   */
  const domainsBody = (
    <div className="grid gap-5">
      {org.domains?.length ? (
        <PortalDomainsCard
          parentDomain={org.parentDomain}
          domains={org.domains}
        />
      ) : null}
      {org.emailDomain ? (
        <EmailDomainCard emailDomain={org.emailDomain} canWrite={canWrite} />
      ) : null}
      {!org.domains?.length && !org.emailDomain ? (
        <p className="text-[13px] text-ink-muted">
          No domains are configured for your organization yet.
        </p>
      ) : null}
    </div>
  );

  /**
   * Its own tab rather than a row under Branding: it is an ingested asset with
   * its own upload/transcode routes and its own polling, so it neither belongs
   * to the profile PATCH nor wants to sit next to fields governed by a Save bar
   * that does not apply to it.
   */
  const videoBody = (
    <div className="grid gap-5">
      <ApplyVideoCard initial={org.applyVideo} canWrite={canWrite} />
    </div>
  );

  const defaultsBody = (
    <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="org-attempts" className={labelBase}>
            Max interview attempts
          </label>
          <input
            id="org-attempts"
            type="number"
            className={inputBase}
            min={MAX_ATTEMPTS_MIN}
            max={MAX_ATTEMPTS_MAX}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, maxAttempts: true }))}
            disabled={!canWrite}
            aria-invalid={Boolean(touched.maxAttempts && attemptsError)}
          />
          {touched.maxAttempts && attemptsError ? (
            <p className="mt-1.5 text-[12px] text-[var(--danger)]">
              {attemptsError}
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-muted">
              How many times a candidate may sit an interview before re-invites
              are refused ({MAX_ATTEMPTS_MIN}–{MAX_ATTEMPTS_MAX}). A job can set
              its own.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="org-expiry" className={labelBase}>
            Interview link expiry (days)
          </label>
          <input
            id="org-expiry"
            type="number"
            className={inputBase}
            min={EXPIRY_DAYS_MIN}
            max={EXPIRY_DAYS_MAX}
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, expiryDays: true }))}
            disabled={!canWrite}
            aria-invalid={Boolean(touched.expiryDays && expiryError)}
          />
          {touched.expiryDays && expiryError ? (
            <p className="mt-1.5 text-[12px] text-[var(--danger)]">
              {expiryError}
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-muted">
              How long an invite link stays usable ({EXPIRY_DAYS_MIN}–
              {EXPIRY_DAYS_MAX}).
            </p>
          )}
        </div>
      </div>

      <div className="max-w-[320px]">
        <label htmlFor="org-timezone" className={labelBase}>
          Time zone
        </label>
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
          <p className="mt-1.5 text-[12px] text-[var(--danger)]">
            {timezoneError}
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Type to search the IANA zones. Used for scheduling and the dates
            shown to candidates.
          </p>
        )}
      </div>
    </div>
  );

  const platformBody = (
    <div>
      <div className="mb-4 flex items-center gap-2 text-[12.5px] text-ink-muted">
        <Lock className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.7} />
        Set when your organization is provisioned. Contact the platform admin
        to change these.
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="org-slug" className={labelBase}>
            Slug
          </label>
          <input
            id="org-slug"
            className={cn(inputBase, "cursor-not-allowed bg-ink-faint")}
            value={org.slug}
            readOnly
            disabled
          />
        </div>
        <div>
          <label htmlFor="org-status" className={labelBase}>
            Status
          </label>
          <input
            id="org-status"
            className={cn(inputBase, "cursor-not-allowed bg-ink-faint")}
            value={org.status === "active" ? "Active" : "Inactive"}
            readOnly
            disabled
          />
        </div>
        <div>
          <label htmlFor="org-seats" className={labelBase}>
            Seats
          </label>
          <input
            id="org-seats"
            className={cn(inputBase, "cursor-not-allowed bg-ink-faint")}
            value={String(org.seats)}
            readOnly
            disabled
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">
            The cap on active team members.
          </p>
        </div>
        <div>
          <label htmlFor="org-industry" className={labelBase}>
            Industry
          </label>
          <input
            id="org-industry"
            className={cn(inputBase, "cursor-not-allowed bg-ink-faint")}
            value={org.industry || "—"}
            readOnly
            disabled
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      {header}

      {!canWrite ? (
        <p className="mb-4 rounded-lg border border-line bg-surface-3 px-3 py-2 text-[13px] text-ink-muted">
          You have read-only access to these settings. Ask an org admin in your
          organization to change them.
        </p>
      ) : null}

      {/* Segmented pill tabs.
          Sized to its CONTENT (`w-fit`), not a fixed 560px: that width was set
          when there were four tabs, and seven inside it forced two-word labels
          to wrap mid-phrase ("Apply / video"), leaving the bar ragged and
          uneven. Each tab is now as wide as its own label — `shrink-0` +
          `whitespace-nowrap` stop the flex row from compressing them back into
          a wrap — and the row scrolls horizontally on a narrow screen rather
          than wrapping or overflowing the card. */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="scroll mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface-3 p-1"
      >
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-5 py-2 text-[13px] font-semibold transition-colors",
                isActive
                  ? "bg-surface text-primary shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <form id="org-settings-form" onSubmit={submit}>
        <div className="rounded-2xl border border-line bg-surface">
          <div className="p-5 sm:p-6">
            {activeTab === "general" ? generalBody : null}
            {activeTab === "branding" ? brandingBody : null}
            {activeTab === "domains" ? domainsBody : null}
            {activeTab === "video" ? videoBody : null}
            {activeTab === "defaults" ? defaultsBody : null}
            {activeTab === "platform" ? platformBody : null}
            {activeTab === "notifications" ? <NotificationPrefsBody /> : null}
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * Loading placeholder for the whole Settings body. Mirrors the segmented tab
 * bar and the content card (defaulting to the General tab's field layout: a
 * full-width name field, a two-column numeric grid and a narrower time-zone
 * field), so the page keeps its shape while the organization loads. Tab-pill
 * widths track the real labels so the bar reads as the real one.
 */
function SettingsSkeleton() {
  return (
    <div>
      {/* Tab bar — same pill container as the live one; `w-fit` so it hugs
          the pills exactly like the real tablist. */}
      <div className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface-3 p-1">
        {TABS.map((t) => (
          <Skeleton
            key={t.id}
            className="h-9 rounded-full"
            style={{ width: `${t.label.length * 8 + 32}px` }}
          />
        ))}
      </div>

      {/* Content card — General tab field layout. */}
      <div className="rounded-2xl border border-line bg-surface">
        <div className="grid gap-5 p-5 sm:p-6">
          <div>
            <Skeleton className="mb-1.5 h-3.5 w-16" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="mb-1.5 h-3.5 w-28" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            ))}
          </div>
          <div className="max-w-[320px]">
            <Skeleton className="mb-1.5 h-3.5 w-20" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Loading placeholder for the notifications tab — two toggle-row cards (title,
 * helper line, a checkbox) and the trailing Save button, matching the real
 * `NotificationPrefsBody` layout below.
 */
function NotificationPrefsSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl border border-line p-4"
        >
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="mt-0.5 h-4 w-4 rounded" />
        </div>
      ))}
      <div className="mt-1 flex justify-end">
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Self-scoped preferences (`/admin/users/me/...`), so this sits inside the
 * Settings page rather than on the org_admin-only Team page — otherwise `hr`
 * could never reach their own notification settings.
 */
function NotificationPrefsBody() {
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

  if (isLoading) {
    return <NotificationPrefsSkeleton />;
  }

  if (isError || !prefs) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-[13.5px] text-[var(--danger)]">
          Could not load preferences.
        </p>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {/* A <label> wrapper would be safe here — `Checkbox` renders a
          <button>, which is interactive content, so label activation bails
          when the box itself is clicked. */}
      <div className="flex items-start gap-3 rounded-xl border border-line p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">
            Interview completed
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">
            Email me when a candidate submits an interview.
          </p>
        </div>
        <Checkbox
          checked={prefs.interviewCompleted}
          onCheckedChange={(checked) =>
            setPrefs({ ...prefs, interviewCompleted: checked })
          }
          disabled={mutation.isPending}
          className="mt-0.5"
          aria-label="Email me when a candidate submits an interview"
        />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-line p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">
            Status change
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">
            Email me when a candidate moves to a different stage.
          </p>
        </div>
        <Checkbox
          checked={prefs.statusChange}
          onCheckedChange={(checked) =>
            setPrefs({ ...prefs, statusChange: checked })
          }
          disabled={mutation.isPending}
          className="mt-0.5"
          aria-label="Email me when a candidate moves to a different stage"
        />
      </div>

      <div className="mt-1 flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => prefs && mutation.mutate(prefs)}
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
  );
}
