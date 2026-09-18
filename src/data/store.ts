import type { BoardEntry, BoardId } from "@/core/leaderboards";
import type { Gift } from "@/core/economy";
import type { Seconds } from "@/core/time";
import type { StreakRecord, StreakRun, StreakStatus } from "@/core/streak";
import type { UserProfile, UserState } from "@/core/types";

/**
 * A friend as the home screen needs them: enough to show whether their streak
 * is alive and, if it is not, what rescuing it would cost.
 */
export interface FriendView {
  profile: UserProfile;
  /**
   * The raw record, not a computed status.
   *
   * Elapsed is derived on the client against the ticking clock, so a friend's
   * counter moves for exactly the same reason the user's own does - there is
   * no second, staler notion of how long a streak has run.
   */
  streak: StreakRecord;
  /**
   * Whether the follow goes both ways. A one-way follow still appears in the
   * list - otherwise following someone looks like it did nothing - but no time
   * can move until it is mutual.
   */
  connected: boolean;
  /** Present only when their streak has lapsed and is revivable. */
  revive?: { lostLength: Seconds; restores: Seconds; cost: Seconds };
}

/**
 * Everything one screen needs, derived server-side and handed over whole.
 *
 * The UI never sees a ledger or computes a balance - it receives the answers.
 * That is deliberate: the same derivation has to hold across the local adapter
 * and Supabase, so it lives below this line rather than in a component.
 */
export interface Snapshot {
  me: UserState;
  status: StreakStatus;
  /** Server time at the moment of the snapshot. Drives clock correction. */
  serverNow: Seconds;
  /**
   * The `last_seen` the check-in window should be measured from.
   *
   * Not simply `me.streak.lastSeen`: opening the app is itself a sign of life,
   * so by the time the window bar is on screen the window has already been
   * refilled and would always read full. This is the value from *before* this
   * visit, which is what makes the bar say something true - "you last showed
   * up 12 days ago" - rather than tautologically reading 100%.
   *
   * An explicit check-in sets it to now, so the bar refills when the user
   * actually presses the button.
   */
  windowAnchor: Seconds;
  balance: Seconds;
  totalSent: Seconds;
  totalReceived: Seconds;
  sentInLastDay: Seconds;
  /** Longest run ever, current or past. */
  personalBest: Seconds;
  /**
   * The most recently ended run, or null on an account that has never lost one.
   *
   * This is how the app can say what happened. The `lapsed` *status* barely
   * exists in practice - every open sweeps it - so without the closed run to
   * point at, a user would come back to a zeroed counter and no explanation.
   */
  lastRun: StreakRun | null;
  friends: FriendView[];
  recentGifts: Gift[];
}

export type ActionResult =
  | { ok: true; snapshot: Snapshot; message: string }
  | { ok: false; message: string };

/**
 * The one thing the app talks to.
 *
 * Both adapters behind it - local and Supabase - are expected to enforce the
 * same rules. The local one is not a mock with the checks stubbed out; it runs
 * the real `core` logic, so behaviour does not change when credentials appear.
 */
export interface UptimeStore {
  /** Identify the current user, creating an account on first run. */
  signIn(handle: string): Promise<Snapshot>;
  /** Refresh, and register a sign of life. Called on every app open. */
  refresh(): Promise<Snapshot>;
  /** The low-friction "I'm still here". */
  checkIn(): Promise<ActionResult>;
  /** Begin a run on a fresh or stopped account. */
  startStreak(): Promise<ActionResult>;
  /** End your own streak on purpose. Recorded as its own stat. */
  stopStreak(): Promise<ActionResult>;
  /** Give banked time away, no strings attached. */
  sendTime(toUserId: string, amount: Seconds): Promise<ActionResult>;
  /** Spend banked time to bring a friend's lapsed streak back, halved. */
  reviveFriend(userId: string): Promise<ActionResult>;
  /**
   * Follow someone by handle.
   *
   * Time only moves between people who follow each other, so this is the entry
   * point to the whole social half of the app - without it a fresh account has
   * nobody to send to and the economy is unreachable.
   */
  follow(handle: string): Promise<ActionResult>;
  unfollow(userId: string): Promise<ActionResult>;
  board(id: BoardId): Promise<BoardEntry[]>;
}
