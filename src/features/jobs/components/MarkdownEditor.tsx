import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  type LucideIcon,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";

interface MarkdownEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional field label rendered inline with the Write/Preview toggle. */
  label?: string;
  /** Backend caps the plain-text description at 5000 chars (422s beyond). */
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Controlled Markdown editor for the job description. It OUTPUTS MARKDOWN TEXT,
 * never HTML: the description is rendered downstream (dashboard + public apply
 * page) by react-markdown WITHOUT rehype-raw, so any injected HTML would show
 * as literal angle brackets. The toolbar therefore only ever inserts markdown
 * syntax, and the live preview reuses the very same `Markdown` renderer the
 * candidate ultimately sees. No internal value state — every keystroke and
 * toolbar action flows through `onChange`, keeping the parent the single source
 * of truth (needed because a controlled re-render otherwise resets the caret,
 * which the post-commit effect below restores).
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  label,
  maxLength = 5000,
  rows = 6,
  placeholder,
  disabled,
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Selection to restore AFTER the controlled re-render. Set by a toolbar
  // action right before `onChange`, then consumed by the effect below once the
  // new `value` has flushed. Left null on ordinary typing, so the effect no-ops.
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  // React Compiler is on, so the caret is restored in an effect (never a
  // synchronous DOM write after `onChange`) once the new value has painted.
  useEffect(() => {
    const sel = pendingSelection.current;
    if (!sel) return;
    pendingSelection.current = null;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(sel.start, sel.end);
  }, [value]);

  const hasDescription = value.trim().length > 0;

  /** Wrap the selection (or drop the caret between the markers when empty). */
  const applyWrap = (prefix: string, suffix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    if (next.length > maxLength) return;
    const innerStart = start + prefix.length;
    pendingSelection.current = {
      start: innerStart,
      end: innerStart + selected.length,
    };
    onChange(next);
  };

  /** Prefix every line touched by the selection (headings, lists, quote). */
  const applyLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const newBlock = block
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    const next = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    if (next.length > maxLength) return;
    pendingSelection.current = {
      start: lineStart,
      end: lineStart + newBlock.length,
    };
    onChange(next);
  };

  /** Insert `[selection](url)` and land the caret on the `url` placeholder. */
  const applyLink = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const selected = value.slice(start, end);
    const placeholderUrl = "url";
    const inserted = `[${selected}](${placeholderUrl})`;
    const next = value.slice(0, start) + inserted + value.slice(end);
    if (next.length > maxLength) return;
    const urlStart = start + selected.length + 3; // past "[selection]("
    pendingSelection.current = {
      start: urlStart,
      end: urlStart + placeholderUrl.length,
    };
    onChange(next);
  };

  const tools: Array<{ icon: LucideIcon; title: string; run: () => void }> = [
    { icon: Bold, title: "Bold", run: () => applyWrap("**", "**") },
    { icon: Italic, title: "Italic", run: () => applyWrap("*", "*") },
    { icon: Heading1, title: "Heading 1", run: () => applyLinePrefix("# ") },
    { icon: Heading2, title: "Heading 2", run: () => applyLinePrefix("## ") },
    { icon: List, title: "Bulleted list", run: () => applyLinePrefix("- ") },
    {
      icon: ListOrdered,
      title: "Numbered list",
      run: () => applyLinePrefix("1. "),
    },
    { icon: LinkIcon, title: "Link", run: applyLink },
    { icon: Quote, title: "Quote", run: () => applyLinePrefix("> ") },
    { icon: Code, title: "Inline code", run: () => applyWrap("`", "`") },
  ];

  return (
    <div>
      {/* Header row — the field label sits inline with the Write / Preview
          toggle, both vertically centered. Preview reuses the same
          react-markdown pipeline (`Markdown`) the candidate ultimately sees. */}
      <div
        className={`mb-2 flex items-center ${
          label ? "justify-between" : "justify-end"
        }`}
      >
        {label ? (
          <label htmlFor={id} className="text-[13px] font-semibold text-ink">
            {label}
          </label>
        ) : null}
        <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--field-border)] bg-surface-2 p-1 text-[12px] font-medium">
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            aria-pressed={!showPreview}
            className={`rounded-md px-3 py-1 transition-all ${
              !showPreview
                ? "bg-primary text-white shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            aria-pressed={showPreview}
            className={`rounded-md px-3 py-1 transition-all ${
              showPreview
                ? "bg-primary text-white shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {showPreview ? (
        <div className="min-h-[168px] w-full rounded-lg border border-[var(--field-border)] bg-surface p-3.5 text-[14px] text-ink">
          {hasDescription ? (
            <Markdown content={value} />
          ) : (
            <p className="text-[14px] text-ink-subtle">
              Nothing to preview yet. Switch to Write and add a description.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Formatting toolbar — every button is type="button" so it never
              submits the wizard form. */}
          <div className="mb-1.5 flex flex-wrap items-center gap-0.5 rounded-md border border-[var(--field-border)] bg-surface p-1">
            {tools.map(({ icon: Icon, title, run }) => (
              <button
                key={title}
                type="button"
                title={title}
                aria-label={title}
                disabled={disabled}
                onClick={run}
                className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              </button>
            ))}
          </div>
          <textarea
            id={id}
            ref={textareaRef}
            value={value}
            maxLength={maxLength}
            rows={rows}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full resize-y rounded-lg border border-[var(--field-border)] bg-surface p-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
          />
        </>
      )}

      <p className="mt-1.5 text-[12px] text-ink-muted">
        Markdown supported. Max {maxLength} characters. {value.length}/
        {maxLength}
      </p>
    </div>
  );
}
