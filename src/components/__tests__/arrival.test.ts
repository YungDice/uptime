import { describe, expect, it } from "vitest";
import { DAY, type Gift } from "@/core";
import type { Snapshot } from "@/data/store";
import { arrivalNotice } from "../Activity";

const NOW = 1_790_000_000;

/** The fields arrivalNotice reads, around a run and a last visit. */
function snapshot({
  startedDaysAgo,
  lastVisitDaysAgo,
  gifts = [],
}: {
  startedDaysAgo: number | null;
  lastVisitDaysAgo: number;
  gifts?: Gift[];
}): Snapshot {
  const me = {
    id: "me",
    handle: "me",
    displayName: "Me",
    avatarUrl: null,
    createdAt: NOW - 400 * DAY,
    streak: {
      streakStart: startedDaysAgo === null ? null : NOW - startedDaysAgo * DAY,
      lastSeen: NOW,
    },
    lifetimeSeconds: 0,
    history: [],
  };
  const mara = { ...me, id: "mara", handle: "mara", displayName: "Mara" };
  return {
    me,
    serverNow: NOW,
    windowAnchor: NOW - lastVisitDaysAgo * DAY,
    recentGifts: gifts,
    friends: [{ profile: mara, streak: mara.streak, connected: true, iFollow: true, followsMe: true }],
  } as unknown as Snapshot;
}

describe("the launch notice", () => {
  it("says a milestone passed while you were away", () => {
    expect(arrivalNotice(snapshot({ startedDaysAgo: 104, lastVisitDaysAgo: 10 }))).toBe(
      "While you were away, your streak passed 100 days.",
    );
  });

  it("says it alongside a gift", () => {
    const gift = { id: "g", fromUserId: "mara", toUserId: "me", amount: 2 * DAY, createdAt: NOW - DAY };
    expect(
      arrivalNotice(snapshot({ startedDaysAgo: 104, lastVisitDaysAgo: 10, gifts: [gift] })),
    ).toBe("While you were away, your streak passed 100 days, and Mara sent you 2d.");
  });

  it("says nothing when no milestone went by and nothing arrived", () => {
    expect(arrivalNotice(snapshot({ startedDaysAgo: 120, lastVisitDaysAgo: 10 }))).toBeNull();
  });

  it("does not credit a run that started after the last visit", () => {
    // A run begun since then was begun here, in front of its owner.
    expect(arrivalNotice(snapshot({ startedDaysAgo: 2, lastVisitDaysAgo: 5 }))).toBeNull();
  });

  it("says nothing about milestones on a stopped clock", () => {
    expect(arrivalNotice(snapshot({ startedDaysAgo: null, lastVisitDaysAgo: 10 }))).toBeNull();
  });
});
