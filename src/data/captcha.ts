/**
 * A Cloudflare Turnstile token for Supabase Auth's CAPTCHA check.
 *
 * Turnstile only runs on a public hostname, and the desktop app's page is
 * `http://tauri.localhost`, so the widget lives on a page of its own (`captcha/`,
 * deployed to Cloudflare Pages - see README.md, "CAPTCHA page"). This loads
 * that page in a hidden iframe and waits for it to post a token back.
 *
 * Supabase decides whether a token is needed, not this file. A build with no
 * site key, or one that cannot reach the page, signs in without a token: that
 * works while CAPTCHA is off in Supabase and is refused once it is on. That is
 * what lets this ship before the switch is flipped, rather than with it.
 */

/**
 * Where `captcha/` is deployed.
 *
 * Also named in `frame-src` in src-tauri/tauri.conf.json, which is what lets
 * the desktop app frame it at all. Change the two together.
 */
export const CAPTCHA_PAGE_URL = "https://uptime-5jf.pages.dev/";

/**
 * How long to wait before signing in without a token.
 *
 * An invisible widget answers in a second or two. Waiting much longer only
 * delays the refusal a missing token would get anyway, and while CAPTCHA is
 * off it would delay a sign-in that needed no token at all.
 */
const TOKEN_TIMEOUT_MS = 10_000;

/** The widget's site key. Public: it rides in the page's URL. */
export function turnstileSiteKeyFromEnv(): string | null {
  const key = import.meta.env["VITE_TURNSTILE_SITE_KEY"];
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * One fresh token, or null if none could be had.
 *
 * Fetched per sign-in, immediately before the call that spends it: a token is
 * good once, for five minutes.
 */
export function captchaToken(
  siteKey: string | null = turnstileSiteKeyFromEnv(),
  pageUrl: string = CAPTCHA_PAGE_URL,
  timeoutMs: number = TOKEN_TIMEOUT_MS,
): Promise<string | null> {
  if (siteKey === null || typeof document === "undefined") return Promise.resolve(null);

  const url = new URL(pageUrl);
  url.searchParams.set("sitekey", siteKey);

  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = url.toString();
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.style.display = "none";

    let done = false;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(token);
    };

    const onMessage = (event: MessageEvent) => {
      // Only the page this framed, from where it was framed. Anything else
      // posting to this window could otherwise hand Supabase a token of its
      // choosing, or end the wait early.
      if (event.source !== frame.contentWindow || event.origin !== url.origin) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const token = (data as { captchaToken?: unknown }).captchaToken;
      if (typeof token === "string" && token.length > 0) finish(token);
      else if ("captchaError" in data) finish(null);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    document.body.append(frame);
  });
}
