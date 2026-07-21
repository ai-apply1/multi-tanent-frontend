import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-react"
import toast from "react-hot-toast"
import {
  createQuestionCategory,
  listQuestionCategories,
  QUESTION_CATEGORIES_QUERY_KEY,
} from "@/features/question-categories/questionCategoriesApi"
import type { QuestionCategory } from "@/features/question-categories/types"
import { errorMessage as apiError } from "@/lib/errors"
import { cn } from "@/lib/utils"

interface CategoryPickerProps {
  value: string | null | undefined
  /** `null` clears the category — the backend PATCH honours it (see the DTO). */
  onChange: (id: string | null) => void
  placeholder?: string
  disabled?: boolean
}

/**
 * Combobox-style picker over the org's question-category catalog with an
 * inline "+ Add category" affordance pinned at the bottom of the popup.
 * Adding a category calls the API, then auto-selects the fresh row.
 */
export function CategoryPicker({
  value,
  onChange,
  placeholder = "Select a category…",
  disabled,
}: CategoryPickerProps) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: QUESTION_CATEGORIES_QUERY_KEY,
    queryFn: listQuestionCategories,
  })

  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draftLabel, setDraftLabel] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setAdding(false)
        setDraftLabel("")
      }
    }
    document.addEventListener("mousedown", onDocDown)
    return () => document.removeEventListener("mousedown", onDocDown)
  }, [open])

  useEffect(() => {
    if (adding) addInputRef.current?.focus()
  }, [adding])

  const selected = useMemo(
    () => (query.data ?? []).find((c) => c._id === value) ?? null,
    [query.data, value],
  )

  const createMutation = useMutation({
    mutationFn: (label: string) => createQuestionCategory(label),
    onSuccess: (created: QuestionCategory) => {
      queryClient.setQueryData<QuestionCategory[]>(
        QUESTION_CATEGORIES_QUERY_KEY,
        (prev) => (prev ? [...prev, created] : [created]),
      )
      onChange(created._id)
      toast.success(`Added category "${created.label}".`)
      setAdding(false)
      setDraftLabel("")
      setOpen(false)
    },
    onError: (err) => toast.error(apiError(err, "Could not add category.")),
  })

  const submitDraft = () => {
    const label = draftLabel.trim()
    if (!label) return
    createMutation.mutate(label)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-left text-[14px] text-ink outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)] disabled:cursor-not-allowed disabled:bg-ink-faint",
        )}
      >
        <span
          className={cn(
            "truncate",
            !selected && "text-ink-subtle",
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.7} />
      </button>

      {/* Clear affordance — a sibling of the trigger (never nested, which would
          be invalid) so an assigned category can be removed without opening the
          popup. `onChange(null)` is what the backend reads as "clear". */}
      {selected && !disabled ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
          aria-label="Clear category"
          className="absolute right-9 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-muted transition hover:bg-surface-3 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ) : null}

      {open ? (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="max-h-56 overflow-y-auto py-1">
            {/* Always-available clear row — the only path back to "no
                category" once one is assigned (the backend PATCH clears on a
                null categoryId). Active whenever nothing is selected. */}
            <button
              type="button"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-surface-3",
                value ? "text-ink-muted" : "bg-accent text-primary",
              )}
            >
              <span className="truncate">No category</span>
              {value ? null : <Check className="h-3.5 w-3.5" strokeWidth={2.2} />}
            </button>
            {query.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-ink-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : query.isError ? (
              <div className="px-3 py-2 text-[12.5px] text-[var(--danger)]">
                Could not load categories.
              </div>
            ) : (query.data ?? []).length === 0 ? (
              <div className="px-3 py-2 text-[12.5px] text-ink-muted">
                No categories yet.
              </div>
            ) : (
              (query.data ?? []).map((cat) => {
                const active = value === cat._id
                return (
                  <button
                    key={cat._id}
                    type="button"
                    onClick={() => {
                      onChange(cat._id)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-ink transition hover:bg-surface-3",
                      active && "bg-accent text-primary",
                    )}
                  >
                    <span className="truncate">{cat.label}</span>
                    {active ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-line bg-surface-2 p-2">
            {adding ? (
              <div className="flex items-center gap-1.5">
                <input
                  ref={addInputRef}
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      submitDraft()
                    } else if (e.key === "Escape") {
                      e.preventDefault()
                      setAdding(false)
                      setDraftLabel("")
                    }
                  }}
                  maxLength={100}
                  placeholder="New category name"
                  className="h-8 flex-1 rounded-md border border-[var(--field-border)] bg-surface px-2 text-[13px] text-ink outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={submitDraft}
                  disabled={createMutation.isPending || !draftLabel.trim()}
                  className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                  )}
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false)
                    setDraftLabel("")
                  }}
                  aria-label="Cancel"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] font-semibold text-primary transition hover:bg-surface-3"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                Add category
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
