import { balance } from "@/core/economy";
import { isRunning, statusOf } from "@/core/streak";
import type { BoardEntry, BoardId } from "@/core/leaderboards";
import type { Gift } from "@/core/economy";
import type { Seconds } from "@/core/time";
import type { StreakRecord, StreakRun, StreakStatus } from "@/core/streak";
import type { UserProfile, UserState } from "@/core/types";

/** What reviving a particular lapsed run would cost and give back. */
export interface Revive {
  lostLength: Seconds;
  restores: Seconds;
  cost: Seconds;
}

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
  /** This account follows them. */
  iFollow: boolean;
  /**
   * They follow this account.
   *
   * Split from `iFollow` because the two one-way cases are opposites and the
   * list used to render them identically. `iFollow && !followsMe` is someone
   * who has not answered yet and there is nothing to do but wait;
   * `followsMe && !iFollow` is a request sitting on *your* desk, and the only
   * one of the two that deserves a button.
   */
  followsMe: boolean;
  /**
   * Present only when their streak has lapsed and is revivable.
   *
   * Optional *and* nullable, because the two adapters spell "no" differently
   * and the caller cannot tell which one it is talking to: the local adapter
   * leaves the key off, and the SQL read models build the object with
   * `jsonb_build_object`, which has to put something in the slot and puts
   * `null` there. Writing one of those two into the type made every
   * `!== undefined` test quietly wrong against the server - `null` passes it -
   * so a friend who was merrily running got offered a Revive button. Test this
   * for truthiness, never against a single flavour of absence.
   */
  revive?: Revive | null;
}

/**
 * Everything one screen needs, derived server-side and handed over whole.
 *
 * The UI never sees a ledger or computes a balance - it receives the answers.
 * That is deliberate: the same derivation has to hold across the local adapter
 * and Supabase, so it lives below this line rather than in a component.
 */
export interface Snapshot {
  account: Account;
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

/**
 * The giveable total at an arbitrary instant, recomputed rather than read.
 *
 * `Snapshot.balance` is the server's answer at the moment the snapshot was
 * taken, and a snapshot is only taken when something happens. On a running
 * clock that made the figure sit perfectly still for an hour and then leap the
 * instant an action refreshed it - which is the same number arriving late, but
 * reads as the app inventing time out of nowhere. It is the one quantity in
 * the app that grows continuously while nothing is being pressed, so it is
 * derived against the ticking clock exactly the way the counter on the face is.
 *
 * The formula is the one both adapters and the SQL use, fed the same inputs,
 * so this cannot disagree with the server about anything except the half
 * second between the read and the render - and it errs low, because the server
 * evaluates it later still. A send sized against this can never overdraw.
 *
 * The lapsed branch is the subtle one. A window that runs out while the app is
 * open flips the *local* status to lapsed seconds before any server sweep files
 * the run, and a lapsed status carries no elapsed to accrue against - so the
 * figure would fall by the whole run and then climb back the instant the sweep
 * credited it. `status.length` is exactly what the sweep is about to add
 * (`runLength`, credited to lastSeen rather than through the grace window), so
 * counting it here makes the two readings the same number rather than a dip.
 */
export function liveGiveable(snapshot: Snapshot, now: Seconds): Seconds {
  const status = statusOf(snapshot.me.streak, now);
  const kept = isRunning(status)
    ? status.elapsed
    : status.kind === "lapsed"
      ? status.length
      : 0;

  return balance({
    lifetimeSeconds: snapshot.me.lifetimeSeconds,
    currentElapsed: kept,
    sent: snapshot.totalSent,
    received: snapshot.totalReceived,
  });
}

/**
 * Whether there is a broken streak here that somebody could buy back.
 *
 * A named predicate rather than a test written out at each call site, and the
 * reason is the `revive` field's two spellings of absence (see its own note).
 * Four screens ask this question; two of them asked it as `!== undefined`,
 * which is satisfied by the `null` the server actually sends, so both offered
 * to revive people whose clocks had never stopped. The bug was not that either
 * test was wrong on its own - it was that the question was open-coded at all,
 * which made it possible for two of the four to drift.
 *
 * Takes the carrier rather than the field so the call reads as a question
 * about the person, and so a future rule - say, a lapse too old to buy back -
 * has one place to be added.
 */
export function isRevivable(who: { revive?: Revive | null }): boolean {
  return who.revive !== undefined && who.revive !== null;
}

/**
 * Someone else, as their profile page needs them.
 *
 * Deliberately not a `FriendView`. That shape exists to draw a row in a list
 * you are already part of, and it only exists for people you are connected to
 * in some direction - a name tapped on a leaderboard may be a stranger. This
 * is the public read of any account: the same two timestamps the client
 * derives its own counter from, the records worth showing, and where the
 * viewer stands in relation to them.
 */
export interface PublicProfile {
  profile: UserProfile;
  /** Raw record, so their counter ticks against the same clock yours does. */
  streak: StreakRecord;
  lifetimeSeconds: Seconds;
  /** Longest run ever, current or past. */
  personalBest: Seconds;
  totalSent: Seconds;
  totalReceived: Seconds;
  /** Streaks this account has brought back for other people. */
  rescues: number;
  connected: boolean;
  iFollow: boolean;
  followsMe: boolean;
  /**
   * Present only when their streak has lapsed and is revivable.
   *
   * Optional *and* nullable, because the two adapters spell "no" differently
   * and the caller cannot tell which one it is talking to: the local adapter
   * leaves the key off, and the SQL read models build the object with
   * `jsonb_build_object`, which has to put something in the slot and puts
   * `null` there. Writing one of those two into the type made every
   * `!== undefined` test quietly wrong against the server - `null` passes it -
   * so a friend who was merrily running got offered a Revive button. Test this
   * for truthiness, never against a single flavour of absence.
   */
  revive?: Revive | null;
}

/**
 * Who a gift is going to, and whether it may go.
 *
 * The send sheet needs a name, a face and the one rule that can refuse before
 * the round trip. Both `FriendView` and `PublicProfile` satisfy this already,
 * which is the point - the sheet opens from a friend row and from a
 * leaderboard stranger's profile without either shape learning about the other.
 */
export interface SendTarget {
  profile: UserProfile;
  connected: boolean;
}

/**
 * Who the current session is.
 *
 * Playing without an account is a first-class state: the clock starts on the
 * first tap and the streak is real. What it cannot do is take part in anything
 * involving other people, because anonymous accounts are free and unlimited -
 * a leaderboard that counted them would rank whoever scripted the most
 * signups, and a ledger that accepted them would be a free supply of senders.
 */
export interface Account {
  isAnonymous: boolean;
  email: string | null;
}

/** The two things an account unlocks, named so the UI can explain a refusal. */
export const ANONYMOUS_LIMITS = [
  "You won't appear on any leaderboard.",
  "You can't send time or revive anyone.",
] as const;

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
  /** Start a session, creating an anonymous account on first run. */
  start(handle: string): Promise<Snapshot>;
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

