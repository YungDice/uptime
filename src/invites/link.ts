/**
 * Where an invite link points, and how to read one back.
 *
 * Two shapes of the same thing. The page link is what gets sent - it opens in
 * any browser, offers the download to someone who has not installed Uptime,
 * and hands everyone else to the app. The app link is what that page opens,
 * and what the desktop build registers itself for.
 */

/**
 * The invite page, deployed with the rest of `site/`.
 *
 * Same host as `CAPTCHA_PAGE_URL` in src/data/captcha.ts. Move the two
 * together, and add the new host to Supabase's allowed redirect URLs.
 */
export const INVITE_PAGE_URL = "https://uptime-5jf.pages.dev/add/";

/** The scheme the desktop build answers to. `plugins.deep-link` in tauri.conf.json. */
const APP_SCHEME = "uptime:";

/**
 * The link to send.
 *
 * The nickname only lets the page say whose invite it is before the app is
 * even installed. It proves nothing - the code does - and the app shows the
 * code's real owner before anyone accepts, so a doctored `n` changes a caption.
 */
export function inviteLink(code: string, handle: string): string {
  const url = new URL(INVITE_PAGE_URL);
  url.searchParams.set("c", code);
  url.searchParams.set("n", handle);
  return url.toString();
}

/** The link that opens the app on this invite. */
export function appLink(code: string): string {
  return `${APP_SCHEME}//add/${code}`;
}

/**
 * The invite code in some text, or null.
 *
 * Only ever from a link, never from a bare code. The follow field takes
 * nicknames, and twelve hex digits is a perfectly good nickname - reading one
 * as an invite would follow the wrong person, or no one.
 */
export function inviteCodeIn(text: string): string | null {
  const page = new URL(INVITE_PAGE_URL);
  for (const word of text.trim().split(/\s+/)) {
    let url: URL;
    try {
      url = new URL(word);
    } catch {
      continue;
    }

    let code: string | null = null;
    if (url.protocol === APP_SCHEME) {
      // uptime://add/CODE parses as host "add", path "/CODE".
      code = url.host === "add" ? url.pathname.replace(/^\/|\/$/g, "") : null;
    } else if (url.host === page.host && url.pathname.replace(/\/$/, "") === page.pathname.replace(/\/$/, "")) {
      code = url.searchParams.get("c");
    }

    const clean = code?.trim().toLowerCase() ?? "";
    if (/^[0-9a-z]{8,32}$/.test(clean)) return clean;
  }
  return null;
}
