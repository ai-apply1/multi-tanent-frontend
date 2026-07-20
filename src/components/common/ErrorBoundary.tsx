import { Component, type ErrorInfo, type ReactNode } from "react"

interface ErrorBoundaryProps {
  children: ReactNode
  /** Rendered in place of the children after a descendant throws. Gets a
   *  `reset` callback so the fallback can offer a "Try again". */
  fallback: (reset: () => void) => ReactNode
  /** When any entry here changes, a caught error is cleared and the children
   *  re-mount. Pass a dialog's `open` flag so reopening always gives a fresh,
   *  working subtree instead of a stuck error state. */
  resetKeys?: ReadonlyArray<unknown>
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Minimal error boundary. The app otherwise ships none, so a single uncaught
 * render error anywhere tears down the whole React tree (a blank screen, or
 * the dev overlay) — which is the "application error" a crash in a dialog
 * shows up as. Wrap a risky subtree with this and a crash there degrades to a
 * recoverable inline message rather than taking the page down with it.
 *
 * Class component because `getDerivedStateFromError` / `componentDidCatch`
 * have no hook equivalent — this is the one place React still requires one.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console for debugging — the fallback deliberately
    // shows the user a calm message, not the raw error.
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    // Clear a caught error once a reset key changes, so the fallback doesn't
    // linger after the condition that caused the crash is gone.
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback(this.reset)
    return this.props.children
  }
}

function sameKeys(a?: ReadonlyArray<unknown>, b?: ReadonlyArray<unknown>) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((v, i) => Object.is(v, b[i]))
}
