import api from "@/lib/api"
import type { NotificationsResponse } from "@/features/notifications/types"

/** Bell feed for the current user — paginated, unreadCount included. */
export async function listNotifications(
  params: { page?: number; limit?: number } = {},
) {
  const { data } = await api.get<NotificationsResponse>("/admin/notifications", {
    params: { page: params.page ?? 1, limit: params.limit ?? 25 },
  })
  return data
}

export async function markNotificationRead(id: string) {
  const { data } = await api.post<{ ok: boolean }>(
    `/admin/notifications/${id}/read`,
  )
  return data
}

export async function markAllNotificationsRead() {
  const { data } = await api.post<{ updated: number }>(
    "/admin/notifications/read-all",
  )
  return data
}
