import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { BrandLogo } from "@/components/BrandLogo"
import { ROUTES } from "@/routes"

export function NotFoundPage() {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <BrandLogo
        size="md"
        className="absolute top-4 left-4 sm:top-6 sm:left-8"
      />
      <p className="text-5xl font-semibold tracking-tight">404</p>
      <p className="max-w-sm text-muted-foreground">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button asChild>
        <Link to={ROUTES.OVERVIEW}>Back to dashboard</Link>
      </Button>
    </div>
  )
}
