import { describe, expect, it } from "vitest";
import { DAY, HOUR, MAX_SENT_PER_DAY, MINUTE } from "../constants";
import {
  checkGift,
  clockTime,
  reviveCost,
  revivedLength,
  sendable,
  sentInLastDay,
  spend,
  totalReceived,
  totalSent,
  transfer,
  type Gift,
  type GiftContext,
  type SendRights,
} from "../economy";
import { endRun, reviveRun, startRun, statusOf, touch, type StreakRecord } from "../streak";

const T0 = 1_700_000_000;

function gift(from: string, to: string, days: number, at = T0): Gift {
  return { id: from + to + at, fromUserId: from, toUserId: to, amount: days * DAY, createdAt: at };
}

function runningFor(seconds: number): StreakRecord {
  return { streakStart: T0 - seconds, lastSeen: T0 };
}

const FREE: SendRights = { sendsWholeClock: false, sentThisRun: 0 };
const WHOLE: SendRights = { sendsWholeClock: true, sentThisRun: 0 };

describe("clockTime", () => {
  it("is everything on a running clock - there is no separate bank", () => {
    expect(clockTime(statusOf(runningFor(95 * DAY), T0))).toBe(95 * DAY);
  });

  it("is nothing on a stopped clock", () => {
    expect(clockTime(statusOf({ streakStart: null, lastSeen: T0 }, T0))).toBe(0);
  });

  it("is nothing on a clock whose window has run out, even before the sweep", () => {
    const lapsed = { streakStart: T0 - 200 * DAY, lastSeen: T0 - 61 * DAY };
    expect(clockTime(statusOf(lapsed, T0))).toBe(0);
  });
});

describe("sendable", () => {
  it("is the whole clock with the upgrade", () => {
    expect(sendable(statusOf(runningFor(95 * DAY), T0), WHOLE)).toBe(95 * DAY);
  });

  it("is six minutes for every hour on the clock without it", () => {
    expect(sendable(statusOf(runningFor(HOUR), T0), FREE)).toBe(6 * MINUTE);
    expect(sendable(statusOf(runningFor(100 * HOUR), T0), FREE)).toBe(10 * HOUR);
  });

  it("is nothing on a stopped or lapsed clock, upgrade or not", () => {
    const stopped = statusOf({ streakStart: null, lastSeen: T0 }, T0);
    const lapsed = statusOf({ streakStart: T0 - 200 * DAY, lastSeen: T0 - 61 * DAY }, T0);
    for (const rights of [FREE, WHOLE]) {
      expect(sendable(stopped, rights)).toBe(0);
      expect(sendable(lapsed, rights)).toBe(0);
    }
  });

  it("goes down by exactly what was sent, because sending does not change what the run has held", () => {
    let from = runningFor(100 * HOUR);
    const to = runningFor(DAY);
    const before = sendable(statusOf(from, T0), { ...FREE, sentThisRun: from.sentThisRun ?? 0 });
    from = transfer(from, to, 3 * HOUR, T0).from;
    const after = sendable(statusOf(from, T0), { ...FREE, sentThisRun: from.sentThisRun ?? 0 });
    expect(before - after).toBe(3 * HOUR);
  });

  it("cannot be walked down to an empty clock a tenth at a time", () => {
    // The loophole a share of the clock *as it now reads* would have: send a
    // tenth, then a tenth of what is left, and so on. Counted across the run,
    // the tenth is spent once and then there is nothing.
    let from = runningFor(100 * HOUR);
    let to = runningFor(DAY);
    let sent = 0;
    for (let i = 0; i < 50; i++) {
      const share = sendable(statusOf(from, T0), { ...FREE, sentThisRun: from.sentThisRun ?? 0 });
      if (share <= 0) break;
      ({ from, to } = transfer(from, to, share, T0));
      sent += share;
    }
    expect(sent).toBe(10 * HOUR);
    expect(clockTime(statusOf(from, T0))).toBe(90 * HOUR);
  });

  it("grows by a tenth of any time received, like any other time on the clock", () => {
    const mine = runningFor(10 * HOUR);
    const received = transfer(runningFor(50 * HOUR), mine, 20 * HOUR, T0).to;
    expect(sendable(statusOf(received, T0), FREE)).toBe(3 * HOUR);
  });

  it("is never negative, even when more was sent than the share now covers", () => {
    // Possible after a refund takes the upgrade away mid-run.
    expect(sendable(statusOf(runningFor(10 * HOUR), T0), { ...FREE, sentThisRun: 50 * HOUR })).toBe(0);
  });
});

describe("sentThisRun", () => {
  it("counts gifts on the sender only", () => {
    const moved = transfer(runningFor(10 * DAY), runningFor(DAY), HOUR, T0);
    expect(moved.from.sentThisRun).toBe(HOUR);
    expect(moved.to.sentThisRun).toBeUndefined();
    expect(transfer(moved.from, runningFor(DAY), HOUR, T0).from.sentThisRun).toBe(2 * HOUR);
  });

  it("does not count a revive's price, which only shrinks the clock", () => {
    const sent = { ...runningFor(10 * DAY), sentThisRun: HOUR };
    expect(spend(sent, DAY, T0).sentThisRun).toBe(HOUR);
  });

  it("survives a check-in", () => {
    expect(touch({ ...runningFor(DAY), sentThisRun: HOUR }, T0 + 5).sentThisRun).toBe(HOUR);
  });

  it("starts from nothing on every new run, however the last one ended", () => {
    const spent = { ...runningFor(10 * DAY), sentThisRun: DAY };
    expect(endRun(spent, "voluntary", T0).record.sentThisRun ?? 0).toBe(0);
    expect(endRun(spent, "lapsed", T0).record.sentThisRun ?? 0).toBe(0);
    expect(startRun(T0).sentThisRun ?? 0).toBe(0);
    expect(reviveRun(5 * DAY, T0).sentThisRun ?? 0).toBe(0);
  });
});

