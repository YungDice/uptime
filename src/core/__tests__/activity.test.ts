import { describe, expect, it } from "vitest";
import { DAY, HOUR } from "../constants";
import { activityFor, isIncoming } from "../activity";
import { revivedLength, type Gift } from "../economy";
import type { StreakRun } from "../streak";

const T0 = 1_700_000_000;

function gift(overrides: Partial<Gift> & Pick<Gift, "fromUserId" | "toUserId">): Gift {
  return { id: `g_${Math.random()}`, amount: HOUR, createdAt: T0, ...overrides };
}

describe("activityFor", () => {
  it("names each side of a gift from this account's point of view", () => {
    const items = activityFor(
      "me",
      [
        gift({ id: "in", fromUserId: "mara", toUserId: "me", createdAt: T0 + 2 }),
        gift({ id: "out", fromUserId: "me", toUserId: "tobi", createdAt: T0 + 1 }),
      ],
      [],
    );

    expect(items.map((i) => [i.id, i.kind, i.otherId])).toEqual([
      ["in", "received", "mara"],
      ["out", "sent", "tobi"],
    ]);
  });

  it("puts the newest first whatever order the ledger came in", () => {
    const items = activityFor(
      "me",
      [
        gift({ id: "old", fromUserId: "mara", toUserId: "me", createdAt: T0 }),
        gift({ id: "new", fromUserId: "mara", toUserId: "me", createdAt: T0 + DAY }),
      ],
      [],
    );
    expect(items.map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("leaves out gifts between other people", () => {
    expect(activityFor("me", [gift({ fromUserId: "mara", toUserId: "ren" })], [])).toEqual([]);
  });

  it("treats a null revive marker as a plain gift, the way the SQL snapshot sends one", () => {
    const sqlShaped = { ...gift({ fromUserId: "mara", toUserId: "me" }), revivedStreakId: null };
    const [item] = activityFor("me", [sqlShaped as unknown as Gift], []);
    expect(item?.kind).toBe("received");
  });

  it("says what a revive of this account brought back, from the run it revived", () => {
    const run: StreakRun = {
      startedAt: T0 - 400 * DAY,
      endedAt: T0 - 10 * DAY,
      length: 390 * DAY,
      reason: "lapsed",
      revivedAt: T0,
    };
    const [item] = activityFor(
      "me",
      [gift({ fromUserId: "mara", toUserId: "me", amount: 19.5 * DAY, revivedStreakId: "r1" })],
      [run],
    );

    expect(item?.kind).toBe("revived-you");
    expect(item?.amount).toBe(19.5 * DAY);
    expect(item?.restored).toBe(revivedLength(390 * DAY));
  });

  it("leaves the restored figure off when the revived run cannot be found", () => {
    const [item] = activityFor(
      "me",
      [gift({ fromUserId: "mara", toUserId: "me", revivedStreakId: "r1" })],
      [],
    );
    expect(item?.kind).toBe("revived-you");
    expect(item && "restored" in item).toBe(false);
  });

  it("marks a revive this account paid for as outgoing, at its cost", () => {
    const [item] = activityFor(
      "me",
      [gift({ fromUserId: "me", toUserId: "jules", amount: 10 * DAY, revivedStreakId: "r1" })],
      [],
    );
    expect(item?.kind).toBe("you-revived");
    expect(item?.amount).toBe(10 * DAY);
    expect(item && isIncoming(item)).toBe(false);
  });
});

describe("isIncoming", () => {
  it("is true for what landed on this account and false for what left it", () => {
    const base = { id: "x", otherId: "y", amount: HOUR, at: T0 };
    expect(isIncoming({ ...base, kind: "received" })).toBe(true);
    expect(isIncoming({ ...base, kind: "revived-you" })).toBe(true);
    expect(isIncoming({ ...base, kind: "sent" })).toBe(false);
    expect(isIncoming({ ...base, kind: "you-revived" })).toBe(false);
  });
});
