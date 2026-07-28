import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Toolbar button that resets every filter on a list page in one click.
 *
 * Rendered only when at least one filter is active (`active`), so an unfiltered
 * list stays uncluttered and the control never implies there is something to
 * clear when there isn't. Styled like the toolbar Refresh button (secondary,
 * sm) so it sits naturally alongside the search box and filter dropdowns.
 *
 * The caller owns what "a filter" means and what clearing does (which state to
 * reset, and resetting pagination to page 1) so each page stays in charge of its
 * own filter set.
 */
export function ClearFiltersButton({
  active,
  onClear,
}: {
  active: boolean;
  onClear: () => void;
}) {
  if (!active) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClear}
      aria-label="Clear filters"
    >
      <X className="h-4 w-4" strokeWidth={1.9} />
      Clear filters
    </Button>
  );
}
