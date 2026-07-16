import { useState } from "react"
import { useForm } from "react-hook-form"
import { yupResolver } from "@hookform/resolvers/yup"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import * as yup from "yup"
import toast from "react-hot-toast"
import axios from "axios"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { BrandLogo } from "@/components/BrandLogo"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/AuthContext"
import { ROUTES } from "@/routes"

const schema = yup.object({
  email: yup.string().required("Email is required").email("Enter a valid email"),
  password: yup.string().required("Password is required").min(8, "At least 8 characters")
})

interface FormValues {
  email: string
  password: string
}

export function LoginPage() {
  const { login, isAuthenticating, admin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { email: "", password: "" }
  })

  if (admin) {
    return <Navigate to={ROUTES.OVERVIEW} replace />
  }

  const onSubmit = handleSubmit(async ({ email, password }) => {
    try {
      await login(email, password)
      const dest = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || ROUTES.OVERVIEW
      navigate(dest, { replace: true })
    } catch (err) {
      const message =
        axios.isAxiosError(err) && (err.response?.data as { message?: string } | undefined)?.message
          ? (err.response!.data as { message: string }).message
          : "Login failed. Check your credentials and try again."
      toast.error(message)
    }
  })

  return (
    <div className="auth-gradient relative flex min-h-screen w-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogo staticMark size="lg" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Use your admin credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form noValidate className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="Enter email"
                  {...register("email")}
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email ? (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
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
