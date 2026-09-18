import { describe, expect, it } from "vitest";
import { ACCRUAL_RATE, DAY, MAX_SENT_PER_DAY } from "../constants";
import {
  accrued,
  balance,
  checkGift,
  reviveCost,
  revivedLength,
  sentInLastDay,
  totalReceived,
  totalSent,
  type Gift,
  type GiftContext,
} from "../economy";

const T0 = 1_700_000_000;

function gift(from: string, to: string, days: number, at = T0): Gift {
  return { id: from + to + at, fromUserId: from, toUserId: to, amount: days * DAY, createdAt: at };
}

describe("accrual", () => {
  it("banks a fixed fraction of time kept", () => {
    expect(accrued(100 * DAY, 0)).toBe(Math.floor(100 * DAY * ACCRUAL_RATE));
  });

  it("counts the run in progress alongside finished ones", () => {
    expect(accrued(50 * DAY, 50 * DAY)).toBe(accrued(100 * DAY, 0));
  });
});

describe("balance", () => {
  it("adds gifts received and subtracts gifts sent", () => {
    const b = balance({ lifetimeSeconds: 100 * DAY, currentElapsed: 0, sent: 2 * DAY, received: 5 * DAY });
    expect(b).toBe(accrued(100 * DAY, 0) + 3 * DAY);
  });

  it("never renders negative", () => {
    expect(balance({ lifetimeSeconds: 0, currentElapsed: 0, sent: 10 * DAY, received: 0 })).toBe(0);
  });

  it("is separate from the streak, so giving time away never shortens the record", () => {
    const withGiving = balance({ lifetimeSeconds: 0, currentElapsed: 200 * DAY, sent: 20 * DAY, received: 0 });
    const withoutGiving = balance({ lifetimeSeconds: 0, currentElapsed: 200 * DAY, sent: 0, received: 0 });
    expect(withoutGiving - withGiving).toBe(20 * DAY);
  });
});

describe("revive pricing", () => {
  it("restores half the lost length", () => {
    expect(revivedLength(400 * DAY)).toBe(200 * DAY);
  });

  it("costs the banked time the restored stretch would itself have earned", () => {
    expect(reviveCost(400 * DAY)).toBe(20 * DAY);
  });

  it("prices a headline rescue beyond what one average user holds", () => {
    const soloBalance = balance({ lifetimeSeconds: 100 * DAY, currentElapsed: 0, sent: 0, received: 0 });
    expect(reviveCost(400 * DAY)).toBeGreaterThan(soloBalance);
  });
});

describe("checkGift", () => {
  const base: GiftContext = {
    senderBalance: 10 * DAY,
    sentInLastDay: 0,
    connected: true,
    isSelf: false,
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

  it("refuses an overdraft", () => {
    expect(refusal(20 * DAY, base)).toBe("insufficient");
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
