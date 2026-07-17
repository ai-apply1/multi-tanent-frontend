import { useState } from "react"
import { useForm } from "react-hook-form"
import { yupResolver } from "@hookform/resolvers/yup"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import * as yup from "yup"
import toast from "react-hot-toast"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { BrandLogo } from "@/components/BrandLogo"
import { useTenantBranding } from "@/features/tenant/TenantBrandingContext"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/AuthContext"
import { errorMessage } from "@/lib/errors"
import { ROUTES } from "@/routes"

// No `.email()` on `identifier` — it accepts a username too, and the
// backend resolves which one it got. Validating it as an email here would
// reject every username before the request was even sent.
const schema = yup.object({
  identifier: yup
    .string()
    .required("Email or username is required")
    .min(3, "At least 3 characters"),
  password: yup.string().required("Password is required").min(8, "At least 8 characters")
})

interface FormValues {
  identifier: string
  password: string
}

export function LoginPage() {
  const { login, isAuthenticating, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { identifier: "", password: "" }
  })

  // Above the `if (user)` early return below: a hook after it would be skipped
  // on the render where a session already exists, changing hook order between
  // renders. React throws "rendered fewer hooks than expected" for that, and it
  // would fire exactly when a login succeeds.
  const branding = useTenantBranding()

  if (user) {
    return <Navigate to={ROUTES.OVERVIEW} replace />
  }

  const onSubmit = handleSubmit(async ({ identifier, password }) => {
    try {
      await login(identifier, password)
      const dest = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || ROUTES.OVERVIEW
      navigate(dest, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err, "Login failed. Check your credentials and try again."))
    }
  })

  return (
    <div className="auth-gradient relative flex min-h-screen w-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* The EMPLOYER's mark, not ours. This page is served from their own
            domain, so the platform's logo here would be the first thing a
            customer's HR user sees on their own site.

            Three states, and the middle one is the point: an org that has not
            uploaded a logo gets its own NAME, never the platform's mark. Their
            brand is the name; ours is nobody's. The platform mark is reserved
            for the one case where there is genuinely no employer to name —
            localhost with no `?tenant=`, or a domain we have no org for.

            Same fallback the apply portal's `TenantLogo` already uses, so a
            candidate and an HR user see the same thing for a logo-less org. */}
        <div className="mb-8 flex flex-col items-center text-center">
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.name}
              className="h-12 w-auto max-w-56 object-contain"
              draggable={false}
            />
          ) : branding?.name ? (
            <span className="text-2xl font-semibold tracking-tight">
              {branding.name}
            </span>
          ) : (
            <BrandLogo staticMark size="lg" />
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Use your admin credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form noValidate className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="identifier">Email or username</Label>
                <Input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter email or username"
                  {...register("identifier")}
                  aria-invalid={Boolean(errors.identifier)}
                />
                {errors.identifier ? (
                  <p className="text-xs text-destructive">{errors.identifier.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    {...register("password")}
                    aria-invalid={Boolean(errors.password)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password ? (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                ) : null}
              </div>

              <Button type="submit" className="w-full mt-2" disabled={isAuthenticating}>
                {isAuthenticating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
