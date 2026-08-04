/**
 * Injected into a preview document so the mail is LOOKED at, not used.
 *
 * A preview is the real server-rendered email, so its call-to-action is a real
 * `<a href>` pointing at a SAMPLE URL. Clicking it navigated the iframe itself
 * — `sandbox=""` blocks TOP-level navigation, but it does not stop a frame
 * navigating itself — and the preview was replaced by the browser's
 * "screening.your-domain.com refused to connect" page until the next keystroke
 * re-rendered it. Nothing in a preview should be actionable anyway: the link
 * shown is a placeholder, and the real one is minted per recipient at send time.
 *
 * Two guards, because they cover different activation paths:
 * - `pointer-events: none` kills the click, and with it the pointer cursor and
 *   the status-bar URL, so the button reads as part of a picture.
 * - `<base target="_top">` catches what a pointer rule cannot: tabbing into the
 *   frame and pressing Enter. The iframe's `sandbox=""` grants no
 *   `allow-top-navigation`, so the browser refuses that navigation outright.
 *   The `<base>` carries NO `href`, so it changes link targeting only and
 *   leaves every URL in the document resolving exactly as before.
 *
 * This lives in the client, deliberately: the shell the server renders is the
 * mail that actually gets sent, and its links must of course still work.
 */
const PREVIEW_INERT_HEAD =
  '<base target="_top" /><style>a{pointer-events:none !important;}</style>'

/**
 * Apply {@link PREVIEW_INERT_HEAD} to a server-rendered email document.
 *
 * Every `srcDoc` that shows a `previewEmailTemplate` response goes through this
 * — the compose dialog on Candidates and the template editor in Settings both
 * render the same shell, so a guard on only one of them is a guard on neither.
 */
export function makePreviewInert(html: string) {
  const headClose = html.search(/<\/head>/i)
  if (headClose !== -1) {
    return html.slice(0, headClose) + PREVIEW_INERT_HEAD + html.slice(headClose)
  }
  // No `</head>` — append rather than prepend. A `<style>`/`<base>` in the body
  // still applies (the spec picks the first `<base target>` in tree order, and
  // CSS does not care where it was parsed), whereas prepending would push the
  // `<!doctype>` off the front and drop the whole preview into quirks mode.
  return html + PREVIEW_INERT_HEAD
}
