import { describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE } from "../constants";
import { SyncedClock, formatDuration, formatElapsed, formatRemaining, toDays } from "../time";

describe("formatElapsed", () => {
  it("pads to fixed width so monospace digits never reflow", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(9)).toBe("00:00:09");
    expect(formatElapsed(HOUR + 2 * MINUTE + 3)).toBe("01:02:03");
  });

  it("prefixes days once there are any", () => {
    expect(formatElapsed(12 * DAY + 4 * HOUR + 31 * MINUTE + 9)).toBe("12d 04:31:09");
  });

  it("clamps negatives rather than rendering a minus sign", () => {
    expect(formatElapsed(-5)).toBe("00:00:00");
  });
});

describe("formatDuration", () => {
  it("picks a coarse unit for gifts and balances", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(45 * MINUTE)).toBe("45m");
    expect(formatDuration(18 * HOUR)).toBe("18h");
    expect(formatDuration(3 * DAY + 4 * HOUR)).toBe("3d 4h");
  });
});

describe("formatRemaining", () => {
  it("counts the check-in window down in days", () => {
    expect(formatRemaining(23 * DAY)).toBe("23 days left");
    expect(formatRemaining(DAY)).toBe("1 day left");
    expect(formatRemaining(0)).toBe("window closed");
  });
});

describe("SyncedClock", () => {
  it("corrects a device whose clock is wrong", () => {
    let deviceMs = 1_000_000_000_000;
    const clock = new SyncedClock(() => deviceMs);
    const serverNow = Math.floor(deviceMs / 1000) + 3600;
    clock.syncTo(serverNow);
    expect(clock.now()).toBe(serverNow);
    deviceMs += 5000;
    expect(clock.now()).toBe(serverNow + 5);
  });
});

describe("toDays", () => {
  it("floors", () => {
    expect(toDays(DAY + HOUR)).toBe(1);
    expect(toDays(HOUR)).toBe(0);
  });
});
