import { isMobile, isTauri } from "@/platform";

/**
 * Where the whole-clock upgrade can be bought.
 *
 * Everywhere but the phone apps. Apple and Google both require their own
 * billing for a digital upgrade sold inside an app, and a Stripe link in a
 * store build is a rejection waiting to happen - so the Android and iOS builds
 * do not sell it. A phone's own web browser is not a store build and does.
 * The upgrade belongs to the account rather than the device, so one bought on
 * the desktop or the web still applies in the phone apps.
 */
export function canBuyHere(): boolean {
  return !(isTauri() && isMobile());
}

/**
 * Open the Stripe Checkout page.
 *
 * In the desktop shell it goes to the system browser, through the opener
 * plugin - the app's own window must never navigate away from the app, and
 * `src-tauri/capabilities/desktop.json` lets the plugin open Stripe's checkout
 * host and nothing else. In a plain browser it gets a tab of its own, so the
 * app stays open to notice the unlock; if the tab is blocked, the page itself
 * goes to checkout and Stripe sends it back to `CHECKOUT_RETURN_URL`.
 */
export async function openCheckout(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  // Not `noopener` in the features: with it, window.open returns null
  // whether or not the tab opened, and a blocked tab would go unnoticed.
  const tab = window.open(url, "_blank");
  if (tab === null) {
    window.location.assign(url);
    return;
  }
  tab.opener = null;
}
