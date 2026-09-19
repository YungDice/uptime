/**
 * Which platform this bundle is running on.
 *
 * One React app ships to five places - a browser, a Tauri window on Windows,
 * and Android and iOS through the same Rust crate - and a few things genuinely
 * have to differ between them. This is the one place that decides which one we
 * are on, so those differences never turn into user-agent sniffing scattered
 * through components.
 *
 * Deliberately not `@tauri-apps/plugin-os`. That plugin answers the same
 * question, but it is a Rust plugin plus a capability entry plus an async call,
 * and every caller here needs the answer synchronously during render. The
 * webview's user agent is reported by the platform webview itself, which is
 * enough to tell WebView2 from WKWebView from Android's WebView.
 */

export type Platform = "windows" | "macos" | "linux" | "android" | "ios" | "web";

/**
 * The push service that owns this platform's device tokens.
 *
 * Matches the `platform` check constraint on `device_tokens` in
 * `supabase/migrations/0007_push.sql`. Null means there is no channel we can
 * register on - a plain browser build, or a desktop Linux/macOS build, neither
 * of which the nudge function knows how to reach.
 */
export type PushPlatform = "apns" | "fcm" | "wns";

/** True inside any Tauri shell - desktop or mobile - false in a plain browser. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;

  // Android first: its user agent also contains "Linux", so testing for Linux
  // before Android would classify every phone as a desktop.
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPod/i.test(ua)) return "ios";

  // An iPad running iPadOS 13+ reports itself as a Macintosh, deliberately, so
  // that sites serve it the desktop layout. The touch points are what give it
  // away - no Mac reports more than zero.
  if (/iPad/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua)) {
    return navigator.maxTouchPoints > 1 ? "ios" : "macos";
  }

  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "web";
}

/** Phone and tablet shells, where the layout is the whole viewport. */
export function isMobile(): boolean {
  const platform = currentPlatform();
  return platform === "android" || platform === "ios";
}

/**
 * Where this device's push token should be registered, if anywhere.
 *
 * Only meaningful inside a native shell: a browser has no FCM or APNs token to
 * offer, and web push is a different channel with a different credential that
 * `device_tokens` has no room for.
 *
 * Note that nothing calls `registerDevice` yet, because this answers only half
 * the question - see the note on the push gap in `context.md`. The token has to
 * come from a push plugin that is not yet a dependency;
 * `@tauri-apps/plugin-notification` is local notifications only.
 */
export function pushPlatform(): PushPlatform | null {
  if (!isTauri()) return null;
  switch (currentPlatform()) {
    case "android":
      return "fcm";
    case "ios":
      return "apns";
    case "windows":
      return "wns";
    default:
      return null;
  }
}
