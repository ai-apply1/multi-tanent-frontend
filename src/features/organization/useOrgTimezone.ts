import { useOrganization } from "@/features/organization/useOrganization"

/**
 * The org's chosen IANA zone (`settings.timezone`) for rendering wall-clock
 * dates across the dashboard. Falls back to "UTC" — the schema default — while
 * the profile is still loading or an org never set one, so a caller can always
 * hand a usable zone to the date formatters.
 */
export function useOrgTimezone(): string {
  const { data: org } = useOrganization()
  return org?.settings?.timezone ?? "UTC"
}
