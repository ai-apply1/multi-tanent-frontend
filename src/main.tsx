import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "react-hot-toast"
import App from "@/App"
import { AuthProvider } from "@/features/auth/AuthContext"
import { TenantBrandingProvider } from "@/features/tenant/TenantBrandingContext"
import { DocumentBranding } from "@/features/tenant/DocumentBranding"
import { DevTenantSync } from "@/features/tenant/DevTenantSync"
import { NotificationsSocket } from "@/features/notifications/NotificationsSocket"
import { ThemeProvider } from "@/features/theme/ThemeContext"
import { ensureCryptoReady } from "@/lib/crypto"
import "@/styles/globals.css"

// Kick off the public-key bootstrap as early as possible so the first
// real API call doesn't pay the round-trip. Failure is non-fatal — the
// axios layer retries on every encrypted request anyway.
ensureCryptoReady().catch((err) => {
  // eslint-disable-next-line no-console
  console.warn("[crypto] Initial public-key bootstrap failed:", err)
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  }
})

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root element")

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* INSIDE the query client (it fetches) but OUTSIDE auth (it must
              not need a session). The branding comes from the public
              host-resolved endpoint, so the LOGIN page is already the
              employer's: their name in the tab, their favicon, their logo. */}
          {/* Inside the router (it reads the location), above everything that
              navigates. Renders nothing and no-ops entirely in production. */}
          <DevTenantSync />
          <TenantBrandingProvider>
              <AuthProvider>
              {/* The single writer of the tab title, favicon and theme. Inside
                  AuthProvider so it can prefer the AUTHENTICATED org over the
                  host's public branding once someone signs in. */}
              <DocumentBranding />
              {/* Headless: opens the notifications socket for the signed-in
                  user (needs the session from AuthProvider and the cache from
                  QueryClientProvider, both above). Renders nothing. */}
              <NotificationsSocket />
              <App />
              <Toaster
                position="top-right"
                toastOptions={{
                  style: {
                    background: "var(--card)",
                    color: "var(--card-foreground)",
                    border: "1px solid var(--border)",
                    fontSize: "14px"
                  }
                }}
              />
            </AuthProvider>
          </TenantBrandingProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
