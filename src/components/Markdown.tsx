// src/components/Markdown.tsx
//
// Static-string markdown renderer for admin-authored copy (currently the
// interview-question description). Mirrors the candidate SPA's SdMarkdown so the
// admin's live preview matches what the candidate ultimately sees — same
// remark-gfm pipeline (tables, lists, task lists), styled with the admin's
// shadcn theme tokens.
import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

const components: Components = {
  p:      ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1:     ({ children }) => <h1 className="text-foreground font-semibold text-base mt-3 mb-1.5 first:mt-0">{children}</h1>,
  h2:     ({ children }) => <h2 className="text-foreground font-semibold text-sm mt-3 mb-1.5 first:mt-0">{children}</h2>,
  h3:     ({ children }) => <h3 className="text-foreground font-semibold text-sm mt-2 mb-1 first:mt-0">{children}</h3>,
  ul:     ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-1">{children}</ul>,
  ol:     ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-1">{children}</ol>,
  li:     ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
  em:     ({ children }) => <em className="italic">{children}</em>,
  hr:     () => <hr className="my-3 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer"
       className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),

  // GFM tables
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="text-foreground">{children}</thead>,
  th:    ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td:    ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),

  pre: ({ children }) => (
    <pre className="bg-muted border border-border rounded-md p-3 overflow-x-auto my-2 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className)
    if (isBlock) {
      return <code className={cn(className, "font-mono text-xs")}>{children}</code>
    }
    return (
      <code className="bg-muted px-1.5 py-px rounded font-mono text-[0.8em]">{children}</code>
    )
  },
}

type Props = { content: string; className?: string }

function MarkdownImpl({ content, className }: Props) {
  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
export default Markdown
