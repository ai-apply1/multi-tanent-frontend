import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  fetchCandidateCvBlobUrl,
  getCandidate,
} from "@/features/candidates/candidatesApi";
import { errorMessage } from "@/lib/errors";

/**
 * Standalone, full-screen CV viewer opened in a new tab by "Open CV".
 *
 * Why a page instead of pointing the tab straight at the PDF: it gives a CLEAN
 * address bar (`/cv-view/<id>`) instead of a `blob:` URL, while still keeping a
 * download manager (IDM) out. The chain:
 *
 *   - This route is an HTML page → IDM ignores it, so the top-level navigation
 *     is never grabbed.
 *   - It fetches the CV bytes, which the backend serves as `text/plain` (IDM
 *     ignores that too, even for a background fetch) with the real type in a
 *     header, and renders them from an in-memory blob in an <iframe>.
 *
 * So no PDF download ever crosses the wire for IDM to hook, yet the reviewer
 * sees a normal URL and an inline PDF. See `fetchCandidateCvBlobUrl` and the
 * backend `CvViewController`.
 *
 * Auth is the session cookie the new tab already carries; the CV itself is
 * org-scoped by the signed token the fetch mints, so a reviewer only ever
 * reaches their own org's CVs.
 */
export function CvViewerPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tab title: the candidate's name, so several open CVs are told apart (they
  // all read "CV" otherwise). Stays "CV" until it resolves, or if it fails.
  useEffect(() => {
    document.title = "CV";
    if (!candidateId) return;
    let cancelled = false;
    getCandidate(candidateId)
      .then((c) => {
        if (!cancelled && c?.fullName) document.title = c.fullName;
      })
      .catch(() => {
        /* keep the generic title */
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  useEffect(() => {
    if (!candidateId) {
      setError("No candidate specified.");
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    fetchCandidateCvBlobUrl(candidateId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setBlobUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load the CV."));
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [candidateId]);

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface px-6 text-center text-sm text-[color:var(--danger)]">
        {error}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex h-screen w-full items-center justify-center gap-2 bg-surface text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading CV…
      </div>
    );
  }

  return <iframe title="CV" src={blobUrl} className="h-screen w-full border-0" />;
}
