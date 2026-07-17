import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ROUTES } from "@/routes"

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-2 px-6">
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-surface p-8 text-center">
        <p className="mono text-[52px] font-semibold tracking-tight text-primary leading-none">
          404
        </p>
        <h1 className="mt-4 text-[20px] font-semibold text-ink">
          Page not found
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-muted leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or was moved.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild size="sm">
            <Link to={ROUTES.OVERVIEW}>Go to Overview</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
