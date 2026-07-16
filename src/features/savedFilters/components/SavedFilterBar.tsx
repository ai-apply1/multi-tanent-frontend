import { useState } from "react"
import toast from "react-hot-toast"
import axios from "axios"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookmarkPlus, Loader2, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createSavedFilter,
  deleteSavedFilter,
  fetchSavedFilters,
} from "@/features/savedFilters/savedFiltersApi"
import type { SavedFilterCriteria } from "@/features/savedFilters/types"

const SAVED_FILTERS_QUERY_KEY = ["saved-filters"] as const

interface SavedFilterBarProps {
  /** The current filter state as a saveable snapshot (active slots only). */
  currentCriteria: SavedFilterCriteria
  /** Apply a saved view's criteria back onto the Applicants filter state. */
  onApply: (criteria: SavedFilterCriteria) => void
}

function extractError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const msg = (err.response?.data as { message?: string } | undefined)?.message
    if (msg) return msg
  }
  return err instanceof Error ? err.message : fallback
}

/**
 * Quick-apply bar for saved filter views: shows each saved view as a chip
 * (click to apply, x to delete) and a "Save current view" action that persists
 * the current filter snapshot. Views are global (shared across all admins).
 */
export function SavedFilterBar({
  currentCriteria,
  onApply,
}: SavedFilterBarProps) {
  const queryClient = useQueryClient()
  const { data: filters = [] } = useQuery({
    queryKey: SAVED_FILTERS_QUERY_KEY,
    queryFn: fetchSavedFilters,
    staleTime: 60_000,
  })
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState("")

  const createMutation = useMutation({
    mutationFn: () =>
      createSavedFilter({ name: name.trim(), criteria: currentCriteria }),
    onSuccess: (saved) => {
      toast.success(`Saved view "${saved.name}".`)
      queryClient.invalidateQueries({ queryKey: SAVED_FILTERS_QUERY_KEY })
      setSaveOpen(false)
      setName("")
    },
    onError: (err) => toast.error(extractError(err, "Could not save view.")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSavedFilter(id),
    onSuccess: () => {
      toast.success("View deleted.")
      queryClient.invalidateQueries({ queryKey: SAVED_FILTERS_QUERY_KEY })
    },
    onError: (err) => toast.error(extractError(err, "Could not delete view.")),
  })

  // Only allow saving when at least one filter is active (an empty view is the
  // default table, nothing to capture).
  const hasActiveFilters = Object.keys(currentCriteria).length > 0

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        Saved views:
      </span>
      {filters.length === 0 ? (
        <span className="text-xs text-muted-foreground">None yet</span>
      ) : (
        filters.map((view) => (
          <span
            key={view.id}
            className="inline-flex items-center overflow-hidden rounded-full border border-border bg-card text-xs"
          >
            <button
              type="button"
              onClick={() => onApply(view.criteria)}
              className="px-2.5 py-1 font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              title="Apply this view"
            >
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(view.id)}
              disabled={deleteMutation.isPending}
              className="border-l border-border px-1.5 py-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Delete this view"
              aria-label={`Delete saved view ${view.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setSaveOpen(true)}
        disabled={!hasActiveFilters}
        title={
          hasActiveFilters
            ? "Save the current filters as a view"
            : "Apply at least one filter to save a view"
        }
      >
        <BookmarkPlus className="h-4 w-4" />
        Save current view
      </Button>

      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          if (createMutation.isPending) return
          setSaveOpen(open)
          if (!open) setName("")
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>
              Save the current filters under a name so the whole team can apply
              them in one click.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label
              htmlFor="saved-view-name"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              View name
            </label>
            <Input
              id="saved-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hot candidates"
              maxLength={80}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !createMutation.isPending) {
                  createMutation.mutate()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!name.trim() || createMutation.isPending}
              className="gap-1.5"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