  /**
   * Turn the current anonymous account into a permanent one.
   *
   * Deliberately an upgrade rather than a fresh signup: the user id does not
   * change, so the streak, the history and the banked balance all carry over.
   * Losing a 95-day run to make an account would be the worst possible moment
   * to ask for one.
   */
  signUp(email: string, password: string, handle: string): Promise<ActionResult>;
  signIn(email: string, password: string): Promise<ActionResult>;
  signOut(): Promise<ActionResult>;
  setHandle(handle: string): Promise<ActionResult>;
  setDisplayName(name: string): Promise<ActionResult>;
  /**
   * Upload a profile picture and attach it, or clear it with null.
   *
   * Takes the file rather than a URL because where the bytes land is the
   * adapter's business: Supabase puts them in a storage bucket and stores the
   * public URL, the local adapter inlines them as a data URL. A caller that
   * had to know which would be a caller that could only work with one.
   */
  setAvatar(file: File | null): Promise<ActionResult>;
  board(id: BoardId): Promise<BoardEntry[]>;
  /**
   * Read any account's public profile, or null if it is gone.
   *
   * Keyed by id rather than by handle because every place that offers to open
   * one - a friend row, a podium step, a leaderboard rank - is holding an id
   * already, and a handle can be changed between the list being drawn and the
   * name being tapped.
   */
  profile(userId: string): Promise<PublicProfile | null>;
  /**
   * Where this account sits on one board, counted server-side.
   *
   * Not derivable from `board()`, which returns only the top rows - a profile
   * that says "4th of 120" cannot be built from a list of 20.
   */
  myRank(id: BoardId): Promise<RankInfo | null>;
}

/** A placing on one board. */
export interface RankInfo {
  board: BoardId;
  /** 1-based. Ties share a position, as `rank()` does. */
  position: number;
  /** How many accounts are on this board at all. */
  of: number;
  value: Seconds | number;
}
