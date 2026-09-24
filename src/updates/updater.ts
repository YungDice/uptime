import { currentPlatform, isMobile, isTauri } from "@/platform";

/**
 * Keeping the desktop build current.
 *
 * The Windows app replaces itself from a signed feed (`plugins.updater` in
 * tauri.conf.json, published by `.github/workflows/release.yml`). The phones
 * are updated by their stores and the web build by a reload, so everything
 * here is inert outside a desktop Tauri window.
 *
 * An update is downloaded in the background as soon as one is found, and only
 * the restart is offered. Restarting costs the user nothing: the clock is two
 * timestamps on the server, not a process, so closing the app does not stop it.
 */

/** The build's own version, from package.json - the same number Tauri ships. */
export const appVersion: string = import.meta.env["VITE_APP_VERSION"] ?? "dev";

/** How often an open app asks again. It can sit open for weeks. */
export const RECHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { phase: "unsupported" }
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "downloading"; version: string; progress: number | null }
  | { phase: "ready"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "failed"; message: string };

export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** The part of `@tauri-apps/plugin-updater`'s `Update` this module touches. */
export interface PendingUpdate {
  version: string;
  download(onEvent?: (event: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
}

export interface UpdaterApi {
  check(): Promise<PendingUpdate | null>;
  relaunch(): Promise<void>;
}

export function canSelfUpdate(): boolean {
  return isTauri() && !isMobile();
}

/** Loaded lazily so the browser and phone builds never pull in the plugins. */
export async function loadUpdaterApi(): Promise<UpdaterApi | null> {
  if (!canSelfUpdate()) return null;
  try {
    const [updater, process] = await Promise.all([
      import("@tauri-apps/plugin-updater"),
      import("@tauri-apps/plugin-process"),
    ]);
    return { check: () => updater.check(), relaunch: () => process.relaunch() };
  } catch {
    return null;
  }
}

/**
 * Ask the feed, and if there is something newer, fetch it.
 *
 * Resolves with the downloaded update, ready for `installUpdate`, or null when
 * there is nothing to install. Never throws: a failure is reported as a state,
 * because a missed update check is not something to interrupt anyone over.
 */
export async function fetchUpdate(
  api: UpdaterApi,
  report: (state: UpdateState) => void,
): Promise<PendingUpdate | null> {
  report({ phase: "checking" });

  let update: PendingUpdate | null;
  try {
    update = await api.check();
  } catch (error) {
    report({ phase: "failed", message: describe(error) });
    return null;
  }
  if (!update) {
    report({ phase: "current" });
    return null;
  }

  const { version } = update;
  let total: number | null = null;
  let received = 0;
  let shown = -1;
  report({ phase: "downloading", version, progress: null });

  try {
    await update.download((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        if (!total) return;
        // Whole percents only: chunks arrive far faster than anyone reads.
        const percent = Math.min(100, Math.floor((received / total) * 100));
        if (percent === shown) return;
        shown = percent;
        report({ phase: "downloading", version, progress: percent / 100 });
      }
    });
  } catch (error) {
    report({ phase: "failed", message: describe(error) });
    return null;
  }

  report({ phase: "ready", version });
  return update;
}

/**
 * Swap in the downloaded build.
 *
 * On Windows `install` hands over to the installer, which closes this process
 * and starts the new version itself, so nothing after it runs. On macOS and
 * Linux the files are replaced in place and the app has to restart into them.
 */
export async function installUpdate(
  api: UpdaterApi,
  update: PendingUpdate,
  report: (state: UpdateState) => void,
): Promise<void> {
  report({ phase: "installing", version: update.version });
  try {
    await update.install();
    await api.relaunch();
  } catch (error) {
    report({ phase: "failed", message: describe(error) });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

/**
 * Where the phone apps get their updates, for the Updates row to say so.
 *
 * Null on desktop, which updates itself, and in a browser, which is updated by
 * reloading - neither has a store to name.
 */
export function updateStore(): string | null {
  if (!isTauri()) return null;
  const platform = currentPlatform();
  if (platform === "android") return "Google Play";
  if (platform === "ios") return "App Store";
  return null;
}

/**
 * Why a check or download failed, in words a person can act on.
 *
 * The updater's own errors are written for developers - "Could not fetch a
 * valid release JSON from the remote" is what a missing release looks like -
 * and the row used to show none of them, only "Failed - try again", which
 * reads as a broken button rather than as a reason.
 */
export function failureReason(message: string): string {
  if (/valid release JSON|status code|404|not found/i.test(message)) {
    return "No update feed was found. Once a release is published, this finds it.";
  }
  if (/signature|public key|key id|minisign/i.test(message)) {
    return "The update is not signed with this app's key. Reinstall from the download link.";
  }
  if (/error sending request|dns|connect|timed out|network|offline/i.test(message)) {
    return "Could not reach GitHub. Check your connection and try again.";
  }
  return message;
}

/** The line under the Updates row, when there is more to say than its value. */
export function updateDetail(state: UpdateState): string | null {
  switch (state.phase) {
    case "failed":
      return failureReason(state.message);
    case "ready":
      return "Downloaded. Restarting takes a few seconds; your clock keeps running.";
    default:
      return null;
  }
}

/** The Updates row's value in the Account tab. */
export function updateLabel(state: UpdateState): string {
  switch (state.phase) {
    case "unsupported":
      return "Not available";
    case "idle":
      return "Check now";
    case "checking":
      return "Checking";
    case "current":
      return "Up to date";
    case "downloading":
      return state.progress === null
        ? `Downloading ${state.version}`
        : `Downloading ${Math.round(state.progress * 100)}%`;
    case "ready":
      return `Restart for ${state.version}`;
    case "installing":
      return "Restarting";
    case "failed":
      return "Failed - try again";
  }
}
