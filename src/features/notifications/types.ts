export type NotificationEvent =
  | "interview_completed"
  | "candidate_status_changed"
  | "team_member_added"
  | "job_created"

export interface Notification {
  id: string
  notificationId: string
  title: string
  content: string
  event: NotificationEvent
  type: "email" | "platform" | "both"
  metaData: Record<string, unknown>
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export interface NotificationsResponse {
  items: Notification[]
  unreadCount: number
  page: number
  limit: number
  nextPage: number | null
}

export interface UnreadCountResponse {
  unreadCount: number
}

/**
 * Socket event names (server → client). Mirrors the backend
 * `SOCKET_EVENTS` contract in notification-events.ts — keep the two in sync.
 */
export const SOCKET_EVENTS = {
  NEW: "notification:new",
  READ: "notification:read",
  READ_ALL: "notification:read-all",
  DISMISS: "notification:dismiss",
  DISMISS_ALL: "notification:dismiss-all",
  READY: "notification:ready",
} as const
