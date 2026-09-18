import { MIN_ACCOUNT_AGE_FOR_LEADERBOARD_CREDIT } from "./constants";
import { totalReceived, totalSent, type Gift } from "./economy";
import { isRunning, statusOf } from "./streak";
import type { Seconds } from "./time";
import type { UserState } from "./types";

export type BoardId =
  | "current-streak"
  | "longest-ever"
  | "lifetime-total"
  | "most-donated"
  | "most-received"
  | "most-revives";

export interface BoardEntry {
  userId: string;
  handle: string;
  displayName: string;
  value: Seconds | number;
  /** Rendered as a duration unless this says otherwise. */
  unit: "seconds" | "count";
}

export const BOARDS: { id: BoardId; label: string; blurb: string }[] = [
  { id: "current-streak", label: "Running now", blurb: "Longest streak still alive" },
  { id: "longest-ever", label: "Hall of fame", blurb: "Longest streak ever achieved" },
  { id: "lifetime-total", label: "Career total", blurb: "Most time kept across every run" },
  { id: "most-donated", label: "Most given", blurb: "Most time donated to others" },
  { id: "most-received", label: "Most received", blurb: "Most time received as gifts" },
  { id: "most-revives", label: "Rescues", blurb: "Most broken streaks revived" },
];

/**
 * Whether a user's gifts count toward the public rankings.
 *
 * A fresh signup can play immediately; it just cannot move the boards until it
 * has some history. Sockpuppet farms are cheap to create and expensive to age.
 */
export function countsTowardBoards(user: UserState, now: Seconds): boolean {
  return now - user.createdAt >= MIN_ACCOUNT_AGE_FOR_LEADERBOARD_CREDIT;
}

/**
 * Build one board.
 *
 * Every branch here is a subtraction or a sum over rows already stored - there
 * is no running total to maintain and nothing to keep in sync.
 */
export function buildBoard(
  board: BoardId,
  users: readonly UserState[],
  gifts: readonly Gift[],
  now: Seconds,
  limit = 20,
): BoardEntry[] {
  const entries: BoardEntry[] = [];

  for (const user of users) {
    const status = statusOf(user.streak, now);

    switch (board) {
      case "current-streak": {
        if (!isRunning(status)) continue;
        entries.push(entry(user, status.elapsed, "seconds"));
        break;
      }
      case "longest-ever": {
        const best = Math.max(
          isRunning(status) ? status.elapsed : 0,
          ...user.history.map((r) => r.length),
          0,
        );
        if (best > 0) entries.push(entry(user, best, "seconds"));
        break;
      }
      case "lifetime-total": {
        const total = user.lifetimeSeconds + (isRunning(status) ? status.elapsed : 0);
        if (total > 0) entries.push(entry(user, total, "seconds"));
        break;
      }
      case "most-donated": {
        if (!countsTowardBoards(user, now)) continue;
        const sent = totalSent(gifts, user.id);
        if (sent > 0) entries.push(entry(user, sent, "seconds"));
        break;
      }
      case "most-received": {
        const received = totalReceived(gifts, user.id);
        if (received > 0) entries.push(entry(user, received, "seconds"));
        break;
      }
      case "most-revives": {
        if (!countsTowardBoards(user, now)) continue;
        const revives = gifts.filter(
          (g) => g.fromUserId === user.id && g.revivedStreakId !== undefined,
        ).length;
        if (revives > 0) entries.push(entry(user, revives, "count"));
        break;
      }
    }
  }

  return entries.sort((a, b) => b.value - a.value).slice(0, limit);
}

function entry(user: UserState, value: number, unit: "seconds" | "count"): BoardEntry {
  return {
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    value,
    unit,
  };
}
