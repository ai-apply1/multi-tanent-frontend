import api from "@/lib/api"
import type { OrgProfile, UpdateOrganizationPayload } from "@/features/organization/types"

/** The caller's own org — resolved from the JWT, never addressed by id. */
export async function getOrganization() {
  const { data } = await api.get<OrgProfile>("/admin/organization")
  return data
}

/** `org_admin` only; the backend 403s an `hr` caller. Returns the updated profile. */
export async function updateOrganization(payload: UpdateOrganizationPayload) {
  const { data } = await api.patch<OrgProfile>("/admin/organization", payload)
  return data
}
