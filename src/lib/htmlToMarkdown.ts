// src/lib/htmlToMarkdown.ts
//
// Converts pasted rich text (the clipboard's `text/html` flavor) into the
// GitHub-flavored Markdown the job-description editor stores. Descriptions are
// almost always copied from a formatted source — LinkedIn/Indeed postings,
// Word, Google Docs — where a plain <textarea> paste keeps only `text/plain`
// and silently drops every heading, bold run and bullet. Turndown + the GFM
// plugin mirror the app's own react-markdown + remark-gfm renderer (headings,
// lists, tables, task lists, strikethrough), so what lands in the editor
// round-trips back to the same formatting the candidate ultimately sees.
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// Constructing the service scans the DOM adapter once; reuse a single instance.
let service: TurndownService | null = null;

function getService(): TurndownService {
  if (service) return service;

  const td = new TurndownService({
    headingStyle: "atx", // `## Heading` — the only heading style our renderer emits
    bulletListMarker: "-", // matches Markdown.tsx / hand-typed descriptions
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  td.use(gfm);

  // Google Docs and Word wrap the whole selection in a `<b style="font-weight:
  // normal">` (with nested <span> runs) that Turndown would otherwise read as
  // bold, bolding the entire paste. Unwrap any bold/strong explicitly marked
  // NOT bold so only the genuinely emphasized runs survive.
  td.addRule("stripNonBold", {
    filter: (node) =>
      (node.nodeName === "B" || node.nodeName === "STRONG") &&
      /font-weight\s*:\s*(normal|[1-4]00)\b/i.test(
        node.getAttribute("style") ?? "",
      ),
    replacement: (content) => content,
  });

  // Google Docs (and Word to a lesser extent) encode bold/italic as inline
  // styles on <span>, not <b>/<i>, so Turndown's default rules would drop them.
  // Re-emit those runs as emphasis. Turndown moves any flanking whitespace
  // outside the delimiters for us, so `a<span> bold </span>b` -> `a **bold** b`.
  td.addRule("styledSpan", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      /font-weight\s*:\s*(bold|[6-9]00)|font-style\s*:\s*italic/i.test(
        node.getAttribute("style") ?? "",
      ),
    replacement: (content, node) => {
      if (!content.trim()) return content;
      const style = (node as HTMLElement).getAttribute("style") ?? "";
      let out = content;
      if (/font-style\s*:\s*italic/i.test(style)) out = `*${out}*`;
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) out = `**${out}**`;
      return out;
    },
  });

  service = td;
  return td;
}

/**
 * Convert an HTML clipboard payload to Markdown. Returns "" on empty input or a
 * malformed payload so callers can fall back to the browser's plain-text paste
 * — a bad clipboard must never break pasting.
 */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  try {
    return getService()
      .turndown(html)
      .replace(/\n{3,}/g, "\n\n") // collapse the blank-line runs Word/Docs emit
      .trim();
  } catch {
    return "";
  }
}
