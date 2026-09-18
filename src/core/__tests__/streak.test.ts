import { describe, expect, it } from "vitest";
import { CHECK_IN_WINDOW, DAY, HOUR } from "../constants";
import {
  endRun,
  isRunning,
  reviveRun,
  runLength,
  startRun,
  statusOf,
  touch,
  windowEndsAt,
  windowFraction,
  type StreakRecord,
} from "../streak";

const T0 = 1_700_000_000;

function running(daysAgo: number, lastSeenDaysAgo = 0): StreakRecord {
  return { streakStart: T0 - daysAgo * DAY, lastSeen: T0 - lastSeenDaysAgo * DAY };
}

describe("statusOf", () => {
  it("reports idle when no run is in progress", () => {
    expect(statusOf({ streakStart: null, lastSeen: T0 }, T0)).toEqual({ kind: "idle" });
  });

  it("derives elapsed as now minus start, with nothing stored", () => {
    const status = statusOf(running(10), T0);
    expect(status.kind).toBe("alive");
    if (isRunning(status)) expect(status.elapsed).toBe(10 * DAY);
  });

  it("stays alive while the window is comfortably open", () => {
    expect(statusOf(running(100, 1), T0).kind).toBe("alive");
  });

  it("flags expiring once inside the nudge lead", () => {
    // Last seen 55 days ago: 5 days left of a 60-day window, inside the 7-day lead.
    expect(statusOf(running(100, 55), T0).kind).toBe("expiring");
  });

  it("lapses once the window has fully run out", () => {
    const status = statusOf(running(100, 61), T0);
    expect(status.kind).toBe("lapsed");
  });

  it("dates the lapse to the deadline, not to when it was noticed", () => {
    const record = running(100, 61);
    // Sweeper runs a week late; the streak still ended at the deadline.
    const late = statusOf(record, T0 + 7 * DAY);
    if (late.kind !== "lapsed") throw new Error("expected lapsed");
    expect(late.lapsedAt).toBe(windowEndsAt(record));
    expect(late.lapsedAt).toBe(record.lastSeen + CHECK_IN_WINDOW);
  });

  it("credits a lapsed run only up to last seen, not through the grace window", () => {
    const record = running(100, 61);
    const status = statusOf(record, T0);
    if (status.kind !== "lapsed") throw new Error("expected lapsed");
    // Ran 100 days, vanished at day 39. Credited 39, not 100 and not 99.
    expect(status.length).toBe(runLength(record.streakStart!, record.lastSeen));
    expect(status.length).toBe(39 * DAY);
  });
});

describe("touch", () => {
  it("keeps a nearly-lapsed streak alive", () => {
    const record = running(100, 59);
    expect(statusOf(record, T0).kind).toBe("expiring");
    expect(statusOf(touch(record, T0), T0).kind).toBe("alive");
  });

  it("does not move the start, so a check-in never inflates the streak", () => {
    const record = running(100, 10);
    expect(touch(record, T0).streakStart).toBe(record.streakStart);
  });
});

describe("windowFraction", () => {
  it("reads full right after a check-in", () => {
    expect(windowFraction({ streakStart: T0 - DAY, lastSeen: T0 }, T0)).toBe(1);
  });

  it("dims as the window runs down", () => {
    const halfway = windowFraction(running(100, 30), T0);
    expect(halfway).toBeCloseTo(0.5, 5);
  });

  it("bottoms out at zero rather than going negative", () => {
    expect(windowFraction(running(100, 90), T0)).toBe(0);
  });
});

describe("endRun", () => {
  it("files a lapse at the deadline and credits up to last seen", () => {
    const record = running(100, 61);
    const { record: next, run } = endRun(record, "lapsed", T0);
    expect(run).not.toBeNull();
    expect(run!.length).toBe(39 * DAY);
    expect(run!.endedAt).toBe(windowEndsAt(record));
    expect(next.streakStart).toBeNull();
  });

  it("credits a voluntary stop right up to the moment of stopping", () => {
    const record = running(100, 0);
    const { run } = endRun(record, "voluntary", T0);
    expect(run!.length).toBe(100 * DAY);
    expect(run!.reason).toBe("voluntary");
  });

  it("is a no-op when there is no run to end", () => {
    const { run } = endRun({ streakStart: null, lastSeen: T0 }, "reset", T0);
    expect(run).toBeNull();
  });
});

describe("startRun and reviveRun", () => {
  it("starts a run with the clock at zero", () => {
    const status = statusOf(startRun(T0), T0);
    if (!isRunning(status)) throw new Error("expected running");
    expect(status.elapsed).toBe(0);
  });

  it("backdates a revived streak so it resumes at the restored length", () => {
    const status = statusOf(reviveRun(200 * DAY, T0), T0);
    if (!isRunning(status)) throw new Error("expected running");
    expect(status.elapsed).toBe(200 * DAY);
  });

  it("resets the heartbeat, so a rescue is not immediately lapsed again", () => {
    const revived = reviveRun(200 * DAY, T0);
    expect(statusOf(revived, T0 + HOUR).kind).toBe("alive");
  });
});
