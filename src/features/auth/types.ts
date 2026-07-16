export interface AdminUser {
  id: string
  email: string
  name: string
  lastLoginAt: string | null
}

export interface LoginResponse {
  success: boolean
  admin: AdminUser
}

export interface MeResponse {
  success: boolean
  admin: AdminUser
}
