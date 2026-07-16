import { useQuery } from "@tanstack/react-query"
import { fetchPipelineCatalog } from "@/features/pipeline/pipelineApi"

export const PIPELINE_CATALOG_QUERY_KEY = ["pipeline-catalog"] as const

/**
 * Shared query for the hiring-pipeline catalog. Used by the Applicants page
 * (data-driven status actions + filters) and the Pipeline Builder. Invalidate
 * on any builder write so the change reflects everywhere.
 */
export function usePipelineCatalog() {
  return useQuery({
    queryKey: PIPELINE_CATALOG_QUERY_KEY,
    queryFn: fetchPipelineCatalog,
    staleTime: 60_000,
  })
}
