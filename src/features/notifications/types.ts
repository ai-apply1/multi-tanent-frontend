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
