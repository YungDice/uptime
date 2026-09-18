import { beforeEach, describe, expect, it } from "vitest";
import { CHECK_IN_WINDOW, DAY, isRunning, statusOf, toDays } from "@/core";
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
    await store.signIn("you");
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

  it("refuses to send more than is banked", async () => {
    const snap = await store.refresh();
    const friend = snap.friends[0]!;
    const result = await store.sendTime(friend.profile.id, snap.balance + DAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/more than you have/i);
  });

  it("moves time between connected users without shortening the sender's streak", async () => {
    const before = await store.refresh();
    const friend = before.friends[0]!;

    const result = await store.sendTime(friend.profile.id, DAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.balance).toBe(before.balance - DAY);
    expect(result.snapshot.totalSent).toBe(DAY);
    // The record itself is untouched - the whole reason banked time is separate.
    expect(result.snapshot.me.streak.streakStart).toBe(before.me.streak.streakStart);
    if (isRunning(result.snapshot.status) && isRunning(before.status)) {
      expect(result.snapshot.status.elapsed).toBe(before.status.elapsed);
    }
  });

  it("enforces the rolling daily cap across several gifts", async () => {
    const snap = await store.refresh();
    const friend = snap.friends[0]!;

    // Balance is ~22d, cap is 7d/day. Four 2-day gifts fit; the fifth does not.
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

    expect(result.snapshot.balance).toBe(before.balance - cost);

    const revived = result.snapshot.friends.find((f) => f.profile.id === broken.profile.id)!;
    const status = statusOf(revived.streak, clock.now());
    expect(isRunning(status)).toBe(true);
    if (isRunning(status)) expect(status.elapsed).toBe(restores);
    // No longer offered for rescue, so the same run cannot be bought twice.
    expect(revived.revive).toBeUndefined();
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
    await asThem.signIn(other.profile.handle);
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
    await first.signIn("you");
    await first.sendTime((await first.refresh()).friends[0]!.profile.id, DAY);

    const second = new LocalStore(clock, storage);
    const snap = await second.signIn("you");
    expect(snap.totalSent).toBe(DAY);
  });

  it("works when storage is unavailable, as in a private window", async () => {
    const noStorage = new LocalStore(clock, null);
    const snap = await noStorage.signIn("you");
    expect(isRunning(snap.status)).toBe(true);
  });
});
