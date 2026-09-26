import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SyncedClock, formatDuration } from "@/core";
import type { Clock, Seconds } from "@/core";
import type { ActionResult, Snapshot, UptimeStore } from "@/data/store";
import { useNow } from "./useNow";

export interface Notice {
  id: number;
  tone: "good" | "bad";
  text: string;
}

export interface Session {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  now: Seconds;
  /**
   * The server-corrected clock, for the one component that animates faster
   * than once a second.
   *
   * Handed out rather than turned into a fractional `now` here. A per-frame
   * value held in this hook re-rendered the entire app sixty times a second -
   * every friend row, every board row, every sheet - to move two digits on the
   * face. The face subscribes to the frame clock itself, so it is the only
   * thing that pays for it.
   */
  clock: Clock;
  notice: Notice | null;
  dismissNotice(): void;
  /** Show a one-line notice that no action produced - a return from checkout. */
  announce(tone: Notice["tone"], text: string): void;
  run(action: () => Promise<ActionResult>): Promise<boolean>;
  reload(): Promise<void>;
  /** Try the launch again, after it failed before there was a snapshot. */
  retry(): void;
}

/**
 * How recently a snapshot must have arrived for a return to the app to skip
 * re-reading it.
 *
 * Every refresh is the heaviest read in the product and a write (it is a sign
 * of life). Flicking between windows fires `visibilitychange` constantly, and
 * each of those used to be a full round trip - multiplied by every open client,
 * that is most of the load a large user base puts on the server, spent on
 * nothing having changed.
 */
const REFRESH_MIN_INTERVAL_MS = 15_000;

/**
 * How often an open, visible app asks whether anything moved.
 *
 * The one thing that changes this account without this device doing anything
 * is somebody sending it time, which moves its clock. A pulse is a single
 * primary-key read, so this is cheap enough to run in every open client while
 * still showing a gift within half a minute of it being sent.
 */
const PULSE_INTERVAL_MS = 30_000;

/**
 * Owns the store, the corrected clock, and the one-line result of the last
 * action. Screens read this and never touch the store directly.
 */
export function useSession(store: UptimeStore, handle: string): Session {
  const clock = useMemo(() => new SyncedClock(), []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Bumped to run the launch again. See `retry`. */
  const [attempt, setAttempt] = useState(0);
  const noticeId = useRef(0);
  /** Wall-clock ms of the last snapshot applied. See REFRESH_MIN_INTERVAL_MS. */
  const syncedAt = useRef(0);
  /** The snapshot the pulse compares against, without re-arming its timer. */
  const latest = useRef<Snapshot | null>(null);

  const apply = useCallback(
    (next: Snapshot) => {
      // Every snapshot carries server time; the local clock is corrected
      // against it so the ticking counter never drifts far from the truth.
      clock.syncTo(next.serverNow);
      syncedAt.current = Date.now();
      latest.current = next;
      setSnapshot(next);
    },
    [clock],
  );

  const say = useCallback((tone: Notice["tone"], text: string) => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, tone, text });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      apply(await store.refresh());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach your streak.");
    } finally {
      setLoading(false);
    }
  }, [apply, store]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Cleared first, so a retry puts the launch screen back rather than
      // leaving the old error up while it tries.
      setError(null);
      try {
        const next = await store.start(handle);
        if (!cancelled) {
          apply(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not sign in.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, handle, store, attempt]);

  // A launch that failed with nothing on screen tries again by itself when the
  // network comes back: the desktop app can start with the machine, before
  // the Wi-Fi has, and otherwise sat on the error until it was restarted.
  const stranded = error !== null && snapshot === null;
  useEffect(() => {
    if (!stranded) return;
    const onOnline = () => setAttempt((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [stranded]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Reopening the app is itself a sign of life, so refresh on return - unless
  // the last reading is only seconds old, in which case nothing a refresh could
  // tell us has had time to change.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      if (Date.now() - syncedAt.current < REFRESH_MIN_INTERVAL_MS) return;
      void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  // Time sent to this account lands on its clock server-side, and a payment
  // finished in the browser unlocks it server-side. Ask cheaply whether either
  // happened, and only pay for a full read when one did.
  const ready = snapshot !== null;
  useEffect(() => {
    if (!ready) return;
    let busy = false;

    const beat = async () => {
      const seen = latest.current;
      if (busy || document.hidden || seen === null) return;
      busy = true;
      try {
        const pulse = await store.pulse();
        clock.syncTo(pulse.serverNow);
        const received = pulse.totalReceived - seen.totalReceived;
        // Coerced, because a server a migration behind sends no flag at all,
        // and undefined !== false would re-read the snapshot on every beat.
        const unlockChanged = Boolean(pulse.sendsWholeClock) !== Boolean(seen.sendsWholeClock);
        if (pulse.streakStart !== seen.me.streak.streakStart || received !== 0 || unlockChanged) {
          await reload();
          if (unlockChanged && pulse.sendsWholeClock) {
            say("good", "Payment received. You can send your whole clock now.");
          } else if (received > 0) {
            say("good", `${formatDuration(received)} was sent to you. It's on your clock now.`);
          }
        }
      } catch {
        // A missed beat is not worth a notice; the next one, or the next
        // action, reads the server again anyway.
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => void beat(), PULSE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [clock, ready, reload, say, store]);

  const run = useCallback(
    async (action: () => Promise<ActionResult>): Promise<boolean> => {
      try {
        const result = await action();
        if (result.ok) {
          apply(result.snapshot);
          say("good", result.message);
          return true;
        }
        say("bad", result.message);
        return false;
      } catch (err) {
        say("bad", err instanceof Error ? err.message : "That did not go through.");
        return false;
      }
    },
    [apply, say],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);
  const now = useNow(clock, ready);

  return {
    snapshot,
    loading,
    error,
    now,
    clock,
    notice,
    dismissNotice,
    announce: say,
    run,
    reload,
    retry,
  };
}
