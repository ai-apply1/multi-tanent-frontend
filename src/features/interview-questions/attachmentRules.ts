import type { QuestionEnvironment } from "@/features/interview-questions/types"

/**
 * THIS APP'S single source for per-ENVIRONMENT attachment rules. Mirrors the
 * backend's single source (question.schema.ts MERN_CODE_FILE_PATTERN +
 * questions-admin.service.ts ATTACHMENT_RULES), which mirrors what the
 * CANDIDATE SPA actually shows (mernApi.js CODE_FILE_RE). The backend
 * re-validates every upload; this is the friendly first line. Rules are keyed
 * by the candidate's editor ENVIRONMENT, not the free-form topic `type`:
 *  - notebook:    every file lands in the candidate's Jupyter file browser.
 *  - code-editor: only code files open as editable tabs in their editor.
 *  - canvas:      optionally seed the canvas with ONE editable starter diagram
 *                 ("optimize this design"); otherwise the canvas is blank.
 */
export const MERN_CODE_FILE_EXTENSIONS = [
  // JS/TS full-stack
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "json",
  "html",
  "css",
  // Python web (Django / Flask) + the config/text files those projects carry
  "py",
  "txt",
  "md",
  "toml",
  "cfg",
  "ini",
  "env",
  "yaml",
  "yml"
] as const

const MERN_ACCEPT = MERN_CODE_FILE_EXTENSIONS.map((e) => `.${e}`).join(",")
const MERN_LIST = MERN_CODE_FILE_EXTENSIONS.map((e) => `.${e}`).join(", ")

/** Editable Excalidraw scene the candidate opens as their system-design baseline. */
export const SYSTEM_DESIGN_STARTER_EXTENSIONS = ["excalidraw", "json"] as const
const SD_ACCEPT = SYSTEM_DESIGN_STARTER_EXTENSIONS.map((e) => `.${e}`).join(",")
const SD_LIST = SYSTEM_DESIGN_STARTER_EXTENSIONS.map((e) => `.${e}`).join(", ")

export interface AttachmentRule {
  /** `accept` attr for the file input (soft filter). */
  accept?: string
  /** Hard client-side check on the picked file's name. */
  pattern?: RegExp
  /** Whether this type takes attachments at all. */
  uploads: boolean
  /** Max attachments this type may hold (omit = unlimited). */
  maxFiles?: number
  /** Always-visible guidance under the Files section. */
  hint: string
  /** Toast when a picked file fails `pattern`. */
  blocked?: string
}

export const ATTACHMENT_RULES: Record<QuestionEnvironment, AttachmentRule> = {
  notebook: {
    uploads: true,
    hint: "All files are shown to the candidate in the Jupyter file browser. Include at least one .ipynb starter notebook — it opens automatically and grading treats it as the scaffold."
  },
  "code-editor": {
    uploads: true,
    accept: MERN_ACCEPT,
    pattern: new RegExp(`\\.(${MERN_CODE_FILE_EXTENSIONS.join("|")})$`, "i"),
    hint: `Only code files open as editable tabs in the candidate's editor: ${MERN_LIST}.`,
    blocked: `The code editor only accepts code files: ${MERN_LIST}.`
  },
  canvas: {
    uploads: true,
    accept: SD_ACCEPT,
    pattern: new RegExp(
      `\\.(${SYSTEM_DESIGN_STARTER_EXTENSIONS.join("|")})$`,
      "i"
    ),
    maxFiles: 1,
    hint: `Optional: attach ONE editable starter diagram (${SD_LIST}) to seed the candidate's canvas — use it for "optimize this existing design" tasks. Must be an Excalidraw scene, not an image. Leave empty for a blank canvas.`,
    blocked: `Canvas starters must be an editable Excalidraw scene: ${SD_LIST} (not an image).`
  }
}
