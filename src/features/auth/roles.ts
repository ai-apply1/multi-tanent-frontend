import type { UserRole } from "@/features/auth/types";

/**
 * Who may OPERATE the funnel — mutate candidates, jobs, questions, the
 * pipeline catalog, and overview cards. `interviewer` is a view-only
 * reviewer: the backend 403s every one of those mutations, so pages hide
 * the affordances (buttons, drag, menus) instead of surfacing dead
 * controls that error on click.
 *
 * This is deliberately ONE predicate, not per-feature flags: the backend's
 * rule is exactly "interviewer reads, org_admin/hr act" everywhere the
 * funnel is concerned. Org settings / team / email templates keep their
 * own, stricter `role === "org_admin"` checks.
 */
export function canManageFunnel(role: UserRole | undefined): boolean {
  return role === "org_admin" || role === "hr";
}
