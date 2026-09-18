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
 * that nearly ran out, and notifications not already on. Asking on first launch
 * is how an app gets denied permanently.
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
    <div className="animate-rise mx-5 mt-6 rounded-2xl bg-raise px-4 py-4">
      <p className="text-[15px] text-label">Want a reminder before your window closes?</p>
      <p className="mt-1 text-[13px] text-label-2">
        One notification, with a button that checks you in without opening the app.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void requestPermission().then(setPermission)}
          className="rounded-full px-3.5 py-2 text-[13px] font-medium"
          style={{
            color: "var(--color-run)",
            background: "color-mix(in srgb, var(--color-run) 18%, transparent)",
          }}
        >
          Turn on reminders
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full px-3.5 py-2 text-[13px] font-medium text-label-2"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
