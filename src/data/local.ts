import {
  CHECK_IN_WINDOW,
  DAY,
  balance,
  buildBoard,
  checkGift,
  endRun,
  isRunning,
  reviveCost,
  reviveRun,
  revivedLength,
  sentInLastDay,
  startRun,
  statusOf,
  systemClock,
  totalReceived,
  totalSent,
  touch,
  type BoardEntry,
  type BoardId,
  type Clock,
  type Gift,
  type Seconds,
  type StreakRun,
  type UserState,
} from "@/core";
import type { ActionResult, FriendView, Snapshot, UptimeStore } from "./store";

const STORAGE_KEY = "uptime.world.v2";

interface World {
  meId: string;
  users: Record<string, UserState>;
  gifts: Gift[];
  /**
   * Directed follows, one entry per direction, keyed "follower>followee".
   *
   * Directed rather than paired because following back is a distinct state the
   * interface has to show: you can follow someone and still not be able to
   * send them anything until they follow you.
   */
  follows: string[];
}

function followKey(follower: string, followee: string): string {
  return follower + ">" + followee;
}

/**
 * Local-first adapter. Runs the real rules against browser storage.
 *
 * This exists so the app is playable before a Supabase project exists, and so
 * the rules can be exercised in tests without a network. It is not a mock: the
 * gift checks, lapse sweep and revive pricing all run the same `core`
 * functions the server will.
 */
