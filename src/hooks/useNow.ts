import { useEffect, useState } from "react";
import type { Clock, Seconds } from "@/core";

/**
 * A once-a-second tick for the live readout.
 *
 * This drives the cosmetic counter only. The value comes from the synced
 * clock, so a device whose time is wrong shows the corrected number rather
 * than its own. Ticking stops while the document is hidden and resyncs on
 * return, so a backgrounded tab does not burn a timer for hours.
 */
export function useNow(clock: Clock, enabled = true): Seconds {
  const [now, setNow] = useState(() => clock.now());

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      setNow(clock.now());
      timer = setInterval(() => setNow(clock.now()), 1000);
    };

    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      stop();
      if (!document.hidden) start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clock, enabled]);

  return now;
}
