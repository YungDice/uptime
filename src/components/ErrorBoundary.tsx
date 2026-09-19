import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Stops a render error from taking the whole app with it.
 *
 * Without one of these, React 18 unmounts the entire tree when a render
 * throws. On a true-black interface that does not look like a crash - it looks
 * like the window went blank, with no message, no way back, and nothing to
 * report. Restarting the app is the only recovery, which is exactly the
 * failure this class exists to prevent.
 *
 * The streak itself is never at risk here: every number is derived server-side
 * from two timestamps, so a UI that died and came back reads precisely what it
 * read before. Saying so is most of the job - a blank screen in an app whose
 * whole subject is a clock you must not lose is alarming out of all proportion
 * to what actually went wrong.
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept for the devtools console: the on-screen copy is deliberately short,
    // but whoever is debugging still wants the component stack.
    console.error("Uptime crashed while rendering:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center bg-page px-8 text-center">
        <p className="text-body font-semibold text-label">Something went wrong on screen</p>
        <p className="mt-2 max-w-xs text-callout text-label-2">
          Your streak is safe - it lives on the server and is worked out from timestamps, so
          nothing here can shorten it.
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-full px-6 py-3 text-body font-medium"
          style={{
            color: "var(--color-run)",
            background: "color-mix(in srgb, var(--color-run) 18%, transparent)",
          }}
        >
          Reload
        </button>

        <p className="mt-8 max-w-xs font-mono text-micro break-words text-label-3">
          {error.message}
        </p>
      </div>
    );
  }
}
