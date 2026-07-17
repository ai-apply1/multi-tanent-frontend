export function FullScreenLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-surface-2 text-ink-muted">
      <span
        aria-hidden
        className="h-9 w-9 rounded-full border-2 border-line border-t-primary animate-[om-spin_0.7s_linear_infinite]"
      />
      <span className="text-[13px]">{label}</span>
    </div>
  )
}
