import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface MaskedAmountProps {
  /** The already-formatted value to reveal when the eye is toggled on. */
  value: string;
  className?: string;
  /** Accessible noun used in the toggle's aria-label, e.g. "salary". */
  label?: string;
}

/**
 * A sensitive value shown as a fixed asterisk mask by default, with an eye
 * toggle to reveal it — like a password field. The mask is a FIXED width so it
 * never leaks the magnitude (digit count) of the value behind it. Reveal state
 * is local and resets whenever the component unmounts (e.g. the drawer closes).
 */
export function MaskedAmount({
  value,
  className,
  label = "value",
}: MaskedAmountProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn(!revealed && "tracking-[0.2em]")}>
        {revealed ? value : "******"}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-pressed={revealed}
        aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        className="text-ink-subtle transition-colors hover:text-ink"
      >
        {revealed ? (
          <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Eye className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </span>
  );
}

interface MaskedNumbersProps {
  /** A sentence that may embed sensitive figures. */
  text: string;
  className?: string;
  /** Accessible noun used in the toggle's aria-label, e.g. "salary". */
  label?: string;
}

/**
 * Renders a sentence with every numeric group masked behind a fixed asterisk
 * run by default, plus an eye toggle to reveal the real figures — used for the
 * pre-screen salary reason, e.g. "…expected salary (140,000) is within the
 * maximum for this role (150,000)." When the text has no figures (already
 * redacted server-side for a restricted role), it renders as plain text with
 * no toggle — there is nothing to reveal.
 */
export function MaskedNumbers({
  text,
  className,
  label = "figures",
}: MaskedNumbersProps) {
  const [revealed, setRevealed] = useState(false);
  const masked = text.replace(/\d[\d,.]*/g, "******");
  const hasFigures = masked !== text;

  if (!hasFigures) return <>{text}</>;

  return (
    <span className={cn("inline", className)}>
      {revealed ? text : masked}{" "}
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-pressed={revealed}
        aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        className="inline-flex translate-y-0.5 text-ink-subtle transition-colors hover:text-ink"
      >
        {revealed ? (
          <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Eye className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </span>
  );
}
