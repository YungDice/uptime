import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SyncedClock } from "@/core";
import type { Seconds } from "@/core";
import type { ActionResult, Snapshot, UptimeStore } from "@/data/store";
import { useFractionalNow, useNow } from "./useNow";

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
  /** Fractional seconds, for the stopwatch face alone. */
  fractionalNow: number;
  notice: Notice | null;
  dismissNotice(): void;
  run(action: () => Promise<ActionResult>): Promise<boolean>;
  reload(): Promise<void>;
}

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
  const noticeId = useRef(0);

  const apply = useCallback(
    (next: Snapshot) => {
      // Every snapshot carries server time; the local clock is corrected
      // against it so the ticking counter never drifts far from the truth.
      clock.syncTo(next.serverNow);
      setSnapshot(next);
    },
    [clock],
  );

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
  }, [apply, handle, store]);

  // Reopening the app is itself a sign of life, so refresh on return.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<ActionResult>): Promise<boolean> => {
      try {
        const result = await action();
        noticeId.current += 1;
        if (result.ok) {
          apply(result.snapshot);
          setNotice({ id: noticeId.current, tone: "good", text: result.message });
          return true;
        }
        setNotice({ id: noticeId.current, tone: "bad", text: result.message });
        return false;
      } catch (err) {
        noticeId.current += 1;
        setNotice({
          id: noticeId.current,
          tone: "bad",
          text: err instanceof Error ? err.message : "That did not go through.",
        });
        return false;
      }
    },
    [apply],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);
  const now = useNow(clock, snapshot !== null);
  const fractionalNow = useFractionalNow(clock, snapshot !== null);

  return {
    snapshot,
    loading,
    error,
    now,
    fractionalNow,
    notice,
    dismissNotice,
    run,
    reload,
  };
}
