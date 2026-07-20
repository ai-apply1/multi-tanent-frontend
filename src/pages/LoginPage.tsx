import { useState } from "react"
import { useForm } from "react-hook-form"
import { yupResolver } from "@hookform/resolvers/yup"
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom"
import * as yup from "yup"
import toast from "react-hot-toast"
import { AlertCircle, Eye, EyeOff, Loader2, Mail, Lock, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/AuthContext"
import { useTenantBranding } from "@/features/tenant/TenantBrandingContext"
import { errorMessage } from "@/lib/errors"
import { ROUTES } from "@/routes"
import { PLATFORM_NAME } from "@/lib/platform"
import { OrgLogo } from "@/components/common/OrgLogo"

const schema = yup.object({
  identifier: yup
    .string()
    .required("Email or username is required")
    .min(3, "At least 3 characters"),
  password: yup.string().required("Password is required").min(8, "At least 8 characters"),
})

interface FormValues {
  identifier: string
  password: string
}

export function LoginPage() {
  const { login, isAuthenticating, user } = useAuth()
  /**
   * The PUBLIC, host-resolved branding, not `useOrganization()`.
   *
   * `useOrganization()` reads `/admin/organization`, which takes the org from
   * the SESSION — and on a login page there is no session, so it never resolves
   * and every org saw the hardcoded fallback below. `GET /org/branding` is
   * answered from the request's host, so an employer's own domain is branded
   * before anyone types a password.
   */
  const organization = useTenantBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { identifier: "", password: "" },
  })

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

  // Never a hardcoded org name: shipping one customer's name to every other
  // customer's login page is the white-label failure this all exists to stop.
  // `PLATFORM_NAME` only shows when no org resolved at all (localhost with no
  // `?tenant=`, or a domain we have no tenant for).
  const orgName = organization?.name || PLATFORM_NAME

  return (
    <div className="grid min-h-screen w-full bg-[var(--surface)] lg:grid-cols-2">
      {/* -------- Form panel -------- */}
      <div className="flex items-center justify-center px-6 py-10 lg:px-10">
        <div className="w-full max-w-[340px]">
          <div className="mb-10 flex items-center gap-2.5">
            <OrgLogo
              logoUrl={organization?.logoUrl}
              name={orgName}
              size="lg"
            />
          </div>

          <h1 className="mb-1.5 text-[30px] font-semibold tracking-tight text-[var(--ink)]">Welcome back</h1>
          <p className="mb-7 text-[14.5px] text-[var(--ink-muted)]">Sign in to your recruiter dashboard.</p>

          <form noValidate onSubmit={onSubmit}>
            <label htmlFor="identifier" className="mb-1.5 block text-[13px] font-medium text-[var(--ink)]">
              Email or username
            </label>
            <div className="relative mb-4">
              <Mail
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-subtle)]"
                aria-hidden
              />
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                placeholder="name@company.com"
                {...register("identifier")}
                aria-invalid={Boolean(errors.identifier)}
                className="h-[46px] w-full rounded-lg border border-[var(--field-border)] bg-[var(--surface)] px-3 pl-10 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-subtle)] focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
              />
            </div>
            {errors.identifier ? (
              <p className="-mt-3 mb-3 text-xs text-[var(--danger)]">{errors.identifier.message}</p>
            ) : null}

            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="password" className="text-[13px] font-medium text-[var(--ink)]">
                Password
              </label>
              <Link
                to={ROUTES.FORGOT_PASSWORD}
                className="text-[12.5px] font-semibold text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative mb-2">
              <Lock
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-subtle)]"
                aria-hidden
              />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                {...register("password")}
                aria-invalid={Boolean(errors.password)}
                className="h-[46px] w-full rounded-lg border border-[var(--field-border)] bg-[var(--surface)] px-3 pl-10 pr-12 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-subtle)] focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-2 flex h-[30px] w-[30px] items-center justify-center rounded-md text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password ? (
              <p className="mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                <AlertCircle className="h-3.5 w-3.5" />
                {errors.password.message}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={isAuthenticating}
              size="lg"
              className="mt-3 h-[46px] w-full text-[15px]"
            >
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

          <p className="mt-5 text-center text-xs text-[var(--ink-subtle)]">
            Recruiter accounts are provisioned by your org admin.
          </p>
        </div>
      </div>

      {/*
        Brand panel — the DevExcel design shows a deep-blue slab. Previously
        this used `var(--accent)`, which was renamed to the soft-blue tint
        used for hover/chip surfaces — the panel therefore washed out to a
        pale sky. Anchoring on `--primary` (#003fbc) and layering the radial
        highlight + gridlines on top restores the branded look.
      */}
      <div className="relative hidden overflow-hidden bg-primary lg:flex lg:items-center lg:px-14">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, var(--primary), white 24%) 0%, transparent 55%), linear-gradient(160deg, var(--primary) 0%, var(--accent-active) 100%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
            backgroundSize: "52px 52px",
            maskImage: "radial-gradient(80% 80% at 60% 30%, #000, transparent)",
          }}
        />

        <div className="relative max-w-[440px] text-white">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[12px] font-semibold">
            <Sparkles className="h-3.5 w-3.5" />
            AI-powered hiring
          </span>
          <h2 className="mt-5 text-[40px] font-semibold leading-[1.08] tracking-tight">
            Screen every candidate,
            <br />
            skip the phone tag.
          </h2>
          <p className="mt-4 text-[15.5px] leading-[1.6] text-white/80">
            Candidates record short video answers on their own time. {orgName} transcribes, scores, and ranks them —
            so recruiters only review the best.
          </p>
          <div className="mt-10 flex gap-9">
            <div>
              <div className="mono text-[30px] font-semibold">68%</div>
              <div className="mt-0.5 text-[12.5px] text-white/70">less screening time</div>
            </div>
            <div>
              <div className="mono text-[30px] font-semibold">12k+</div>
              <div className="mt-0.5 text-[12.5px] text-white/70">interviews scored</div>
            </div>
            <div>
              <div className="mono text-[30px] font-semibold">4.9</div>
              <div className="mt-0.5 text-[12.5px] text-white/70">recruiter rating</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
