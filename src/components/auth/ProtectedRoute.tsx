import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/features/auth/AuthContext"
import { ROUTES } from "@/routes"
import { FullScreenLoader } from "@/components/common/FullScreenLoader"

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isInitializing } = useAuth()
  const location = useLocation()

  if (isInitializing) return <FullScreenLoader label="Loading" />

  if (!user) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
  }
  return <>{children}</>
}

export function GuestRoute({ children }: { children: ReactNode }) {
  const { user, isInitializing } = useAuth()
  if (isInitializing) return <FullScreenLoader label="Loading…" />
  if (user) return <Navigate to={ROUTES.OVERVIEW} replace />
  return <>{children}</>
}
