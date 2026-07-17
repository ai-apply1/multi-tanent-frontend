import JSZip from "jszip"
import {
  ALLOWED_CV_CONTENT_TYPES,
  type AllowedCvContentType,
} from "@/features/candidates/types"

/**
 * Reading a ZIP of CVs, in the BROWSER.
 *
 * Deliberately not a server-side unzip: the API never buffers CV bytes (they
 * go browser → S3 directly via presigned PUTs), and keeping that true means
 * there is no endpoint that accepts an archive, so no zip-bomb surface, no
 * temp files, and no new upload path. Unzipping here turns "a ZIP" back into
 * "some files", which the existing presign → PUT → confirm flow already
 * handles without knowing a ZIP was ever involved.
 */

const CONTENT_TYPE_BY_EXTENSION: Record<string, AllowedCvContentType> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

/**
 * Total uncompressed bytes we'll expand from one archive. A ZIP is a
 * compressed format an untrusted-ish file could exploit — a few KB can
 * expand to gigabytes and hang the tab. 50 real CVs are ~50-100MB, so this
 * is generous for anything legitimate.
 */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 300 * 1024 * 1024

/** Hard stop on entries examined, so a 100k-entry archive can't wedge the loop. */
const MAX_ENTRIES = 2000

export interface UnzippedCvs {
  files: File[]
  /** Entries that weren't a PDF/DOC/DOCX — reported, never silently dropped. */
  skipped: number
  /** True when the archive blew the size/entry cap and we stopped early. */
  truncated: boolean
}

/**
 * macOS `Compress` writes a parallel `__MACOSX/` tree of `._name.pdf`
 * AppleDouble resource forks. They carry the right extension and would
 * otherwise import as a pile of unreadable 4KB "CVs".
 */
const isJunkEntry = (path: string): boolean => {
  const base = path.split("/").pop() ?? ""
  return (
    path.startsWith("__MACOSX/") ||
    path.includes("/__MACOSX/") ||
    base.startsWith("._") ||
    base === ".DS_Store" ||
    base === "Thumbs.db"
  )
}

const contentTypeForName = (name: string): AllowedCvContentType | null => {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const type = CONTENT_TYPE_BY_EXTENSION[ext]
  return type && (ALLOWED_CV_CONTENT_TYPES as readonly string[]).includes(type)
    ? type
    : null
}

export const isZipFile = (file: File): boolean =>
  file.name.toLowerCase().endsWith(".zip") ||
  file.type === "application/zip" ||
  file.type === "application/x-zip-compressed"

/**
 * Expand a ZIP into CV `File`s, flattening any folder structure (HR zips a
 * folder of folders as often as not — the tree carries no meaning here).
 *
 * Throws only when the archive itself won't open. An archive that opens but
 * holds nothing usable returns `files: []`, which the caller reports — that
 * is a real answer, not an error.
 */
export async function extractCvsFromZip(zipFile: File): Promise<UnzippedCvs> {
  const zip = await JSZip.loadAsync(zipFile)

  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isJunkEntry(entry.name)
  )

  const files: File[] = []
  let skipped = 0
  let truncated = false
  let totalBytes = 0

  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    const baseName = entry.name.split("/").pop() ?? entry.name
    const contentType = contentTypeForName(baseName)
    if (!contentType) {
      skipped += 1
      continue
    }

    const blob = await entry.async("blob")
    totalBytes += blob.size
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      truncated = true
      break
    }
    files.push(new File([blob], baseName, { type: contentType }))
  }

  if (entries.length > MAX_ENTRIES) truncated = true

  return { files, skipped, truncated }
}
