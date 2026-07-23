import api from "@/lib/api";
import type { UserRole } from "@/features/auth/types";
import type {
  CreateUserPayload,
  CreateUserResponse,
  NotificationPrefs,
  OrgUser,
  UpdateUserPayload,
  UserListResponse,
} from "@/features/users/types";

/** Members of the caller's own org. Scoped by the JWT — no org id is ever sent. */
export async function listUsers(
  params: {
    page?: number;
    limit?: number;
    search?: string;
    role?: UserRole;
    isActive?: boolean;
  } = {},
) {
  const { data } = await api.get<UserListResponse>("/admin/users", {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 25,
      ...(params.search ? { search: params.search } : {}),
      ...(params.role ? { role: params.role } : {}),
      ...(params.isActive === undefined ? {} : { isActive: params.isActive }),
    },
  });
  return data;
}

/**
 * `org_admin` only. The payload carries no password on purpose — the backend
 * mints a temporary one and emails it. Check `credentialsEmailSent` on the
 * response: `false` means the mail never went out.
 *
 * 409s here are the interesting path: the seat limit (only a platform admin
 * can raise it) and duplicate email/username (both unique PER organization, so
 * a conflict always means the value is taken inside the caller's own org).
 */
export async function createUser(payload: CreateUserPayload) {
  const { data } = await api.post<CreateUserResponse>("/admin/users", payload);
  return data;
}

/**
 * `org_admin` only. The backend 403s a caller who tries to change their own
 * role or deactivate themselves, so the UI disables those actions on your own
 * row rather than letting them fail.
 */
export async function updateUser(id: string, payload: UpdateUserPayload) {
  const { data } = await api.patch<OrgUser>(`/admin/users/${id}`, payload);
  return data;
}

/**
 * Permanently delete a team member. `org_admin` only, and the backend 403s an
 * admin who targets their own row — so the UI never offers Delete on your own
 * row. Distinct from deactivation: this removes the user entirely.
 */
export async function deleteUser(id: string) {
  const { data } = await api.delete<{ deleted: boolean; userId: string }>(
    `/admin/users/${id}`,
  );
  return data;
}

/** Self-scoped, so `hr` reaches it too (it lives on the settings page). */
export async function getNotificationPrefs() {
  const { data } = await api.get<NotificationPrefs>(
    "/admin/users/me/notification-prefs",
  );
  return data;
}

export async function updateNotificationPrefs(payload: NotificationPrefs) {
  const { data } = await api.patch<NotificationPrefs>(
    "/admin/users/me/notification-prefs",
    payload,
  );
  return data;
}
