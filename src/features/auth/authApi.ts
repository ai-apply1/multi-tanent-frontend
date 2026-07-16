import api from "@/lib/api"
import type { LoginResponse, MeResponse } from "@/features/auth/types"

/** `identifier` is an email or a userName — the backend resolves which. */
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
