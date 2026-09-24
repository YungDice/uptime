import { describe, expect, it } from "vitest";
import { DAY, HOUR, MAX_SENT_PER_DAY } from "../constants";
import {
  checkGift,
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
} from "../economy";
import { statusOf, type StreakRecord } from "../streak";

const T0 = 1_700_000_000;

function gift(from: string, to: string, days: number, at = T0): Gift {
  return { id: from + to + at, fromUserId: from, toUserId: to, amount: days * DAY, createdAt: at };
}

function runningFor(seconds: number): StreakRecord {
  return { streakStart: T0 - seconds, lastSeen: T0 };
}

describe("sendable", () => {
  it("is everything on a running clock - there is no separate bank", () => {
    expect(sendable(statusOf(runningFor(95 * DAY), T0))).toBe(95 * DAY);
  });

  it("is nothing on a stopped clock", () => {
    expect(sendable(statusOf({ streakStart: null, lastSeen: T0 }, T0))).toBe(0);
  });

  it("is nothing on a clock whose window has run out, even before the sweep", () => {
    const lapsed = { streakStart: T0 - 200 * DAY, lastSeen: T0 - 61 * DAY };
    expect(sendable(statusOf(lapsed, T0))).toBe(0);
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
    senderBalance: 10 * DAY,
    sentInLastDay: 0,
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
    expect(refusal(HOUR, { ...base, senderBalance: 0 })).toBe("insufficient");
  });

  it("refuses a recipient whose clock is stopped, since there is nowhere to add it", () => {
    expect(refusal(HOUR, { ...base, recipientRunning: false })).toBe("recipient-stopped");
  });

  it("enforces the rolling daily cap", () => {
    expect(refusal(DAY, { ...base, senderBalance: 100 * DAY, sentInLastDay: MAX_SENT_PER_DAY })).toBe(
      "rate-limited",
    );
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
