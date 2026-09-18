import { useEffect, useState } from "react";
import type { Seconds } from "@/core";
import {
  permissionState,
  requestPermission,
  shouldOfferReminder,
  type PermissionState,
} from "@/notifications/checkIn";

/**
 * Offered only when it is actually useful: a streak worth protecting, a window
 * nearly out, and notifications not already on.
 *
 * Asking on first launch is how an app gets denied permanently, so the request
 * waits for the one moment the user has a reason to say yes.
 */
export function ReminderOffer({
  elapsed,
  windowRemaining,
}: {
  elapsed: Seconds;
  windowRemaining: Seconds;
}) {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void permissionState().then((state) => {
      if (!cancelled) setPermission(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (permission === null || dismissed) return null;
  if (!shouldOfferReminder(elapsed, windowRemaining, permission)) return null;

  return (
    <div className="animate-fade-up rounded-2xl bg-surface p-4">
      <p className="text-sm text-ink-text">Want a reminder before your window closes?</p>
      <p className="mt-1 text-xs text-muted">
        One notification, with a button that checks you in without opening the app.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void requestPermission().then(setPermission)}
          className="rounded-lg bg-pulse/15 px-3.5 py-2 text-xs font-semibold text-pulse transition-colors hover:bg-pulse/25"
        >
          Turn on reminders
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg px-3.5 py-2 text-xs font-semibold text-muted transition-colors hover:text-ink-text"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
