import { useQuery } from "@tanstack/react-query"
import { listTemplates } from "@/features/templates/templatesApi"
import type { ListTemplatesParams } from "@/features/templates/types"

/**
 * Shared query for stored templates. Used by the management page (all
 * templates of a channel) and by the send-time dropdowns (active-only).
 * Keyed by the params so the management list and the picker don't collide.
 * Pass `{ enabled: false }` to defer the fetch (e.g. until a modal opens).
 */
export function useTemplates(
  params: ListTemplatesParams = {},
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: ["templates", params],
    queryFn: () => listTemplates(params),
    enabled: options.enabled ?? true
  })
}
