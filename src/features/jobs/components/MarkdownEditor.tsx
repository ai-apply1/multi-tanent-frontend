import MDEditor from "@uiw/react-md-editor";
import { Markdown } from "@/components/Markdown";
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
        textareaProps={{ id, placeholder, maxLength, disabled }}
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