export class LocalStore implements UptimeStore {
  private world: World;
  /** See Snapshot.windowAnchor. Null means "use last_seen as it stands". */
  private anchor: Seconds | null = null;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly storage: Storage | null = safeStorage(),
  ) {
    this.world = this.load();
  }

  async signIn(handle: string): Promise<Snapshot> {
    const now = this.clock.now();
    this.syncFromStorage();
    const existing = Object.values(this.world.users).find((u) => u.handle === handle);

    if (existing) {
      this.world.meId = existing.id;
    } else {
      const user: UserState = {
        id: "u_" + Math.random().toString(36).slice(2, 10),
        handle,
        displayName: handle,
        createdAt: now,
        streak: startRun(now),
        lifetimeSeconds: 0,
        history: [],
      };
      this.world.users[user.id] = user;
      this.world.meId = user.id;
      // A new account is connected to the seeded cast, so the social features
      // are reachable on first run rather than behind an empty friends list.
      for (const other of Object.values(this.world.users)) {
        if (other.id === user.id) continue;
        this.world.follows.push(followKey(user.id, other.id), followKey(other.id, user.id));
      }
    }

    this.persist();
    return this.refresh();
  }

  async refresh(): Promise<Snapshot> {
    const now = this.clock.now();
    this.syncFromStorage();
    this.sweep(now);
    // Opening the app is a sign of life - but remember where the window stood
    // before that, or the bar can only ever read full.
    this.anchor = this.me().streak.lastSeen;
    this.me().streak = touch(this.me().streak, now);
    this.persist();
    return this.snapshot();
  }

  async checkIn(): Promise<ActionResult> {
    const now = this.clock.now();
    this.syncFromStorage();
    this.sweep(now);
    const me = this.me();

    if (me.streak.streakStart === null) {
      return { ok: false, message: "No streak running. Start one to begin." };
    }

    me.streak = touch(me.streak, now);
    // An explicit check-in is the one thing that genuinely refills the bar.
    this.anchor = now;
    this.persist();
    return {
      ok: true,
      snapshot: this.snapshot(),
      message: "Confirmed - your streak continues.",
    };
  }

  async startStreak(): Promise<ActionResult> {
    const now = this.clock.now();
    this.syncFromStorage();
    const me = this.me();
    if (me.streak.streakStart !== null) {
      return { ok: false, message: "A streak is already running." };
    }
    me.streak = startRun(now);
    this.persist();
    return { ok: true, snapshot: this.snapshot(), message: "Your clock is running." };
  }

  async stopStreak(): Promise<ActionResult> {
    const now = this.clock.now();
    this.syncFromStorage();
    const me = this.me();
    const status = statusOf(me.streak, now);
    if (!isRunning(status)) {
      return { ok: false, message: "No streak running." };
    }

    const { record, run } = endRun(me.streak, "voluntary", now);
    me.streak = record;
    if (run) {
      me.history.push(run);
      me.lifetimeSeconds += run.length;
    }
    this.persist();
    const days = Math.floor((run?.length ?? 0) / DAY);
    return {
      ok: true,
      snapshot: this.snapshot(),
      message: "You stopped your own clock after " + days + " days.",
    };
  }

  async sendTime(toUserId: string, amount: Seconds): Promise<ActionResult> {
    const now = this.clock.now();
    this.syncFromStorage();
    this.sweep(now);
    const me = this.me();
    const recipient = this.world.users[toUserId];
    if (!recipient) return { ok: false, message: "That account no longer exists." };

    const check = checkGift(amount, {
      senderBalance: this.balanceOf(me, now),
      sentInLastDay: sentInLastDay(this.world.gifts, me.id, now),
      connected: this.connected(me.id, toUserId),
      isSelf: me.id === toUserId,
    });
    if (!check.ok) return { ok: false, message: check.message };

    this.world.gifts.push({
      id: this.giftId(now),
      fromUserId: me.id,
      toUserId,
      amount,
      createdAt: now,
    });
    // Receiving is a sign of life for the recipient, as the prompt specifies.
    recipient.streak = touch(recipient.streak, now);
    me.streak = touch(me.streak, now);
    this.persist();

    return {
      ok: true,
      snapshot: this.snapshot(),
      message: "Sent to " + recipient.displayName + ".",
    };
  }

  async reviveFriend(userId: string): Promise<ActionResult> {
    const now = this.clock.now();
    this.syncFromStorage();
    this.sweep(now);
    const me = this.me();
    const friend = this.world.users[userId];
    if (!friend) return { ok: false, message: "That account no longer exists." };
    if (!this.connected(me.id, userId)) {
      return { ok: false, message: "You can only revive people you both follow." };
    }

    const lastRun = revivableRun(friend);
    if (friend.streak.streakStart !== null || !lastRun) {
      return { ok: false, message: friend.displayName + " has no broken streak to revive." };
    }

    const cost = reviveCost(lastRun.length);
    const restores = revivedLength(lastRun.length);
    if (cost > this.balanceOf(me, now)) {
      return { ok: false, message: "Not enough banked time for this rescue." };
    }

    this.world.gifts.push({
      id: this.giftId(now),
      fromUserId: me.id,
      toUserId: userId,
      amount: cost,
      createdAt: now,
      revivedStreakId: friend.id + ":" + lastRun.endedAt,
    });

    friend.streak = reviveRun(restores, now);
    // The revived stretch is running again, so it stops counting toward the
    // lifetime total - but the run itself stays on the record, marked.
    lastRun.revivedAt = now;
    friend.lifetimeSeconds = Math.max(0, friend.lifetimeSeconds - lastRun.length);
    me.streak = touch(me.streak, now);
    this.persist();

    return {
      ok: true,
      snapshot: this.snapshot(),
      message:
        "You brought " + friend.displayName + " back at " + Math.floor(restores / DAY) + " days.",
    };
  }

  async follow(handle: string): Promise<ActionResult> {
    const now = this.clock.now();
    this.syncFromStorage();
    const me = this.me();
    const wanted = handle.trim().toLowerCase();
    const target = Object.values(this.world.users).find((u) => u.handle === wanted);

    if (!target) return { ok: false, message: "No account with that handle." };
    if (target.id === me.id) return { ok: false, message: "That is you." };

    const key = followKey(me.id, target.id);
    if (!this.world.follows.includes(key)) this.world.follows.push(key);
    me.streak = touch(me.streak, now);
    this.persist();

    return {
      ok: true,
      snapshot: this.snapshot(),
      message: this.connected(me.id, target.id)
        ? "You and " + target.displayName + " can now send each other time."
        : "Following " + target.displayName + ". Time can move once they follow you back.",
    };
  }

  async unfollow(userId: string): Promise<ActionResult> {
    this.syncFromStorage();
    const me = this.me();
    this.world.follows = this.world.follows.filter((f) => f !== followKey(me.id, userId));
    this.persist();
    return { ok: true, snapshot: this.snapshot(), message: "Unfollowed." };
  }

  async board(id: BoardId): Promise<BoardEntry[]> {
    const now = this.clock.now();
    this.syncFromStorage();
    this.sweep(now);
    return buildBoard(id, Object.values(this.world.users), this.world.gifts, now);
  }

  // --- internals -----------------------------------------------------------

  private giftId(now: Seconds): string {
    return "g_" + now + "_" + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Re-read the shared world before acting on it.
   *
   * Two tabs, or two accounts in a test, are two LocalStore instances over one
   * storage key. Without this each would act on a private copy and silently
   * overwrite the other - the local adapter is standing in for a shared
   * backend, so it has to behave like one.
   */
  private syncFromStorage(): void {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as World;
      const meId = this.world.meId;
      this.world = stored;
      // Keep this instance's identity; another tab may be someone else.
      if (this.world.users[meId]) this.world.meId = meId;
    } catch {
      // Keep the copy we have rather than losing the session to a bad payload.
    }
  }

  private me(): UserState {
    const me = this.world.users[this.world.meId];
    if (!me) throw new Error("No signed-in user");
    return me;
  }

  /** The gate on every gift: both directions must exist. */
  private connected(a: string, b: string): boolean {
    return (
      this.world.follows.includes(followKey(a, b)) && this.world.follows.includes(followKey(b, a))
    );
  }

  private balanceOf(user: UserState, now: Seconds): Seconds {
    const status = statusOf(user.streak, now);
    return balance({
      lifetimeSeconds: user.lifetimeSeconds,
      currentElapsed: isRunning(status) ? status.elapsed : 0,
      sent: totalSent(this.world.gifts, user.id),
      received: totalReceived(this.world.gifts, user.id),
    });
  }

  /**
   * The lapse sweep, run on read.
   *
   * The scheduled Edge Function does this server-side on a timer; doing it
   * here too means a snapshot is never stale, and keeps the two paths honest
   * by making them share `endRun`.
   */
  private sweep(now: Seconds): void {
    for (const user of Object.values(this.world.users)) {
      if (statusOf(user.streak, now).kind !== "lapsed") continue;
      const { record, run } = endRun(user.streak, "lapsed", now, CHECK_IN_WINDOW);
      user.streak = record;
      if (run) {
        user.history.push(run);
        user.lifetimeSeconds += run.length;
      }
    }
  }

  private snapshot(): Snapshot {
    const now = this.clock.now();
    const me = this.me();
    const status = statusOf(me.streak, now);

    const friends: FriendView[] = Object.values(this.world.users)
      // Either direction is enough to be listed; only a mutual follow lets
      // time move.
      .filter(
        (u) =>
          u.id !== me.id &&
          (this.world.follows.includes(followKey(me.id, u.id)) ||
            this.world.follows.includes(followKey(u.id, me.id))),
      )
      .map((friend) => {
        const lastRun = revivableRun(friend);
        const view: FriendView = {
          profile: friend,
          streak: friend.streak,
          connected: this.connected(me.id, friend.id),
        };
        if (friend.streak.streakStart === null && lastRun) {
          view.revive = {
            lostLength: lastRun.length,
            restores: revivedLength(lastRun.length),
            cost: reviveCost(lastRun.length),
          };
        }
        return view;
      })
      .sort((a, b) => elapsedOf(b.streak, now) - elapsedOf(a.streak, now));

    return {
      me,
      status,
      serverNow: now,
      windowAnchor: this.anchor ?? me.streak.lastSeen,
      balance: this.balanceOf(me, now),
      totalSent: totalSent(this.world.gifts, me.id),
      totalReceived: totalReceived(this.world.gifts, me.id),
      sentInLastDay: sentInLastDay(this.world.gifts, me.id, now),
      lastRun: me.history[me.history.length - 1] ?? null,
      personalBest: Math.max(
        isRunning(status) ? status.elapsed : 0,
        ...me.history.map((r) => r.length),
        0,
      ),
      friends,
      recentGifts: [...this.world.gifts]
        .filter((g) => g.fromUserId === me.id || g.toUserId === me.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 12),
    };
  }

  private load(): World {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as World;
      } catch {
        // Corrupt payload: start over rather than trapping the user.
      }
    }
    const world = seedWorld(this.clock.now());
    this.world = world;
    this.persist();
    return world;
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.world));
    } catch {
      // Private mode or a full quota. The session still works in memory.
    }
  }

  /** Wipe local state. Backs the dev reset affordance. */
  reset(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
    this.world = seedWorld(this.clock.now());
    this.persist();
  }
}

