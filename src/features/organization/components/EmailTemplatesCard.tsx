import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, RotateCcw } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import {
  fetchEmailTemplates,
  previewEmailTemplate,
  resetEmailTemplate,
  saveEmailTemplate,
  type EmailTemplateItem,
} from "@/features/organization/emailTemplatesApi"

const inputBase =
  "h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

/**
 * Settings > Emails. Edit the SUBJECT + BODY of each candidate-facing email
 * (the branded shell, logo, colours and footer stay fixed), insert `{{merge
 * fields}}`, and see a live preview rendered by the backend with the org's real
 * brand, so it matches exactly what a candidate receives. Owns its own writes,
 * so it sits outside the shared Settings Save bar.
 */
export function EmailTemplatesCard({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ["email-templates"],
    queryFn: fetchEmailTemplates,
  })
  const templates = query.data?.templates ?? []

  const [purpose, setPurpose] = useState<string>("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  // Which field a variable chip inserts into.
  const [activeField, setActiveField] = useState<"subject" | "body">("body")
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const selected: EmailTemplateItem | undefined = useMemo(
    () => templates.find((t) => t.purpose === purpose) ?? templates[0],
    [templates, purpose],
  )

  // Seed the editor when the selection (or the fetched data) changes. Keyed by
  // the selected purpose so switching emails loads that email's copy.
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!selected) return
    if (seededFor.current === selected.purpose) return
    seededFor.current = selected.purpose
    setPurpose(selected.purpose)
    setSubject(selected.subject)
    setBody(selected.body)
  }, [selected])

  const dirty =
    selected != null &&
    (subject !== selected.subject || body !== selected.body)

  // ── Live preview (debounced) ──────────────────────────────────────────
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => {
    if (!selected) return
    setPreviewing(true)
    let cancelled = false
    const id = setTimeout(() => {
      previewEmailTemplate({ purpose: selected.purpose, subject, body })
        .then((r) => {
          if (!cancelled) setPreviewHtml(r.html)
        })
        .catch(() => {
          if (!cancelled) setPreviewHtml("")
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [selected, subject, body])

  const saveMutation = useMutation({
    mutationFn: () => saveEmailTemplate(purpose, { subject, body }),
    onSuccess: (data) => {
      queryClient.setQueryData(["email-templates"], data)
      seededFor.current = null // re-seed from the saved copy
      toast.success("Email saved.")
    },
    onError: () => toast.error("Could not save the email. Please try again."),
  })

  const resetMutation = useMutation({
    mutationFn: () => resetEmailTemplate(purpose),
    onSuccess: (data) => {
      queryClient.setQueryData(["email-templates"], data)
      seededFor.current = null
      toast.success("Reset to the default copy.")
    },
    onError: () => toast.error("Could not reset the email. Please try again."),
  })

  const busy = saveMutation.isPending || resetMutation.isPending

  /** Insert `text` at the cursor of the active field. */
  const insertAtCursor = (text: string) => {
    if (activeField === "subject") {
      const el = subjectRef.current
      const at = el?.selectionStart ?? subject.length
      setSubject(subject.slice(0, at) + text + subject.slice(at))
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(at + text.length, at + text.length)
      })
    } else {
      const el = bodyRef.current
      const at = el?.selectionStart ?? body.length
      setBody(body.slice(0, at) + text + body.slice(at))
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(at + text.length, at + text.length)
      })
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-6 text-[13.5px] text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading emails...
      </div>
    )
  }
  if (query.isError || !selected) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <p className="text-[13.5px] text-[var(--danger)]">
          Could not load the email templates.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => query.refetch()}
        >
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div>
      {/* Email picker. The page header (EmailTemplatesPage) carries the title +
          description now that this is its own destination, not a Settings tab. */}
      <div className="scroll mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface-3 p-1">
        {templates.map((t) => {
          const isActive = t.purpose === selected.purpose
          return (
            <button
              key={t.purpose}
              type="button"
              onClick={() => {
                seededFor.current = null
                setPurpose(t.purpose)
              }}
              className={
                "shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-colors " +
                (isActive
                  ? "bg-surface text-primary shadow-sm"
                  : "text-ink-muted hover:text-ink")
              }
            >
              {t.label}
              {t.isCustom ? (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Editor */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            {selected.description}
          </p>

          <label className="mb-1.5 block text-[13px] font-semibold text-ink">
            Subject
          </label>
          <input
            ref={subjectRef}
            className={inputBase}
            value={subject}
            disabled={!canWrite}
            onFocus={() => setActiveField("subject")}
            onChange={(e) => setSubject(e.target.value)}
          />

          <label className="mb-1.5 mt-4 block text-[13px] font-semibold text-ink">
            Body
          </label>
          <textarea
            ref={bodyRef}
            rows={14}
            className={inputBase.replace("h-11", "min-h-[280px]") + " resize-y py-3 font-mono text-[13px] leading-relaxed"}
            value={body}
            disabled={!canWrite}
            onFocus={() => setActiveField("body")}
            onChange={(e) => setBody(e.target.value)}
          />

          {/* Merge fields + button inserter */}
          {canWrite ? (
            <div className="mt-3">
              <div className="mb-1.5 text-[12px] font-semibold text-ink-subtle">
                Merge fields (insert into {activeField})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.variables.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    title={v.label}
                    onClick={() => insertAtCursor(`{{${v.token}}}`)}
                    className="rounded-md border border-[var(--line-2)] bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-ink-2 transition hover:border-primary/40 hover:bg-hover"
                  >
                    {`{{${v.token}}}`}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    insertAtCursor("\n\n[[button: Button label | https://example.com]]")
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--line-2)] bg-surface-2 px-2 py-1 text-[11.5px] font-medium text-ink-2 transition hover:border-primary/40 hover:bg-hover"
                >
                  <Plus className="h-3 w-3" /> Button
                </button>
              </div>
              <p className="mt-2 text-[11.5px] text-ink-subtle">
                A field left with no value keeps its {"{{token}}"} visible. Put a
                button on its own line as [[button: Label | url]].
              </p>
            </div>
          ) : null}

          {canWrite ? (
            <div className="mt-4 flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!dirty || busy}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy || !selected.isCustom}
                title={
                  selected.isCustom
                    ? "Discard your changes and use the default copy"
                    : "This email already uses the default copy"
                }
                onClick={() => resetMutation.mutate()}
              >
                {resetMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" strokeWidth={1.7} />
                )}
                Reset to default
              </Button>
              {dirty ? (
                <span className="text-[12px] font-medium text-ink-muted">
                  Unsaved changes
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-line bg-surface-3 px-3 py-2 text-[13px] text-ink-muted">
              You have read-only access. Ask an org admin to edit the emails.
            </p>
          )}
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-[76px] lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink">
              Live preview
            </span>
            {previewing ? (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> Updating
              </span>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <iframe
              title="Email preview"
              // Sandbox with NO allow-* tokens: the preview HTML can't run
              // scripts or navigate, so an org's own copy can't do anything.
              sandbox=""
              srcDoc={previewHtml}
              className="h-[640px] w-full"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
