import { useState } from "react"
import { Check, Copy } from "lucide-react"

/**
 * Copy-to-clipboard icon button with a 1.5s "copied" tick.
 *
 * Shared because DNS values are the one thing in this dashboard nobody should
 * retype: a CNAME target or a DKIM public key is long, opaque, and a single
 * wrong character fails verification with no useful error. Both the email
 * sending domain and the portal domains hand these to a customer's DNS team.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={1.9} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.7} />
      )}
    </button>
  )
}
