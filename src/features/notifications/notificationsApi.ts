import api from "@/lib/api"
import type {
  NotificationsResponse,
  UnreadCountResponse,
} from "@/features/notifications/types"

/**
 * Shared React Query keys so the bell UI and the socket hook mutate the SAME
 * cache entries. The list and the badge count are split: the badge is always
 * mounted and kept fresh, while the (heavier, paginated) list is fetched only
 * when the panel is open.
 */
export const NOTIFICATIONS_LIST_KEY = ["notifications", "list"] as const
export const NOTIFICATIONS_UNREAD_KEY = [
  "notifications",
  "unread-count",
] as const

/** Bell feed for the current user — paginated, unreadCount included. */
export async function listNotifications(
  params: { page?: number; limit?: number } = {},
) {
  const { data } = await api.get<NotificationsResponse>("/admin/notifications", {
    params: { page: params.page ?? 1, limit: params.limit ?? 25 },
  })
  return data
}

/** Just the badge count — cheap enough to keep fresh on its own cadence. */
export async function getUnreadCount() {
  const { data } = await api.get<UnreadCountResponse>(
    "/admin/notifications/unread-count",
  )
  return data
}

/**
 * Mark ONE notification read, addressed by its NOTIFICATION id (the
 * `notificationId` field on a feed item — the backend keys read state on the
 * parent notification, not the receipt row).
 */
export async function markNotificationRead(notificationId: string) {
  const { data } = await api.post<{ ok: boolean }>(
    `/admin/notifications/${notificationId}/read`,
  )
  return data
}

export async function markAllNotificationsRead() {
  const { data } = await api.post<{ updated: number }>(
    "/admin/notifications/read-all",
  )
  return data
}

/** Clear ONE notification from the caller's bell (per-user soft delete). */
export async function dismissNotification(notificationId: string) {
  const { data } = await api.delete<{ ok: boolean }>(
    `/admin/notifications/${notificationId}`,
  )
  return data
}

/** Clear the caller's whole bell. */
export async function dismissAllNotifications() {
  const { data } = await api.delete<{ cleared: number }>(
    "/admin/notifications/dismiss-all",
  )
  return data
}
