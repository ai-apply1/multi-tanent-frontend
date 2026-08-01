import { useCallback, useEffect, useLayoutEffect, useState } from "react"

export type OverlayPhase = "enter" | "exit" | "idle"

const DEFAULT_DURATION_MS = 180

/**
 * Keeps a hand-rolled overlay (one NOT built on Radix — the ⌘K palette, the
 * mobile nav drawer) mounted long enough to play a close animation.
 *
 * Radix's Dialog/Sheet do this for free via their Presence machinery; these
 * two overlays render themselves with `{open && …}` and would otherwise vanish
 * the instant `open` flips false, cutting off any exit animation. This mirrors
 * that Presence behaviour: on close we swap to the `exit` phase, hold the node
 * for `durationMs`, then unmount.
 *
 * Returns `mounted` (render the tree while true) and `phase` (pick the
 * enter/exit animation class). `useLayoutEffect` sets the enter phase before
 * paint so the element never flashes in its final position first.
 */
export function useAnimatedOverlay(open: boolean, durationMs = DEFAULT_DURATION_MS) {
  const [mounted, setMounted] = useState(open)
  const [phase, setPhase] = useState<OverlayPhase>(open ? "enter" : "idle")

  useLayoutEffect(() => {
    if (open) {
      setMounted(true)
      setPhase("enter")
    }
  }, [open])

  useEffect(() => {
    if (open || !mounted) return

    setPhase("exit")
    const timeout = window.setTimeout(() => {
      setMounted(false)
      setPhase("idle")
    }, durationMs)

    return () => window.clearTimeout(timeout)
  }, [open, mounted, durationMs])

  return { mounted, phase }
}

/**
 * For a Radix Dialog/Sheet whose PARENT mounts it on open and tears it down on
 * close — `{isOpen && <Modal/>}`, a `key`-per-row remount, or a hardcoded
 * `open` — so the child never lives to see `data-state="closed"`. Radix only
 * plays a CLOSE animation while the node is still mounted; an instant unmount
 * skips it (this is the "opens but doesn't close" case).
 *
 * This owns the boolean Radix reads (starts open on mount) and, on dismissal,
 * flips it to `false` so the exit animation runs, THEN — a beat later — calls
 * the parent's close handler so it can unmount. Feed `open` to the primitive
 * and call `close()` from every dismissal path (backdrop, ✕, cancel, and any
 * post-submit `onSuccess`). `durationMs` should be ≥ the exit animation.
 */
export function useDeferredClose(
  notifyClosed: () => void,
  { initialOpen = true, durationMs = 220 }: { initialOpen?: boolean; durationMs?: number } = {},
) {
  const [open, setOpen] = useState(initialOpen)

  const close = useCallback(() => {
    setOpen(false)
    window.setTimeout(notifyClosed, durationMs)
  }, [notifyClosed, durationMs])

  return { open, close }
}
