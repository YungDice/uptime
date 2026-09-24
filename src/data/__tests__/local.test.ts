import { beforeEach, describe, expect, it } from "vitest";
import { CHECK_IN_WINDOW, DAY, HOUR, MINUTE, isRunning, statusOf, toDays } from "@/core";
import { liveGiveable } from "../store";
import { LocalStore } from "../local";

/** A clock the test drives, so sixty-day windows take no real time. */
class TestClock {
  constructor(private t: number) {}
  now() {
    return this.t;
  }
  advance(seconds: number) {
    this.t += seconds;
  }
}

/** In-memory Storage stand-in, isolated per test. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const T0 = 1_700_000_000;

describe("LocalStore", () => {
  let clock: TestClock;
  let store: LocalStore;
  let sharedStorage: Storage;

  beforeEach(async () => {
    clock = new TestClock(T0);
    sharedStorage = memoryStorage();
    store = new LocalStore(clock, sharedStorage);
    await store.start("you");
  });

  it("signs in to a running streak and derives elapsed from the record", async () => {
    const snap = await store.refresh();
    expect(snap.me.handle).toBe("you");
    expect(isRunning(snap.status)).toBe(true);
    // Asserted in days, and against the record rather than a literal: the
    // seeded run starts part-way through a day so the stopwatch face has a
    // real time on it, and a hardcoded multiple would pin that detail here.
    if (isRunning(snap.status)) {
      expect(toDays(snap.status.elapsed)).toBe(95);
      expect(snap.status.elapsed).toBe(clock.now() - snap.me.streak.streakStart!);
    }
  });

  it("keeps the streak alive across a check-in but does not lengthen it", async () => {
    const before = await store.refresh();
    clock.advance(30 * DAY);
    const result = await store.checkIn();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.me.streak.streakStart).toBe(before.me.streak.streakStart);
    expect(result.snapshot.me.streak.lastSeen).toBe(clock.now());
  });

  it("lapses a streak once the window runs out, crediting only up to last seen", async () => {
    const before = await store.refresh();
    const startedAt = before.me.streak.streakStart!;
    const lastSeen = before.me.streak.lastSeen;

    clock.advance(CHECK_IN_WINDOW + DAY);
    const after = await store.refresh();

    expect(after.me.streak.streakStart).toBeNull();
    const filed = after.me.history[after.me.history.length - 1]!;
    expect(filed.reason).toBe("lapsed");
    expect(filed.length).toBe(lastSeen - startedAt);
    // Ended at the deadline, not when the sweep happened to notice.
    expect(filed.endedAt).toBe(lastSeen + CHECK_IN_WINDOW);
  });

  it("anchors the check-in window to the previous visit, not to this one", async () => {
    await store.refresh();
    clock.advance(40 * DAY);

    const snap = await store.refresh();
    // Opening refilled last_seen, but the bar has something true left to say.
    expect(snap.me.streak.lastSeen).toBe(clock.now());
    expect(snap.windowAnchor).toBe(clock.now() - 40 * DAY);
  });

  it("refills the window only when the user actually checks in", async () => {
    await store.refresh();
    clock.advance(40 * DAY);
    await store.refresh();

    const result = await store.checkIn();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.windowAnchor).toBe(clock.now());
  });

  it("can still explain a reset after the sweep has resolved the lapse", async () => {
    const before = await store.refresh();
    const ran = before.me.streak.lastSeen - before.me.streak.streakStart!;

    clock.advance(CHECK_IN_WINDOW + DAY);
    const snap = await store.refresh();

    // The transient `lapsed` status is already gone; the run is what explains it.
    expect(snap.status.kind).toBe("idle");
    expect(snap.lastRun?.reason).toBe("lapsed");
    expect(snap.lastRun?.length).toBe(ran);
    expect(toDays(snap.lastRun!.length)).toBe(95);
  });

  it("refuses to send more than the clock has on it", async () => {
    const snap = await store.refresh();
    const friend = snap.friends[0]!;
    const result = await store.sendTime(friend.profile.id, snap.balance + DAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/more than your clock/i);
  });

  it("takes sent time off the sender's clock and adds it to the recipient's", async () => {
    const before = await store.refresh();
    const friend = before.friends.find((f) => f.profile.handle === "mara")!;
    const theirStart = friend.streak.streakStart!;

    const result = await store.sendTime(friend.profile.id, DAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Mine: a day shorter. Theirs: a day longer. Nothing else about either
    // run moved - the time itself changed hands.
    expect(result.snapshot.me.streak.streakStart).toBe(before.me.streak.streakStart! + DAY);
    const after = result.snapshot.friends.find((f) => f.profile.id === friend.profile.id)!;
    expect(after.streak.streakStart).toBe(theirStart - DAY);

    expect(result.snapshot.balance).toBe(before.balance - DAY);
    expect(result.snapshot.totalSent).toBe(DAY);
    // The ledger still records it, for the boards and the audit trail.
    expect(result.snapshot.recentGifts[0]?.amount).toBe(DAY);
  });

  it("adds time somebody sends you onto your own clock", async () => {
    const before = await store.refresh();
    const asMara = new LocalStore(clock, sharedStorage);
    await asMara.start("mara");
    const sent = await asMara.sendTime(before.me.id, 3 * HOUR);
    expect(sent.ok).toBe(true);

    // The pulse is how an open app finds out, without a full read.
    const pulse = await store.pulse();
    expect(pulse.streakStart).toBe(before.me.streak.streakStart! - 3 * HOUR);
    expect(pulse.totalReceived).toBe(before.totalReceived + 3 * HOUR);

    const after = await store.refresh();
    expect(after.me.streak.streakStart).toBe(before.me.streak.streakStart! - 3 * HOUR);
    expect(after.balance).toBe(before.balance + 3 * HOUR);
  });

  it("does not treat a pulse as a sign of life", async () => {
    const before = await store.refresh();
    clock.advance(10 * DAY);
    await store.pulse();
    const after = await store.refresh();
    // The anchor is where last_seen stood before this refresh: untouched by
    // the pulse, so still ten days back.
    expect(after.windowAnchor).toBe(before.me.streak.lastSeen);
  });

  it("refuses to send to a clock that is not running", async () => {
    const snap = await store.refresh();
    const stopped = snap.friends.find(
      (f) => f.connected && !isRunning(statusOf(f.streak, clock.now())),
    )!;
    const result = await store.sendTime(stopped.profile.id, HOUR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/isn't running/i);
  });

  it("refuses to send when your own clock is stopped", async () => {
    const snap = await store.refresh();
    const friend = snap.friends.find((f) => f.profile.handle === "mara")!;
    await store.stopStreak();
    const result = await store.sendTime(friend.profile.id, HOUR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no time on it/i);
  });

  it("enforces the rolling daily cap across several gifts", async () => {
    const snap = await store.refresh();
    const friend = snap.friends[0]!;

    // The clock is ~95d, the cap is 7d a day. Three 2-day gifts fit; the
    // fourth would make 8.
    for (let i = 0; i < 3; i++) {
      expect((await store.sendTime(friend.profile.id, 2 * DAY)).ok).toBe(true);
    }
    const overCap = await store.sendTime(friend.profile.id, 2 * DAY);
    expect(overCap.ok).toBe(false);
    if (!overCap.ok) expect(overCap.message).toMatch(/limit|more today/i);
  });

  it("revives a broken streak at half length and charges the reviver", async () => {
    const before = await store.refresh();
    const broken = before.friends.find((f) => f.revive !== undefined)!;
    const { cost, restores } = broken.revive!;

    const result = await store.reviveFriend(broken.profile.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Paid off the reviver's own clock.
    expect(result.snapshot.balance).toBe(before.balance - cost);
    expect(result.snapshot.me.streak.streakStart).toBe(before.me.streak.streakStart! + cost);

    const revived = result.snapshot.friends.find((f) => f.profile.id === broken.profile.id)!;
    const status = statusOf(revived.streak, clock.now());
    expect(isRunning(status)).toBe(true);
    if (isRunning(status)) expect(status.elapsed).toBe(restores);
    // No longer offered for rescue, so the same run cannot be bought twice.
    expect(revived.revive).toBeUndefined();
  });

  it("refuses to revive when your own clock is stopped", async () => {
    const snap = await store.refresh();
    const broken = snap.friends.find((f) => f.revive !== undefined)!;
    await store.stopStreak();
    const result = await store.reviveFriend(broken.profile.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/isn't running/i);
  });

  it("counts a revive on the rescues board", async () => {
    const snap = await store.refresh();
    const broken = snap.friends.find((f) => f.revive !== undefined)!;
    await store.reviveFriend(broken.profile.id);

    const board = await store.board("most-revives");
    expect(board.find((e) => e.userId === snap.me.id)?.value).toBe(1);
  });

  it("lists a one-way follow but refuses to move time across it", async () => {
    // Drop the other side of the follow by unfollowing from their account.
    const other = (await store.refresh()).friends[0]!;
    const asThem = new LocalStore(clock, sharedStorage);
    await asThem.start(other.profile.handle);
    await asThem.unfollow((await store.refresh()).me.id);

    const snap = await store.refresh();
    const oneWay = snap.friends.find((f) => f.profile.id === other.profile.id)!;
    expect(oneWay.connected).toBe(false);

    const result = await store.sendTime(other.profile.id, 3600);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/both follow/i);
  });

  it("follows someone by handle and reports whether it is mutual yet", async () => {
    const other = (await store.refresh()).friends[0]!;
    await store.unfollow(other.profile.id);
    expect((await store.refresh()).friends.find((f) => f.profile.id === other.profile.id)?.connected).toBe(false);

    const result = await store.follow(other.profile.handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toMatch(/can now send/i);
  });

  it("refuses to follow an unknown handle or yourself", async () => {
    expect((await store.follow("nobody-here")).ok).toBe(false);
    expect((await store.follow("you")).ok).toBe(false);
  });

  it("keeps a voluntary stop in history as its own reason", async () => {
    const before = await store.refresh();
    const startedAt = before.me.streak.streakStart!;

    const result = await store.stopStreak();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const last = result.snapshot.me.history[result.snapshot.me.history.length - 1]!;
    expect(last.reason).toBe("voluntary");
    // A voluntary stop is credited right up to the moment of stopping.
    expect(last.length).toBe(clock.now() - startedAt);
    expect(toDays(last.length)).toBe(95);
    expect(result.snapshot.status.kind).toBe("idle");
  });

  it("survives a reload from storage", async () => {
    const storage = memoryStorage();
    const first = new LocalStore(clock, storage);
    await first.start("you");
    await first.sendTime((await first.refresh()).friends[0]!.profile.id, DAY);

    const second = new LocalStore(clock, storage);
    const snap = await second.start("you");
    expect(snap.totalSent).toBe(DAY);
  });

  it("works when storage is unavailable, as in a private window", async () => {
    const noStorage = new LocalStore(clock, null);
    const snap = await noStorage.start("you");
    expect(isRunning(snap.status)).toBe(true);
  });
});

describe("LocalStore accounts", () => {
  let clock: TestClock;
  let store: LocalStore;

  beforeEach(async () => {
    clock = new TestClock(T0);
    store = new LocalStore(clock, memoryStorage());
    await store.start("you");
  });

  it("starts a seeded session already signed in", async () => {
    const snap = await store.refresh();
    expect(snap.account.isAnonymous).toBe(false);
    expect(snap.account.email).toBe("you@example.com");
  });

  it("drops to a fresh anonymous clock on sign out", async () => {
    const result = await store.signOut();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.account.isAnonymous).toBe(true);
    expect(result.snapshot.account.email).toBeNull();
    // The app has to be usable without an account, so a clock still runs.
    expect(isRunning(result.snapshot.status)).toBe(true);
  });

  it("refuses to send time while anonymous", async () => {
    await store.signOut();
    const snap = await store.refresh();
    const friend = snap.friends[0];
    // A fresh anonymous account follows nobody, so reach past the friend gate
    // by naming a seeded id directly - the account check must fire first.
    const result = await store.sendTime(friend?.profile.id ?? "u_mara", 3600);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/create an account/i);
  });

  it("refuses to revive while anonymous", async () => {
    await store.signOut();
    const result = await store.reviveFriend("u_jules");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/create an account/i);
  });

  it("leaves anonymous accounts off every leaderboard", async () => {
    await store.signOut();
    const snap = await store.refresh();
    for (const board of ["current-streak", "longest-ever", "lifetime-total"] as const) {
      const rows = await store.board(board);
      expect(rows.some((r) => r.userId === snap.me.id)).toBe(false);
    }
    // The seeded cast still rank, so the board is not simply empty.
    expect((await store.board("current-streak")).length).toBeGreaterThan(0);
  });

  it("carries the streak across an upgrade rather than starting over", async () => {
    await store.signOut();
    const before = await store.refresh();
    const startedAt = before.me.streak.streakStart;
    clock.advance(3 * DAY);

    const result = await store.signUp("new@example.com", "longenough", "newcomer");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.account.isAnonymous).toBe(false);
    expect(result.snapshot.me.streak.streakStart).toBe(startedAt);
    expect(result.snapshot.me.handle).toBe("newcomer");
  });

  it("ranks the account as soon as it is no longer anonymous", async () => {
    await store.signOut();
    await store.signUp("new@example.com", "longenough", "newcomer");
    const snap = await store.refresh();
    const rows = await store.board("current-streak");
    expect(rows.some((r) => r.userId === snap.me.id)).toBe(true);
  });

  it("validates the email, the password and the handle", async () => {
    await store.signOut();
    expect((await store.signUp("nope", "longenough", "ok_handle")).ok).toBe(false);
    expect((await store.signUp("a@b.co", "short", "ok_handle")).ok).toBe(false);
    expect((await store.signUp("a@b.co", "longenough", "!!")).ok).toBe(false);
  });

  it("refuses a handle somebody already holds", async () => {
    const result = await store.setHandle("mara");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/taken/i);
  });

  it("signs back in to the same account and its streak", async () => {
    const before = await store.refresh();
    await store.signOut();
    const result = await store.signIn("you@example.com", "uptime-demo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.me.id).toBe(before.me.id);
    expect(result.snapshot.me.streak.streakStart).toBe(before.me.streak.streakStart);
  });

  it("refuses a wrong password", async () => {
    await store.signOut();
    expect((await store.signIn("you@example.com", "wrong")).ok).toBe(false);
  });

  // --- the giveable figure -------------------------------------------------

  it("is the running clock itself, so it grows second for second", async () => {
    const before = await store.refresh();
    const at = clock.now();
    clock.advance(HOUR);

    // No refresh in between: the figure has to be right from a snapshot taken
    // an hour ago, because on a running clock that is the only one there is.
    expect(liveGiveable(before, at + HOUR) - liveGiveable(before, at)).toBe(HOUR);
    expect(liveGiveable(before, at + HOUR)).toBe(at + HOUR - before.me.streak.streakStart!);
  });

  it("has nothing to send once the clock is stopped", async () => {
    await store.refresh();
    const stopped = await store.stopStreak();
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;

    // The run went into history. Time is sent off a running clock, and there
    // is no longer one to send it off.
    expect(liveGiveable(stopped.snapshot, clock.now())).toBe(0);
    expect(stopped.snapshot.balance).toBe(0);
  });

  it("agrees with the balance the adapter derives server-side", async () => {
    const snap = await store.refresh();
    expect(liveGiveable(snap, snap.serverNow)).toBe(snap.balance);
  });

  it("reads nothing to send once the window has run out, swept or not", async () => {
    // The window running out while the app is open flips the local status to
    // lapsed before any sweep files the run. Both readings have to agree that
    // the run is over and there is nothing left on the clock to give.
    const before = await store.refresh();
    clock.advance(CHECK_IN_WINDOW + DAY);
    expect(liveGiveable(before, clock.now())).toBe(0);

    const after = await store.refresh();
    expect(liveGiveable(after, clock.now())).toBe(0);
  });

  // --- other people's profiles ---------------------------------------------

  it("reads any account's public profile, connected or not", async () => {
    const snap = await store.refresh();
    const friend = snap.friends.find((f) => f.profile.handle === "mara");
    expect(friend).toBeDefined();
    if (!friend) return;

    const profile = await store.profile(friend.profile.id);
    expect(profile).not.toBeNull();
    if (!profile) return;

    expect(profile.profile.handle).toBe("mara");
    expect(profile.connected).toBe(true);
    expect(profile.iFollow).toBe(true);
    expect(profile.followsMe).toBe(true);
    // Their counter is derived from the record by the caller, exactly as the
    // viewer's own is, so the raw timestamps have to survive the trip.
    expect(profile.streak.streakStart).toBe(friend.streak.streakStart);
    expect(profile.personalBest).toBeGreaterThan(0);
  });

  it("reports which way a one-sided follow points", async () => {
    const snap = await store.refresh();
    const ivo = snap.friends.find((f) => f.profile.handle === "ivo");
    expect(ivo).toBeDefined();
    if (!ivo) return;

    const profile = await store.profile(ivo.profile.id);
    expect(profile?.followsMe).toBe(true);
    expect(profile?.iFollow).toBe(false);
    expect(profile?.connected).toBe(false);
  });

  it("prices a revive on a stranger's profile the same way the list does", async () => {
    const snap = await store.refresh();
    const broken = snap.friends.find((f) => f.revive !== undefined);
    expect(broken).toBeDefined();
    if (!broken?.revive) return;

    const profile = await store.profile(broken.profile.id);
    expect(profile?.revive?.cost).toBe(broken.revive.cost);
    expect(profile?.revive?.restores).toBe(broken.revive.restores);
  });

  it("returns null for an account that does not exist", async () => {
    expect(await store.profile("u_nobody")).toBeNull();
  });

  // --- sending small amounts ------------------------------------------------

  it("accepts a gift far smaller than a day", async () => {
    const snap = await store.refresh();
    const friend = snap.friends.find((f) => f.connected);
    expect(friend).toBeDefined();
    if (!friend) return;

    // Five minutes. The send sheet used to offer one hour as its smallest
    // preset, so this amount was unreachable through the interface even though
    // every rule below it allows the gift.
    const result = await store.sendTime(friend.profile.id, 5 * MINUTE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.totalSent).toBe(5 * MINUTE);
  });
});