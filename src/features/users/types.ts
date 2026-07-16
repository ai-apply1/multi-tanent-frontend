import type { UserRole } from "@/features/auth/types";

/**
 * A member of the signed-in user's own organization, as returned by
 * `/admin/users`. The org is resolved from the JWT — `organizationId` comes
 * back on the row but is never sent by the client.
 *
 * Note the id field is `_id` here while the session user (`SessionUser`) uses
 * `id`; the two are compared in the self-action guards on the Team page.
 */
export interface OrgUser {
  _id: string;
  organizationId: string;
  fullName: string;
  userName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  data: OrgUser[];
  count: number;
  page: number;
  limit: number;
  totalPage: number;
  nextPage: number | null;
}

/**
 * `password` is deliberately absent. Omitting it makes the backend generate a
 * temporary password and email it to the new user — the only way this app
 * creates members, so there is no field for it to send.
 */
export interface CreateUserPayload {
  fullName: string;
  email: string;
  userName: string;
  role: UserRole;
}

/**
 * `credentialsEmailSent: false` means the account exists but the temp password
 * never left the building — the admin has to get it to the user some other way.
 */
export interface CreateUserResponse {
  user: OrgUser;
  credentialsEmailSent: boolean;
}

/**
 * There is no DELETE for users — `isActive: false` is the only removal, and it
 * is reversible.
 */
export interface UpdateUserPayload {
  fullName?: string;
  role?: UserRole;
  isActive?: boolean;
}

/** `/admin/users/me/notification-prefs` — self-scoped, so every role may use it. */
export interface NotificationPrefs {
  interviewCompleted: boolean;
  statusChange: boolean;
}

/** Mirrors the backend's `@Matches` on `userName`; surfaced as helper text. */
export const USER_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,49}$/;

export const USER_ROLES: UserRole[] = ["org_admin", "hr"];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  org_admin: "Org admin",
  hr: "HR",
};
