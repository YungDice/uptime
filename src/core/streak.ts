import { CHECK_IN_WINDOW, CHECK_IN_NUDGE_LEAD } from "./constants";
import type { Seconds } from "./time";

/**
 * Everything the server stores about a user's clock. Two timestamps.
 *
 * There is no "elapsed" field and no tick. `streakStart` says when the run
 * began; `lastSeen` is the heartbeat that proves the user still exists. Every
 * number the UI shows is derived from these two against the current time.
 */
export interface StreakRecord {
  /** When the current run began. Null once the run has been ended and banked. */
  streakStart: Seconds | null;
  /** Any sign of life: app open, push tap, gift sent or received. */
  lastSeen: Seconds;
}

/** A finished run, kept forever so a reset never erases the record. */
export interface StreakRun {
  startedAt: Seconds;
  endedAt: Seconds;
  /** Seconds credited - see `runLength`, which is not simply end minus start. */
  length: Seconds;
  reason: StreakEndReason;
  /**
   * Set when a friend bought this run back.
   *
   * The run stays on the record rather than being removed: it genuinely
   * happened, and it is what the rescues leaderboard counts. Marking it also
   * stops the same run being revived twice.
   */
  revivedAt?: Seconds;
}

export type StreakEndReason = "lapsed" | "voluntary" | "reset";

export type StreakStatus =
  /** Running, and the check-in window is comfortably open. */
  | { kind: "alive"; elapsed: Seconds; windowRemaining: Seconds }
  /** Running, but close enough to the window's end to be worth a nudge. */
  | { kind: "expiring"; elapsed: Seconds; windowRemaining: Seconds }
  /** The window ran out. The streak is over; the server just has not swept yet. */
  | { kind: "lapsed"; elapsed: Seconds; lapsedAt: Seconds; length: Seconds }
  /** No run in progress - a fresh account, or one that was ended on purpose. */
  | { kind: "idle" };

/**
 * The moment a streak lapses, derived rather than stored.
 *
 * The sweep job may run hours after this instant; the streak still ended here,
 * not whenever the sweeper happened to notice.
 */
export function windowEndsAt(record: StreakRecord, window: Seconds = CHECK_IN_WINDOW): Seconds {
  return record.lastSeen + window;
}

/**
 * Seconds credited for a run that ended at `endedAt`.
 *
 * Credit runs to `lastSeen`, not to the end of the grace window: a user is
 * credited for time they were demonstrably around for. Paying out the window
 * would mean vanishing earned the same as showing up.
 */
export function runLength(startedAt: Seconds, lastSeen: Seconds): Seconds {
  return Math.max(0, lastSeen - startedAt);
}

/**
 * The whole stop problem, in one function.
 *
 * A server clock never dies on its own, so this is what makes failure
 * possible: a streak is alive only as long as its owner keeps proving they
 * exist, on a window long enough that an active user never notices it.
 */
export function statusOf(
  record: StreakRecord,
  now: Seconds,
  window: Seconds = CHECK_IN_WINDOW,
  nudgeLead: Seconds = CHECK_IN_NUDGE_LEAD,
): StreakStatus {
  if (record.streakStart === null) return { kind: "idle" };

  const deadline = windowEndsAt(record, window);
  const elapsed = Math.max(0, now - record.streakStart);

  if (now >= deadline) {
    return {
      kind: "lapsed",
      elapsed,
      lapsedAt: deadline,
      length: runLength(record.streakStart, record.lastSeen),
    };
  }

  const windowRemaining = deadline - now;
  return {
    kind: windowRemaining <= nudgeLead ? "expiring" : "alive",
    elapsed,
    windowRemaining,
  };
}

/** True while the run is still going - the two states that show a live counter. */
export function isRunning(status: StreakStatus): status is Extract<StreakStatus, { kind: "alive" | "expiring" }> {
  return status.kind === "alive" || status.kind === "expiring";
}

/**
 * How full the window reads against a given record: 1 just after a check-in,
 * 0 at the deadline.
 *
 * Note that the home screen does *not* drive its bar from this with the live
 * record, because opening the app refills `lastSeen` and the bar would always
 * read full. It measures from `Snapshot.windowAnchor` instead. This stays as
 * the honest primitive - use it when you have the record you actually mean.
 */
export function windowFraction(
  record: StreakRecord,
  now: Seconds,
  window: Seconds = CHECK_IN_WINDOW,
): number {
  const remaining = windowEndsAt(record, window) - now;
  if (remaining <= 0) return 0;
  return Math.min(1, remaining / window);
}

/** Any sign of life. The only thing that keeps a streak alive. */
export function touch(record: StreakRecord, now: Seconds): StreakRecord {
  return { ...record, lastSeen: now };
}

/**
 * Close out a run and hand back both the new record and the run to file.
 *
 * Used by the lapse sweeper, by a voluntary stop, and by a deliberate reset -
 * the three ways a streak can end, differing only in the reason recorded and
 * whether a new run starts immediately.
 */
export function endRun(
  record: StreakRecord,
  reason: StreakEndReason,
  now: Seconds,
  window: Seconds = CHECK_IN_WINDOW,
): { record: StreakRecord; run: StreakRun | null } {
  if (record.streakStart === null) return { record, run: null };

  // A lapse ended at the deadline; a deliberate stop ends right now.
  const endedAt = reason === "lapsed" ? windowEndsAt(record, window) : now;
  const creditedTo = reason === "lapsed" ? record.lastSeen : now;

  const run: StreakRun = {
    startedAt: record.streakStart,
    endedAt,
    length: runLength(record.streakStart, creditedTo),
    reason,
  };

  return { record: { streakStart: null, lastSeen: record.lastSeen }, run };
}

/** Begin a fresh run. A reset is an `endRun` followed by this. */
export function startRun(now: Seconds): StreakRecord {
  return { streakStart: now, lastSeen: now };
}

/**
 * Put a lapsed streak back, shortened.
 *
 * Backdating the start is what restores the length: the run resumes as though
 * it had begun `restored` seconds ago, and the heartbeat resets so the rescued
 * streak is not immediately lapsed again.
 */
export function reviveRun(restored: Seconds, now: Seconds): StreakRecord {
  return { streakStart: now - Math.max(0, Math.floor(restored)), lastSeen: now };
}
