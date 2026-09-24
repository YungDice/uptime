import { useCallback, useEffect, useRef, useState } from "react";
import {
  RECHECK_EVERY_MS,
  canSelfUpdate,
  fetchUpdate,
  installUpdate,
  loadUpdaterApi,
  type PendingUpdate,
  type UpdateState,
  type UpdaterApi,
} from "./updater";

export interface Updater {
  state: UpdateState;
  /** Ask the feed now. A no-op while a check is running or an update waits. */
  check(): void;
  /** Restart into the downloaded update. */
  install(): void;
}

/**
 * Checks on launch and every few hours after, downloads whatever it finds, and
 * leaves the restart to the user.
 *
 * Not in `vite dev`/`tauri dev`: a development build would offer to replace
 * itself with the last release. The Account row can still check by hand.
 */
export function useUpdater(): Updater {
  const [state, setState] = useState<UpdateState>(() =>
    canSelfUpdate() ? { phase: "idle" } : { phase: "unsupported" },
  );
  const api = useRef<UpdaterApi | null>(null);
  const pending = useRef<PendingUpdate | null>(null);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current || pending.current) return;
    busy.current = true;
    try {
      api.current ??= await loadUpdaterApi();
      if (!api.current) {
        setState({ phase: "unsupported" });
        return;
      }
      pending.current = await fetchUpdate(api.current, setState);
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const update = pending.current;
    if (!api.current || !update || busy.current) return;
    busy.current = true;
    try {
      await installUpdate(api.current, update, setState);
      // Still here, so it failed. Start over on the next check rather than
      // retrying an install that has already been consumed.
      pending.current = null;
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!canSelfUpdate() || import.meta.env.DEV) return;
    void check();
    const timer = setInterval(() => void check(), RECHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [check]);

  return { state, check: () => void check(), install: () => void install() };
}