/** The most recent lapse that has not already been bought back. */
function revivableRun(user: UserState): StreakRun | undefined {
  for (let i = user.history.length - 1; i >= 0; i--) {
    const run = user.history[i];
    if (run && run.reason === "lapsed" && run.revivedAt === undefined) return run;
  }
  return undefined;
}

function elapsedOf(streak: { streakStart: Seconds | null; lastSeen: Seconds }, now: Seconds): number {
  const status = statusOf(streak, now);
  return isRunning(status) ? status.elapsed : 0;
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    localStorage.setItem("uptime.probe", "1");
    localStorage.removeItem("uptime.probe");
    return localStorage;
  } catch {
    return null;
  }
}

interface SeedMember {
  id: string;
  handle: string;
  name: string;
  ageDays: number;
  startDaysAgo: number | null;
  lastSeenDaysAgo: number;
  lifetimeDays: number;
  history: Array<{ lengthDays: number; endedDaysAgo: number; reason: "lapsed" | "voluntary" }>;
}

/**
 * A small cast in deliberately varied states: one long-running, one inside the
 * nudge window, two lapsed and revivable. Enough to see every branch of the UI
 * without waiting sixty days for the window to matter.
 */
const SEED_CAST: SeedMember[] = [
  { id: "u_you", handle: "you", name: "You", ageDays: 240, startDaysAgo: 95, lastSeenDaysAgo: 0, lifetimeDays: 130, history: [{ lengthDays: 130, endedDaysAgo: 100, reason: "lapsed" }] },
  { id: "u_mara", handle: "mara", name: "Mara", ageDays: 500, startDaysAgo: 412, lastSeenDaysAgo: 0, lifetimeDays: 60, history: [] },
  { id: "u_tobi", handle: "tobi", name: "Tobi", ageDays: 300, startDaysAgo: 96, lastSeenDaysAgo: 55, lifetimeDays: 120, history: [] },
  { id: "u_jules", handle: "jules", name: "Jules", ageDays: 400, startDaysAgo: null, lastSeenDaysAgo: 70, lifetimeDays: 210, history: [{ lengthDays: 210, endedDaysAgo: 10, reason: "lapsed" }] },
  { id: "u_ren", handle: "ren", name: "Ren", ageDays: 90, startDaysAgo: 31, lastSeenDaysAgo: 2, lifetimeDays: 18, history: [{ lengthDays: 18, endedDaysAgo: 40, reason: "voluntary" }] },
  { id: "u_sol", handle: "sol", name: "Sol", ageDays: 220, startDaysAgo: null, lastSeenDaysAgo: 65, lifetimeDays: 340, history: [{ lengthDays: 340, endedDaysAgo: 5, reason: "lapsed" }] },
];