describe("transfer", () => {
  it("takes time off the sender's clock and puts it on the recipient's", () => {
    const from = runningFor(95 * DAY);
    const to = runningFor(10 * DAY);
    const moved = transfer(from, to, DAY, T0);

    expect(T0 - moved.from.streakStart!).toBe(94 * DAY);
    expect(T0 - moved.to.streakStart!).toBe(11 * DAY);
  });

  it("conserves time: what one clock loses the other gains", () => {
    const from = runningFor(40 * DAY);
    const to = runningFor(3 * HOUR);
    const moved = transfer(from, to, 5 * HOUR, T0);
    const before = T0 - from.streakStart! + (T0 - to.streakStart!);
    const after = T0 - moved.from.streakStart! + (T0 - moved.to.streakStart!);
    expect(after).toBe(before);
  });

  it("counts as a sign of life on both sides", () => {
    const moved = transfer(runningFor(DAY), runningFor(DAY), HOUR, T0 + 5);
    expect(moved.from.lastSeen).toBe(T0 + 5);
    expect(moved.to.lastSeen).toBe(T0 + 5);
  });

  it("refuses to move time to or from a stopped clock", () => {
    const stopped = { streakStart: null, lastSeen: T0 };
    expect(() => transfer(stopped, runningFor(DAY), HOUR, T0)).toThrow();
    expect(() => transfer(runningFor(DAY), stopped, HOUR, T0)).toThrow();
  });
});

describe("spend", () => {
  it("takes the price off the clock without handing it to anyone", () => {
    const paid = spend(runningFor(30 * DAY), 2 * DAY, T0);
    expect(T0 - paid.streakStart!).toBe(28 * DAY);
  });
});

describe("revive pricing", () => {
  it("restores half the lost length", () => {
    expect(revivedLength(400 * DAY)).toBe(200 * DAY);
  });

  it("costs the reviver a tenth of what it restores", () => {
    expect(reviveCost(400 * DAY)).toBe(20 * DAY);
  });
});

describe("checkGift", () => {
  const base: GiftContext = {
    senderClock: 10 * DAY,
    senderBalance: 10 * DAY,
    sentInLastDay: 0,
    sendsWholeClock: false,
    connected: true,
    isSelf: false,
    recipientRunning: true,
  };

  function refusal(amount: number, ctx: GiftContext): string {
    const result = checkGift(amount, ctx);
    if (result.ok) throw new Error("expected a refusal");
    return result.reason;
  }

  it("allows a normal gift between connected users", () => {
    expect(checkGift(DAY, base)).toEqual({ ok: true });
  });

  it("refuses strangers, killing the throwaway-account loop", () => {
    expect(refusal(DAY, { ...base, connected: false })).toBe("not-connected");
  });

  it("refuses self-gifting", () => {
    expect(refusal(DAY, { ...base, isSelf: true })).toBe("self");
  });

  it("refuses more than the sender's clock has on it", () => {
    expect(refusal(20 * DAY, base)).toBe("insufficient");
  });

  it("refuses a sender whose clock is stopped", () => {
    expect(refusal(HOUR, { ...base, senderClock: 0, senderBalance: 0 })).toBe("insufficient");
  });

  it("names the free share when the clock has the time and the share does not", () => {
    const free = { ...base, senderClock: 100 * HOUR, senderBalance: 10 * HOUR };
    expect(refusal(11 * HOUR, free)).toBe("free-share");
    const result = checkGift(11 * HOUR, free);
    if (!result.ok) expect(result.message).toMatch(/6 minutes for every hour.*10h right now/);
  });

  it("says so when the free share is used up", () => {
    const result = checkGift(MINUTE, { ...base, senderClock: 90 * HOUR, senderBalance: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("free-share");
      expect(result.message).toMatch(/sent all a free account can/);
    }
  });

  it("refuses a recipient whose clock is stopped, since there is nowhere to add it", () => {
    expect(refusal(HOUR, { ...base, recipientRunning: false })).toBe("recipient-stopped");
  });

  it("enforces the rolling daily cap", () => {
    expect(refusal(DAY, { ...base, senderClock: 100 * DAY, senderBalance: 100 * DAY, sentInLastDay: MAX_SENT_PER_DAY })).toBe(
      "rate-limited",
    );
  });

  it("lifts the daily cap for the whole-clock upgrade", () => {
    const paid = {
      ...base,
      senderClock: 100 * DAY,
      senderBalance: 100 * DAY,
      sendsWholeClock: true,
    };
    // A 60-day gift in one go, and another straight after.
    expect(checkGift(60 * DAY, paid)).toEqual({ ok: true });
    expect(checkGift(30 * DAY, { ...paid, sentInLastDay: 60 * DAY })).toEqual({ ok: true });
    // The clock itself is still the ceiling.
    expect(refusal(101 * DAY, paid)).toBe("insufficient");
  });

  it("refuses zero, negative and fractional amounts", () => {
    for (const bad of [0, -DAY, 1.5]) {
      expect(refusal(bad, base)).toBe("invalid-amount");
    }
  });
});

describe("ledger sums", () => {
  const gifts = [gift("a", "b", 3), gift("a", "c", 2, T0 - 2 * DAY), gift("b", "a", 1)];

  it("sums sent and received from rows alone", () => {
    expect(totalSent(gifts, "a")).toBe(5 * DAY);
    expect(totalReceived(gifts, "a")).toBe(1 * DAY);
  });

  it("counts only the last 24 hours toward the cap", () => {
    expect(sentInLastDay(gifts, "a", T0)).toBe(3 * DAY);
  });
});
