import { useEffect, useRef } from "react";

/**
 * Makes Android's hardware back button dismiss one layer of the interface
 * instead of quitting the app.
 *
 * Tauri does not expose a back-button event, and it does not need to: wry's
 * `WryActivity` installs an `OnBackPressedCallback` that calls
 * `webView.goBack()` whenever `canGoBack()` is true, and only finishes the
 * activity when it is not. So the back button is already wired to webview
 * history - the frontend's job is to make sure there is history to go back
 * through. One pushed entry per open layer, and back unwinds them in order
 * before it is allowed to close the app.
 *
 * That also makes the browser's back button behave, which is why this is not
 * gated on the platform. On desktop it is inert: a Tauri window has no back
 * affordance, so the entries are pushed and never traversed.
 *
 * @param depth  How many dismissible layers are open right now. Zero means the
 *               app is at rest and back should exit.
 * @param onBack Dismiss the topmost layer. Called once per press.
 */
export function useBackStack(depth: number, onBack: () => void): void {
  // Entries we have pushed ourselves. Never read from history.length, which
  // counts the whole session including wherever the user came from.
  const pushed = useRef(0);
  // history.back() is asynchronous and fires the same popstate a real press
  // does. This counts the ones we caused, so they are not mistaken for input.
  const swallow = useRef(0);
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    const onPopState = () => {
      if (swallow.current > 0) {
        swallow.current -= 1;
        return;
      }
      // A real press. The entry is already gone, so account for it before
      // dismissing - the state change that follows will re-run the effect
      // below, which then finds the counts already agreeing and does nothing.
      if (pushed.current > 0) {
        pushed.current -= 1;
        handler.current();
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // Reconcile the number of entries we hold against the number of layers
    // open. Both directions matter: a layer closed by tapping Cancel has to
    // give its entry back, or the next press would be swallowed dismissing
    // something that is no longer on screen.
    while (pushed.current < depth) {
      pushed.current += 1;
      history.pushState({ uptimeDepth: pushed.current }, "");
    }
    while (pushed.current > depth) {
      pushed.current -= 1;
      swallow.current += 1;
      history.back();
    }
  }, [depth]);
}
