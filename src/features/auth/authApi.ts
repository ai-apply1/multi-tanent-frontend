import api from "@/lib/api"
import type { LoginResponse, MeResponse } from "@/features/auth/types"

export async function loginRequest(email: string, password: string) {
  const { data } = await api.post<LoginResponse>("/admin/auth/login", { email, password })
  return data.user
}

export async function meRequest() {
  const { data } = await api.get<MeResponse>("/admin/auth/me")
  return data.user
}

export async function logoutRequest() {
  await api.post("/admin/auth/logout")
}
