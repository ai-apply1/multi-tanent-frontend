import { useQuery } from "@tanstack/react-query";
import { listVariables } from "@/features/templates/variablesApi";
import type { TemplateVariableEntry } from "@/features/templates/types";
import {
  APPLICANT_LINK_TOKENS,
  CONTEXT_ONLY_TOKENS,
  extractTokens,
  type TemplateVariableMap,
} from "@/features/templates/templateVariables";

/** Fetch the template-variable registry (drives the chip list + substitution). */
export function useVariables(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["template-variables"],
    queryFn: listVariables,
    enabled: options.enabled ?? true,
  });
}

/** Preview map: system variables use their sample, custom ones their value. */
export function sampleMapFromVariables(
  vars: TemplateVariableEntry[],
): TemplateVariableMap {
  const map: TemplateVariableMap = {};
  for (const v of vars) {
    map[v.token] = v.isSystem ? v.sampleValue : v.value || v.sampleValue;
  }
  return map;
}

/** The constant values of active CUSTOM variables, merged at send time. */
export function customValuesFromVariables(
  vars: TemplateVariableEntry[],
): TemplateVariableMap {
  const map: TemplateVariableMap = {};
  for (const v of vars) {
    if (!v.isSystem && v.isActive && v.value) map[v.token] = v.value;
  }
  return map;
}

/** Tokens a generic send CAN fill: non-context system + active custom. */
function capableTokenSet(vars: TemplateVariableEntry[]): Set<string> {
  const set = new Set<string>();
  for (const v of vars) {
    if (v.isSystem) {
      if (!CONTEXT_ONLY_TOKENS.includes(v.token)) set.add(v.token);
    } else if (v.isActive) {
      set.add(v.token);
    }
  }
  return set;
}

/**
 * Tokens used in the given texts that a GENERIC send cannot fill (link /
 * context tokens, or unknown ones). Non-empty => block the send.
 *
 * `withInterviewLinks` mirrors the backend applicant follow-up flow: the send
 * mints a fresh interview link / opt-out link per recipient, so those tokens
 * (`APPLICANT_LINK_TOKENS`) count as fillable and no longer block.
 */
export function unfillableTokens(
  texts: string[],
  vars: TemplateVariableEntry[],
  opts: { withInterviewLinks?: boolean } = {},
): string[] {
  const capable = capableTokenSet(vars);
  if (opts.withInterviewLinks) {
    for (const t of APPLICANT_LINK_TOKENS) capable.add(t);
  }
  return extractTokens(...texts).filter((t) => !capable.has(t));
}
