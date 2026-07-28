import MDEditor from "@uiw/react-md-editor";
import { Markdown } from "@/components/Markdown";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";
import { useTheme } from "@/features/theme/ThemeContext";

interface MarkdownEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional field label rendered above the editor. */
  label?: string;
  /** Backend caps the plain-text description at 5000 chars (422s beyond). */
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Controlled Markdown editor for the job description, backed by
 * @uiw/react-md-editor. It OUTPUTS MARKDOWN TEXT, never HTML: the description
 * is rendered downstream (dashboard + public apply page) by react-markdown
 * WITHOUT rehype-raw, so any injected HTML would show as literal angle
 * brackets. The preview pane therefore bypasses the library's own renderer
 * (which allows raw HTML) and reuses the very same `Markdown` component the
 * candidate ultimately sees.
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
  const { theme } = useTheme();

  // A <textarea> only receives the clipboard's plain-text flavor, so pasting a
  // formatted description (LinkedIn/Word/Google Docs — all `text/html`) drops
  // every heading, bold run and bullet. When the clipboard carries HTML,
  // convert it to Markdown and insert that instead of the flattened text.
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const markdown = htmlToMarkdown(event.clipboardData.getData("text/html"));
    // Nothing rich to convert (or a malformed payload) → let the browser paste
    // plain text as usual.
    if (!markdown) return;

    event.preventDefault();
    const textarea = event.currentTarget;

    // `insertText` keeps the native undo stack and caret intact and honours the
    // textarea's maxLength; fall back to a manual splice on the rare browser
    // that rejects it. Either path fires MDEditor's onChange, which re-clamps
    // to maxLength.
    if (!document.execCommand("insertText", false, markdown)) {
      const start = textarea.selectionStart ?? value.length;
      const end = textarea.selectionEnd ?? value.length;
      onChange(
        (value.slice(0, start) + markdown + value.slice(end)).slice(0, maxLength),
      );
    }
  };

  return (
    // `md-editor-themed` scopes the globals.css bridge that remaps the
    // library's GitHub palette onto the app's theme tokens.
    <div className="md-editor-themed">
      {label ? (
        <label
          htmlFor={id}
          className="mb-2 block text-[13px] font-semibold text-ink"
        >
          {label}
        </label>
      ) : null}
      <MDEditor
        value={value}
        // Native maxLength only guards typing/pasting; toolbar commands write
        // programmatically, so clamp here to keep the backend cap intact.
        onChange={(next) => onChange((next ?? "").slice(0, maxLength))}
        preview="edit"
        height={120 + rows * 30}
        data-color-mode={theme}
        textareaProps={{ id, placeholder, maxLength, disabled, onPaste: handlePaste }}
        components={{
          preview: (source) =>
            source.trim().length > 0 ? (
              <Markdown content={source} />
            ) : (
              <p className="text-[14px] text-ink-subtle">
                Nothing to preview yet. Switch back to edit and add a
                description.
              </p>
            ),
        }}
      />
      <p className="mt-1.5 text-[12px] text-ink-muted">
        Max {maxLength} characters. {value.length}/{maxLength}
      </p>
    </div>
  );
}
