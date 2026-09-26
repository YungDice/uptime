import { isTauri } from "@/platform";
import { inviteCodeIn } from "./link";

/**
 * Hand every invite code that reaches the app to `onCode`.
 *
 * Two ways in: the link the app was launched with, and links opened while it
 * is already running - which single-instance forwards here rather than
 * letting a second copy start. Returns a function that stops listening.
 *
 * Loaded lazily and entirely optional: a plain browser has no deep links, and
 * a phone build without the plugin configured should lose invites by link,
 * not the whole app. Pasting a link into People reaches the same place.
 */
export async function listenForInvites(onCode: (code: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
    const take = (urls: string[] | null) => {
      for (const url of urls ?? []) {
        const code = inviteCodeIn(url);
        if (code) onCode(code);
      }
    };
    take(await getCurrent());
    return await onOpenUrl(take);
  } catch {
    return () => {};
  }
}