function seedWorld(now: Seconds): World {
  const users: Record<string, UserState> = {};

  for (const member of SEED_CAST) {
    users[member.id] = {
      id: member.id,
      handle: member.handle,
      displayName: member.name,
      createdAt: now - member.ageDays * DAY,
      streak: {
        streakStart: member.startDaysAgo === null ? null : now - member.startDaysAgo * DAY,
        lastSeen: now - member.lastSeenDaysAgo * DAY,
      },
      lifetimeSeconds: member.lifetimeDays * DAY,
      history: member.history.map((h) => ({
        startedAt: now - (h.endedDaysAgo + h.lengthDays) * DAY,
        endedAt: now - h.endedDaysAgo * DAY,
        length: h.lengthDays * DAY,
        reason: h.reason,
      })),
    };
  }

  const ids = Object.keys(users);
  const follows: string[] = [];
  for (const a of ids) {
    for (const b of ids) {
      if (a !== b) follows.push(followKey(a, b));
    }
  }

  const gifts: Gift[] = [
    { id: "g_seed_1", fromUserId: "u_mara", toUserId: "u_ren", amount: 2 * DAY, createdAt: now - 3 * DAY },
    { id: "g_seed_2", fromUserId: "u_ren", toUserId: "u_tobi", amount: 6 * 3600, createdAt: now - 9 * DAY },
  ];

  return { meId: ids[0]!, users, gifts, follows };
}
