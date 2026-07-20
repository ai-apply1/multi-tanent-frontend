import { useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { yupResolver } from "@hookform/resolvers/yup"
import { Link, useNavigate } from "react-router-dom"
import * as yup from "yup"
import toast from "react-hot-toast"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { forgotPasswordRequest, resetPasswordRequest } from "@/features/auth/authApi"
import { useTenantBranding } from "@/features/tenant/TenantBrandingContext"
import { errorMessage } from "@/lib/errors"
import { ROUTES } from "@/routes"
import { PLATFORM_NAME } from "@/lib/platform"
import { OrgLogo } from "@/components/common/OrgLogo"

/**
 * The backend's own numbers, mirrored so the copy can't drift from reality:
 * `AuthCodeService.RESET_CODE_TTL_MINUTES` and `CODE_LENGTH`.
 */
const CODE_LENGTH = 6
const CODE_TTL_MINUTES = 30

/** Client-side only, purely to stop accidental double-sends. Not a security control. */
const RESEND_COOLDOWN_SECONDS = 60

const emailSchema = yup.object({
  email: yup.string().required("Email is required").email("Enter a valid email"),
})

/**
 * Mirrors `ResetPasswordDto` exactly — code is `Length(6, 6)` and the password
 * is `MinLength(8) MaxLength(72)` (72 is bcrypt's input ceiling, not a taste
 * call). Keeping these in sync means the user sees the constraint inline rather
 * than as a round-tripped class-validator string.
 */
const resetSchema = yup.object({
  code: yup
    .string()
    .required("Enter the code from your email")
    .length(CODE_LENGTH, `The code is ${CODE_LENGTH} characters`),
  newPassword: yup
    .string()
    .required("Choose a new password")
    .min(8, "At least 8 characters")
    .max(72, "At most 72 characters"),
  confirmPassword: yup
    .string()
    .required("Confirm your new password")
    .oneOf([yup.ref("newPassword")], "Passwords do not match"),
})

interface EmailFormValues {
  email: string
}

interface ResetFormValues {
  code: string
  newPassword: string
  confirmPassword: string
}

type Step = "email" | "code" | "done"

const fieldClass =
  "h-[46px] w-full rounded-lg border border-[var(--field-border)] bg-[var(--surface)] px-3 pl-10 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-subtle)] focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

/**
 * HR password reset. Three steps, one route, all state local — there is
 * nothing here worth putting in a URL (the email would be the only candidate,
 * and it does not belong in browser history or a referer header).
 *
 * The backend flow this drives is a CODE, not a link: `/admin/auth/forgot-password`
 * emails a single-use 6-character code and always 200s regardless of whether the
 * account exists, then `/admin/auth/reset-password` redeems it. Which org the
 * email is looked up in comes from this page's own hostname — see the long note
 * in `authApi.loginRequest`.
 */
export function ForgotPasswordPage() {
  const organization = useTenantBranding()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [resetError, setResetError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const emailForm = useForm<EmailFormValues>({
    resolver: yupResolver(emailSchema),
    defaultValues: { email: "" },
  })

  // A second, independent form: one merged schema would make step 1's submit
  // fail validation on step 2's still-empty required fields.
  const resetForm = useForm<ResetFormValues>({
    resolver: yupResolver(resetSchema),
    defaultValues: { code: "", newPassword: "", confirmPassword: "" },
  })

  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS)
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  const onSubmitEmail = emailForm.handleSubmit(async (values) => {
    const address = values.email.trim()
    try {
      await forgotPasswordRequest(address)
      // Advance on ANY 2xx. The endpoint is blind by design, so "we sent it"
      // is the only honest thing we can say — and it must be said for unknown
      // emails too, or this page becomes an account-enumeration oracle.
      setEmail(address)
      setResetError(null)
      setStep("code")
      startCooldown()
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the reset code. Try again."))
    }
  })

  const onSubmitReset = resetForm.handleSubmit(async (values) => {
    setResetError(null)
    try {
      await resetPasswordRequest(email, values.code.trim(), values.newPassword)
      setStep("done")
    } catch (err) {
      // Deliberately not branched: the server collapses wrong / expired /
      // already-used / unknown-account into one message so none of them can be
      // told apart. Show it inline and keep the user on this step.
      setResetError(
        errorMessage(err, "Invalid or expired reset code."),
      )
    }
  })

  const onResend = async () => {
    if (cooldown > 0 || isResending) return
    setIsResending(true)
    try {
      await forgotPasswordRequest(email)
      resetForm.setValue("code", "")
      setResetError(null)
      toast.success("A new code is on its way. The previous one no longer works.")
      startCooldown()
    } catch (err) {
      toast.error(errorMessage(err, "Could not resend the code. Try again."))
    } finally {
      setIsResending(false)
    }
  }

  // Same rule as the login page: never a hardcoded org name, and the branding
  // comes from the host-resolved public endpoint because there is no session.
  const orgName = organization?.name || PLATFORM_NAME

  return (
    <div className="grid min-h-screen w-full bg-[var(--surface)] lg:grid-cols-2">
      {/* -------- Form panel -------- */}
      <div className="flex items-center justify-center px-6 py-10 lg:px-10">
        <div className="w-full max-w-[340px]">
          <div className="mb-10 flex items-center gap-2.5">
            <OrgLogo
              logoUrl={organization?.logoUrl}
              logoDarkUrl={organization?.logoDarkUrl}
              name={orgName}
              size="lg"
            />
          </div>

          {step === "email" ? (
            <>
              <h1 className="mb-1.5 text-[30px] font-semibold tracking-tight text-[var(--ink)]">
                Reset your password
              </h1>
              <p className="mb-7 text-[14.5px] text-[var(--ink-muted)]">
                Enter your work email and we'll send you a {CODE_LENGTH}-character code.
              </p>

              <form noValidate onSubmit={onSubmitEmail}>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-[13px] font-medium text-[var(--ink)]"
                >
                  Email
                </label>
                <div className="relative mb-4">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-subtle)]"
                    aria-hidden
                  />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="name@company.com"
                    {...emailForm.register("email")}
                    aria-invalid={Boolean(emailForm.formState.errors.email)}
                    className={fieldClass}
                  />
                </div>
                {emailForm.formState.errors.email ? (
                  <p className="-mt-3 mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {emailForm.formState.errors.email.message}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  disabled={emailForm.formState.isSubmitting}
                  size="lg"
                  className="mt-3 h-[46px] w-full text-[15px]"
                >
                  {emailForm.formState.isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send reset code"
                  )}
                </Button>
              </form>
            </>
          ) : null}

          {step === "code" ? (
            <>
              <h1 className="mb-1.5 text-[30px] font-semibold tracking-tight text-[var(--ink)]">
                Check your email
              </h1>
              <p className="mb-1.5 text-[14.5px] text-[var(--ink-muted)]">
                If an account exists for <span className="font-medium text-[var(--ink)]">{email}</span>,
                we've sent a {CODE_LENGTH}-character code. It expires in {CODE_TTL_MINUTES} minutes.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStep("email")
                  setResetError(null)
                  resetForm.reset()
                }}
                className="mb-7 text-[12.5px] font-semibold text-primary hover:underline"
              >
                Wrong email? Change it
              </button>

              <form noValidate onSubmit={onSubmitReset}>
                <label
                  htmlFor="code"
                  className="mb-1.5 block text-[13px] font-medium text-[var(--ink)]"
                >
                  Reset code
                </label>
                <div className="relative mb-4">
                  <KeyRound
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-subtle)]"
                    aria-hidden
                  />
                  <input
                    id="code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={CODE_LENGTH}
                    placeholder="ABC234"
                    {...resetForm.register("code", {
                      // The emailed alphabet is uppercase; the backend uppercases
                      // on redeem anyway, so this is purely so what's typed looks
                      // like what's in the email.
                      onChange: (e) => {
                        e.target.value = e.target.value.toUpperCase()
                      },
                    })}
                    aria-invalid={Boolean(resetForm.formState.errors.code)}
                    className={`${fieldClass} mono uppercase tracking-[0.35em]`}
                  />
                </div>
                {resetForm.formState.errors.code ? (
                  <p className="-mt-3 mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {resetForm.formState.errors.code.message}
                  </p>
                ) : null}

                <label
                  htmlFor="newPassword"
                  className="mb-1.5 block text-[13px] font-medium text-[var(--ink)]"
                >
                  New password
                </label>
                <div className="relative mb-4">
                  <Lock
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-subtle)]"
                    aria-hidden
                  />
                  <input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    {...resetForm.register("newPassword")}
                    aria-invalid={Boolean(resetForm.formState.errors.newPassword)}
                    className={`${fieldClass} pr-12`}
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
                {resetForm.formState.errors.newPassword ? (
                  <p className="-mt-3 mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {resetForm.formState.errors.newPassword.message}
                  </p>
                ) : null}

                <label
                  htmlFor="confirmPassword"
                  className="mb-1.5 block text-[13px] font-medium text-[var(--ink)]"
                >
                  Confirm new password
                </label>
                <div className="relative mb-4">
                  <Lock
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-subtle)]"
                    aria-hidden
                  />
                  <input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your new password"
                    {...resetForm.register("confirmPassword")}
                    aria-invalid={Boolean(resetForm.formState.errors.confirmPassword)}
                    className={fieldClass}
                  />
                </div>
                {resetForm.formState.errors.confirmPassword ? (
                  <p className="-mt-3 mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {resetForm.formState.errors.confirmPassword.message}
                  </p>
                ) : null}

                {resetError ? (
                  <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-[var(--danger-soft)] px-3 py-2.5 text-[12.5px] font-medium text-[var(--danger)]">
                    <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                    {resetError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  disabled={resetForm.formState.isSubmitting}
                  size="lg"
                  className="mt-1 h-[46px] w-full text-[15px]"
                >
                  {resetForm.formState.isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Resetting…
                    </>
                  ) : (
                    "Reset password"
                  )}
                </Button>
              </form>

              <p className="mt-4 text-center text-[12.5px] text-[var(--ink-subtle)]">
                Didn't get it?{" "}
                <button
                  type="button"
                  onClick={onResend}
                  disabled={cooldown > 0 || isResending}
                  className="font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:text-[var(--ink-subtle)] disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : isResending ? "Sending…" : "Resend code"}
                </button>
                <br />
                Resending invalidates the previous code.
              </p>
            </>
          ) : null}

          {step === "done" ? (
            <>
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="mb-1.5 text-[30px] font-semibold tracking-tight text-[var(--ink)]">
                Password updated
              </h1>
              <p className="mb-7 text-[14.5px] text-[var(--ink-muted)]">
                You've been signed out on every device for security. Sign in again with your
                new password.
              </p>
              <Button
                type="button"
                size="lg"
                className="h-[46px] w-full text-[15px]"
                onClick={() => navigate(ROUTES.LOGIN, { replace: true })}
              >
                Back to sign in
              </Button>
            </>
          ) : null}

          {step !== "done" ? (
            <p className="mt-5 text-center text-xs text-[var(--ink-subtle)]">
              <Link
                to={ROUTES.LOGIN}
                className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </Link>
            </p>
          ) : null}
        </div>
      </div>

      {/* -------- Brand panel -------- */}
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
            Secure account recovery
          </span>
          <h2 className="mt-5 text-[40px] font-semibold leading-[1.08] tracking-tight">
            Back into your
            <br />
            dashboard in a minute.
          </h2>
          <p className="mt-4 text-[15.5px] leading-[1.6] text-white/80">
            {orgName} sends a single-use code that expires in {CODE_TTL_MINUTES} minutes. Setting a
            new password signs out every other session automatically.
          </p>
        </div>
      </div>
    </div>
  )
}
