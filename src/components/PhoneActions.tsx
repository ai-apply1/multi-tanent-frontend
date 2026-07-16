import { Copy, MessageCircle, Phone } from "lucide-react"
import toast from "react-hot-toast"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface PhoneActionsProps {
  /** Stored phone number, expected in E.164 form (e.g. "+923001234567"). */
  phoneNumber: string
  className?: string
}

// Phone numbers are persisted in E.164 (a leading "+" then country code +
// subscriber number, validated at submit time). The two link targets want
// slightly different shapes:
//   - `tel:` keeps the leading "+" and drops any spacing/punctuation.
//   - WhatsApp's wa.me wants DIGITS ONLY (country code included, no "+").
const toTelHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`
const toWhatsAppDigits = (phone: string) => phone.replace(/\D/g, "")

/**
 * Click-to-act phone cell. Renders the number as a button that opens a
 * small menu with the dialer (`tel:`), a WhatsApp chat (`wa.me`), and a
 * copy-to-clipboard shortcut. Reuses the same DropdownMenu primitive as the
 * per-row actions so the interaction is consistent across the table.
 */
export function PhoneActions({ phoneNumber, className }: PhoneActionsProps) {
  if (!phoneNumber) {
    return <span className="text-xs text-muted-foreground">No phone</span>
  }

  const waDigits = toWhatsAppDigits(phoneNumber)
  // Guard against legacy/garbage rows: a real international number has a
  // country code + subscriber number, so anything under 8 digits can't open
  // a valid WhatsApp thread.
  const canWhatsApp = waDigits.length >= 8

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(phoneNumber)
      toast.success("Phone number copied.")
    } catch {
      toast.error("Could not access clipboard.")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Phone actions"
          aria-label={`Actions for ${phoneNumber}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            className
          )}
        >
          <Phone className="h-3 w-3 shrink-0" />
          <span className="underline-offset-2 hover:underline">{phoneNumber}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="normal-case text-sm font-medium text-foreground">
          {phoneNumber}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={toTelHref(phoneNumber)}>
            <Phone />
            Call
          </a>
        </DropdownMenuItem>
        {canWhatsApp ? (
          <DropdownMenuItem asChild>
            <a
              href={`https://wa.me/${waDigits}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="text-[#25D366]" />
              WhatsApp
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void handleCopy()}>
          <Copy />
          Copy number
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
