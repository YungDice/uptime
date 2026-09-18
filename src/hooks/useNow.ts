import { useEffect, useRef, useState } from "react";
import type { Clock, Seconds } from "@/core";

/**
 * A once-a-second tick, for everything that is not the stopwatch face.
 *
 * Ticking stops while the document is hidden and resyncs on return, so a
 * backgrounded tab does not burn a timer for hours.
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

/**
 * Fractional seconds on an animation frame, for the stopwatch face alone.
 *
 * Hundredths need roughly 60fps to read as a stopwatch rather than a stutter,
 * which is more work than the rest of the interface needs - so only the face
 * subscribes to this, and it runs only while the streak is live and the
 * document is visible.
 *
 * Under `prefers-reduced-motion` it falls back to whole seconds: a two-digit
 * field changing a hundred times a second is exactly the kind of churn that
 * setting exists to stop, and nothing depends on reading it.
 */
export function useFractionalNow(clock: Clock, enabled = true): number {
  const [now, setNow] = useState<number>(() => clock.now());
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      const timer = setInterval(() => setNow(clock.now()), 1000);
      return () => clearInterval(timer);
    }

    // The synced clock is whole seconds; the sub-second part comes from the
    // local performance clock, anchored on each resync. That keeps the face
    // smooth without letting it drift away from the server's reading.
    let anchorServer = clock.now();
    let anchorLocal = performance.now();

    const resync = () => {
      const next = clock.now();
      if (Math.abs(next - anchorServer - (performance.now() - anchorLocal) / 1000) > 1) {
        anchorServer = next;
        anchorLocal = performance.now();
      }
    };

    const tick = () => {
      setNow(anchorServer + (performance.now() - anchorLocal) / 1000);
      frame.current = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      cancelAnimationFrame(frame.current);
      if (!document.hidden) {
        anchorServer = clock.now();
        anchorLocal = performance.now();
        frame.current = requestAnimationFrame(tick);
      }
    };

    const resyncTimer = setInterval(resync, 5000);
    frame.current = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame.current);
      clearInterval(resyncTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clock, enabled]);

  return now;
}
