import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { io, type Socket } from "socket.io-client"
import toast from "react-hot-toast"
import { useAuth } from "@/features/auth/AuthContext"
import {
  NOTIFICATIONS_LIST_KEY,
  NOTIFICATIONS_UNREAD_KEY,
} from "@/features/notifications/notificationsApi"
import {
  SOCKET_EVENTS,
  type Notification,
} from "@/features/notifications/types"

/**
 * Where the socket connects. The backend serves socket.io on its own origin
 * at `/socket.io` (NOT under the `/api/v1` HTTP prefix). Defaults to the API
 * base; override with `VITE_SOCKET_URL` when the socket must bypass a CDN
 * rewrite that only proxies `/api/*`.
 */
const SOCKET_URL = (
  import.meta.env.VITE_SOCKET_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:3001"
).replace(/\/+$/, "")

const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH ?? "/socket.io"

/**
 * Headless: opens ONE socket for the signed-in user and turns real-time
 * events into React Query cache refreshes, so the bell updates without
 * waiting for the slow fallback poll.
 *
 * Why invalidate rather than hand-patch the cache: the server is the
 * authority on the unread count (a notification could be marked read from
 * another device between events), so every event triggers a cheap authoritative
 * refetch of the badge, and of the list when the panel is open. A `new` event
 * additionally raises a toast. Events are low-frequency (a notification
 * arriving, a read/dismiss action), so the refetches are not a storm.
 *
 * Auth rides the httpOnly cookie on the handshake (`withCredentials`) — the
 * same credential every axios call uses — so there is no token to pass. The
 * socket is torn down on logout (the `user` dependency) and reconnects with a
 * fresh cookie automatically after a drop.
 */
export function NotificationsSocket() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const organizationId = user?.organizationId ?? null
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId) return

    const socket: Socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      withCredentials: true,
      transports: ["websocket", "polling"],
      // Name our org on the handshake. The browser sends EVERY org's session
      // cookie to the shared backend host, so the server needs this hint to
      // read the right one (the token inside is still verified, so this only
      // selects a cookie we already hold, it never grants access).
      auth: { organizationId },
      // socket.io reconnects by default; cap the backoff so a flaky network
      // doesn't drift into minute-long gaps.
      reconnectionDelayMax: 10_000,
    })

    const refreshCount = () =>
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY })
    const refreshList = () =>
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_LIST_KEY })
    const refreshBoth = () => {
      refreshCount()
      refreshList()
    }

    socket.on(SOCKET_EVENTS.NEW, (item: Notification) => {
      // A neutral toast — not success/error — so the register matches "FYI".
      toast(item?.title || "New notification", { icon: "🔔" })
      refreshBoth()
    })
    socket.on(SOCKET_EVENTS.READ, refreshBoth)
    socket.on(SOCKET_EVENTS.READ_ALL, refreshBoth)
    socket.on(SOCKET_EVENTS.DISMISS, refreshBoth)
    socket.on(SOCKET_EVENTS.DISMISS_ALL, refreshBoth)

    // A reconnect after a drop may have missed events — resync from the server.
    socket.io.on("reconnect", refreshBoth)

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [userId, organizationId, queryClient])

  return null
}
