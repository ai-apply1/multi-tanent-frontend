import api from "@/lib/api"
import type { LoginResponse, MeResponse } from "@/features/auth/types"

/**
 * `identifier` is an email or a userName — the backend resolves which.
 *
 * It does NOT resolve WHO on its own, and that's worth knowing before you
 * debug a 401 here: HR identifiers are unique per-org, not globally, so the
 * backend first works out which org this request belongs to FROM THE PAGE'S
 * OWN HOSTNAME (`admin.acme.com` → Acme, via the Origin header the browser
 * sets) and only then looks the user up inside it. There is no org field in
 * this body and there must not be one — the domain is the selector.
 *
 * So a correct email + correct password still 401s ("Invalid credentials",
 * deliberately indistinguishable) when the page is served from a host the
 * backend doesn't recognise: any org whose custom domain isn't live yet, a
 * Vercel preview URL, or localhost. For localhost the backend has a dev-only
 * fallback — it needs `DEV_LOGIN_ORG_SLUG=<an org slug>` AND
 * `NODE_ENV=development` in the API's `.env`, and it is impossible in prod.
 */
export async function loginRequest(identifier: string, password: string) {
  const { data } = await api.post<LoginResponse>("/admin/auth/login", {
    identifier,
    password
  })
  return data.user
}

export async function meRequest() {
  const { data } = await api.get<MeResponse>("/admin/auth/me")
  return data.user
}

export async function logoutRequest() {
  await api.post("/admin/auth/logout")
}
