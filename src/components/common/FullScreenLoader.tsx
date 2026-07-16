import { Loader2 } from "lucide-react"

export function FullScreenLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center bg-background text-muted-foreground">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
