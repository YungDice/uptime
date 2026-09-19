import { CHECK_IN_NUDGE_LEAD, type Seconds } from "@/core";
import { isTauri } from "@/platform";

/**
 * The client half of the check-in prompt.
 *
 * Two things live here, and it matters which is which:
 *
 *   - The *push* is the primary mechanism, and it is server-side
 *     (supabase/functions/nudge-check-in). It survives a reinstall, a new
 *     device and a year of the app never being opened.
 *   - The *local* notification below is a fallback only. It cannot survive a
 *     reinstall, which is exactly the case the whole window exists for, so it
 *     is never the thing being relied on.
 *
 * Neither can extend a streak. The window is measured server-side from
 * last_seen, so a user who denies notifications keeps their streak for exactly
 * as long as one who allows them - the prompt only saves them the surprise.
 */

export type PermissionState = "granted" | "denied" | "unsupported";

interface NotificationPlugin {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<"granted" | "denied" | "default">;
  sendNotification(options: { title: string; body: string }): void;
}

/** Loaded lazily so a plain browser build never pulls in the native plugin. */
async function plugin(): Promise<NotificationPlugin | null> {
  if (!isTauri()) return null;
  try {
    return (await import("@tauri-apps/plugin-notification")) as unknown as NotificationPlugin;
  } catch {
    return null;
  }
}

// Re-exported so callers that already reason about notifications do not need
// to know that the platform check lives elsewhere.
export { isTauri };

export async function permissionState(): Promise<PermissionState> {
  const api = await plugin();
  if (api) return (await api.isPermissionGranted()) ? "granted" : "denied";

  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission === "granted" ? "granted" : "denied";
}

/**
 * Ask once, at a moment the user will understand why.
 *
 * Deliberately not called on first launch: a permission prompt before the user
 * has a streak worth protecting is the kind that gets denied permanently.
 */
export async function requestPermission(): Promise<PermissionState> {
  const api = await plugin();
  if (api) return (await api.requestPermission()) === "granted" ? "granted" : "denied";

  if (typeof Notification === "undefined") return "unsupported";
  return (await Notification.requestPermission()) === "granted" ? "granted" : "denied";
}

/**
 * Register this device for the server-side push.
 *
 * The token comes from the platform, so this is a no-op on the web build and
 * on desktop until a WNS channel exists.
 */
export async function registerDevice(
  register: (platform: "apns" | "fcm" | "wns", token: string) => Promise<unknown>,
  platform: "apns" | "fcm" | "wns" | null,
  token: string | null,
): Promise<boolean> {
  if (!platform || !token) return false;
  try {
    await register(platform, token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether it is worth offering to turn notifications on.
 *
 * Only inside the lead, and only for a streak long enough that losing it would
 * actually sting - asking someone on day two to protect day two is noise.
 */
export function shouldOfferReminder(
  elapsed: Seconds,
  windowRemaining: Seconds,
  permission: PermissionState,
): boolean {
  if (permission !== "denied") return false;
  if (elapsed < 7 * 86400) return false;
  return windowRemaining <= CHECK_IN_NUDGE_LEAD;
}

/** The fallback nudge, shown on app open when the window is nearly out. */
export async function showLocalReminder(daysLeft: number): Promise<void> {
  const body =
    daysLeft <= 1
      ? "Your streak ends tomorrow unless you check in."
      : `Your check-in window closes in ${daysLeft} days.`;

  const api = await plugin();
  if (api) {
    api.sendNotification({ title: "Still there?", body });
    return;
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("Still there?", { body });
  }
}
