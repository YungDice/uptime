import { clockTime, sendable, sendableToday } from "@/core/economy";
import { statusOf } from "@/core/streak";
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
  /**
   * What this account could send at the moment of the snapshot: all of its
   * running clock with the whole-clock upgrade, a tenth of the run without,
   * nothing if the clock is stopped.
   *
   * There is no separate bank. Time you send comes straight off your timer and
   * lands on theirs, so this is derived from the clock read at `serverNow` -
   * and, like the clock, it is stale the instant it arrives. Read
   * `liveGiveable`.
   */
  balance: Seconds;
  /**
   * Whether this account bought the whole-clock upgrade: it may send
   * everything on its clock, rather than six minutes for every hour.
   *
   * Belongs to the account, not the device or the run - it survives a reset,
   * a sign-in elsewhere and a reinstall. It also lifts the daily sending cap.
   */
  sendsWholeClock: boolean;
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
 * Time you can send comes off your running clock, so this is derived from the
 * clock against the ticking `now`: all of it with the whole-clock upgrade, a
 * tenth of the run without (see `sendable`). `Snapshot.balance` is the same
 * figure at the moment the snapshot was taken, and a snapshot is only taken
 * when something happens, so reading it directly would freeze the ceiling on
 * a clock that is visibly still going.
 *
 * It errs low rather than high: the server evaluates the send a moment later
 * still, so an amount sized against this can never exceed what the server sees.
 *
 * A clock whose window has run out reads as nothing to send, even before the
 * sweep has filed it. Its run is over; spending out of it would be spending
 * time that is already on its way into history.
 */
export function liveGiveable(snapshot: Snapshot, now: Seconds): Seconds {
  return sendable(statusOf(snapshot.me.streak, now), {
    sendsWholeClock: snapshot.sendsWholeClock,
    sentThisRun: snapshot.me.streak.sentThisRun ?? 0,
  });
}

/**
 * What can actually leave in a send right now: the share, cut to what the
 * rolling daily cap still allows. The headline figures use this - quoting the
 * share alone promised a free account nine days it could only send seven of.
 */
export function liveSendableNow(snapshot: Snapshot, now: Seconds): Seconds {
  return Math.min(
    liveGiveable(snapshot, now),
    sendableToday(snapshot.sentInLastDay, snapshot.sendsWholeClock),
  );
}

/**
 * Everything on your running clock at an arbitrary instant: what a revive can
 * be paid with.
 *
 * Not `liveGiveable`. A revive is paid off the whole clock whether or not the
 * account has the upgrade - the free share limits what you send, not what you
 * spend - so asking whether a rescue is affordable against the share would
 * grey out revives a free account can pay for.
 */
export function liveClock(snapshot: Snapshot, now: Seconds): Seconds {
  return clockTime(statusOf(snapshot.me.streak, now));
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
  /**
   * Their raw record. A gift lands on their running clock, so whether it has
   * anywhere to land is decided from this against the ticking clock.
   */
  streak: StreakRecord;
}

/**
 * The cheapest possible read of this account: enough to tell whether anything
 * changed on the server since the last snapshot.
 *
 * Someone sending you time moves *your* clock while you are looking at it, and
 * nothing on this device would otherwise find out until the next action or the
 * next app open. Polling the whole snapshot for that would make every open
 * client re-read its entire friend list on a timer, which is the load that
 * does not survive a large user base. This is one primary-key lookup; the full
 * refresh only runs when it says something moved.
 */
export interface Pulse {
  serverNow: Seconds;
  streakStart: Seconds | null;
  totalReceived: Seconds;
  /**
   * The other thing that changes without this device doing anything: a
   * payment finishing in the browser, whose webhook unlocks the account.
   */
  sendsWholeClock: boolean;
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
 * Where buying the whole-clock upgrade goes next.
 *
 * Usually a payment page to open: the purchase finishes in the browser, and
 * the account is unlocked by the payment provider telling the server, not by
 * anything this device says - so the app learns about it the way it learns
 * about a gift, on the next pulse. The local adapter has no payment provider
 * behind it and answers with the unlocked snapshot directly.
 */
export type CheckoutResult = ActionResult | { ok: true; checkoutUrl: string; message: string };

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
  /**
   * Has anything moved? Read-only, and deliberately not a sign of life - it
   * runs on a timer, and a tab left open is not a person showing up.
   */
  pulse(): Promise<Pulse>;
  /** The low-friction "I'm still here". */
  checkIn(): Promise<ActionResult>;
  /** Begin a run on a fresh or stopped account. */
  startStreak(): Promise<ActionResult>;
  /** End your own streak on purpose. Recorded as its own stat. */
  stopStreak(): Promise<ActionResult>;
  /**
   * Give time away, no strings attached. It comes straight off your running
   * clock and is added to theirs.
   */
  sendTime(toUserId: string, amount: Seconds): Promise<ActionResult>;
  /** Spend time off your own clock to bring a friend's lapsed streak back, halved. */
  reviveFriend(userId: string): Promise<ActionResult>;
  /**
   * Buy the right to send your whole clock rather than a tenth of it.
   *
   * A one-off payment, tied to the account - so an anonymous session is
   * refused, the same as it is refused sending at all. See `CheckoutResult`.
   */
  buyWholeClock(): Promise<CheckoutResult>;
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
   * change, so the streak, the history and the ledger all carry over.
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
