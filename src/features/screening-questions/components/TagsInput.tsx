import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TAG_MAX_LENGTH } from "@/features/screening-questions/types";

interface TagsInputProps {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Merged onto the inner chip container (where the border/height live), so a
   * caller can shrink it to line up with a sibling control — e.g. the Question
   * bank filter row matches the search input's `h-[37px]`. Left off, the
   * comfortable 44px form-field height stands.
   */
  containerClassName?: string;
  /**
   * Keep the chips on ONE row that scrolls sideways instead of wrapping onto
   * new lines. Use this where the field lives inline next to other fixed-height
   * controls — e.g. the Question bank filter row, where a wrapping field would
   * grow taller than the search box and selects beside it and break the row's
   * alignment. Left off, chips wrap freely (the roomy form-dialog default).
   */
  singleLine?: boolean;
  "aria-invalid"?: boolean;
}

/**
 * Chip input for free-form tags: type + Enter to add, Backspace on an empty
 * draft removes the last chip.
 *
 * Not built on `Combobox` — that primitive is single-value and reports every
 * keystroke through the same `onValueChange` as a committed pick, so it can't
 * express "this text is a draft until you commit it".
 */
export function TagsInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  containerClassName,
  singleLine,
  "aria-invalid": ariaInvalid,
}: TagsInputProps) {
  const [draft, setDraft] = React.useState("");

  const has = (tag: string) =>
    value.some((v) => v.toLowerCase() === tag.toLowerCase());

  const add = (raw: string) => {
    const tag = raw.trim();
    setDraft("");
    // Dedupe case-insensitively: two spellings of one tag is never what the
    // operator meant, and the chip list uses the tag as its React key.
    if (!tag || has(tag)) return;
    onChange([...value, tag]);
  };

  const removeAt = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Always swallow Enter: inside the form dialog it would otherwise
      // submit the whole form instead of committing the tag.
      e.preventDefault();
      add(draft);
      return;
    }
    if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      e.preventDefault();
      removeAt(value.length - 1);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex gap-1.5 items-center min-h-[44px] rounded-lg border border-[var(--field-border)] bg-surface px-2 py-1.5 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--accent-ring)] transition-colors",
          // One scrolling row vs. free-wrapping. The scrollbar is hidden (scroll
          // via trackpad / shift-wheel, or just the input auto-scrolling into
          // view) so the field never grows past its neighbours' height.
          singleLine
            ? "flex-nowrap overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            : "flex-wrap",
          disabled && "cursor-not-allowed opacity-50",
          ariaInvalid && "border-[var(--danger)]",
          containerClassName,
        )}
      >
        {value.map((tag, idx) => (
          <span
            key={tag}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-accent text-primary text-[10px] font-semibold pl-2.5 pr-1 py-0.5 max-w-full",
              // Hold width in a scrolling row so chips overflow (and scroll)
              // rather than squashing to fit.
              singleLine && "shrink-0",
            )}
          >
            <span className="truncate" title={tag}>
              {tag}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeAt(idx)}
              aria-label={`Remove tag ${tag}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-primary hover:bg-primary/10 disabled:cursor-not-allowed"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={disabled}
          maxLength={TAG_MAX_LENGTH}
          placeholder={value.length === 0 ? placeholder : undefined}
          autoComplete="off"
          aria-invalid={ariaInvalid}
          className="flex-1 min-w-[120px] border-0 outline-0 bg-transparent text-[12px] text-ink placeholder:text-ink-subtle disabled:cursor-not-allowed"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // Commit what's typed on the way out, or a tag typed but never
            // Entered is silently dropped when the user clicks Save.
            add(draft);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
