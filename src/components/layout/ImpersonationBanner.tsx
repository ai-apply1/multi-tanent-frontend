import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, ShieldAlert } from "lucide-react"
import { useAuth } from "@/features/auth/AuthContext"
import { ROUTES } from "@/routes"

/**
 * App-wide bar shown ONLY while a super-admin is acting as this user
 * (impersonation). Returns null on a normal HR session, so it costs nothing when
 * absent.
 *
 * Deliberately loud (solid amber, full width, above everything): the whole point
 * is that an operator can never forget the actions they take here are recorded
 * against them and land on the customer's account. "Exit impersonation" ends the
 * session server-side, then closes this tab to return to the super-admin console
 * that opened it (falling back to the login screen if the tab can't self-close).
 */
export function ImpersonationBanner() {
  const { impersonation, user, exitImpersonation } = useAuth()
  const navigate = useNavigate()
  const [exiting, setExiting] = useState(false)

  if (!impersonation) return null

  const handleExit = async () => {
    setExiting(true)
    try {
      await exitImpersonation()
    } finally {
      // The console opened this tab, so closing it returns focus there. If the
      // tab wasn't script-opened, window.close() is a no-op and the fallback
      // sends the now signed-out session to the login screen.
      window.close()
      navigate(ROUTES.LOGIN, { replace: true })
    }
  }

  return (
    <div className="flex w-full shrink-0 items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm text-amber-950">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">
        You are impersonating <strong>{user?.fullName}</strong>
        {user?.email ? ` (${user.email})` : ""}. Actions are recorded against{" "}
        {impersonation.superAdminEmail}.
      </span>
      <button
        type="button"
        onClick={handleExit}
        disabled={exiting}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-950 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-900 disabled:opacity-60"
      >
        {exiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Exit impersonation
      </button>
    </div>
  )
}
