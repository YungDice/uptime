import { describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE } from "../constants";
import {
  SyncedClock,
  formatAgo,
  formatDate,
  formatDuration,
  formatElapsed,
  formatRemaining,
  splitStopwatch,
  toDays,
} from "../time";

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

describe("formatAgo", () => {
  const now = 1_700_000_000;

  it("counts back in the coarsest unit that fits", () => {
    expect(formatAgo(now - 20, now)).toBe("just now");
    expect(formatAgo(now - 12 * MINUTE, now)).toBe("12 min ago");
    expect(formatAgo(now - 3 * HOUR, now)).toBe("3 hr ago");
    expect(formatAgo(now - DAY, now)).toBe("1 day ago");
    expect(formatAgo(now - 30 * DAY, now)).toBe("30 days ago");
  });

  it("switches to the date after a month", () => {
    expect(formatAgo(now - 31 * DAY, now)).toBe(formatDate(now - 31 * DAY));
  });

  it("reads a moment in the future, from clock skew, as just now", () => {
    expect(formatAgo(now + 5, now)).toBe("just now");
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

describe("splitStopwatch", () => {
  it("splits into days, then hours, minutes, seconds and milliseconds", () => {
    const p = splitStopwatch(95 * DAY + 4 * HOUR + 31 * MINUTE + 9 + 0.42);
    expect(p.days).toBe(95);
    expect([p.hours, p.minutes, p.seconds, p.millis]).toEqual(["04", "31", "09", "420"]);
    expect(p.clock).toBe("04:31:09");
  });

  it("pads every field so the readout never changes width", () => {
    const p = splitStopwatch(1.005);
    expect(p.clock).toBe("00:00:01");
    expect(p.millis).toBe("005");
  });

  it("never lets seconds and milliseconds disagree", () => {
    // 1.999s must read 01 : 999, never 01 : 000 of the next second.
    const p = splitStopwatch(1.999);
    expect(p.clock).toBe("00:00:01");
    expect(p.millis).toBe("999");
  });

  it("clamps negatives", () => {
    const p = splitStopwatch(-3);
    expect(p.days).toBe(0);
    expect(p.clock).toBe("00:00:00");
    expect(p.millis).toBe("000");
  });
});

describe("splitStopwatch precision", () => {
  it("keeps milliseconds exact at streak lengths that matter", () => {
    // A 412-day run: the float is large enough that a fractional subtraction
    // loses the millisecond. Every one of these must come back exact.
    for (const ms of [0, 1, 5, 42, 420, 999]) {
      const p = splitStopwatch(412 * DAY + 4 * HOUR + 31 * MINUTE + 9 + ms / 1000);
      expect(p.millis).toBe(String(ms).padStart(3, "0"));
      expect(p.days).toBe(412);
      expect(p.clock).toBe("04:31:09");
    }
  });
});
