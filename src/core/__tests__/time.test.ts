import { describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE } from "../constants";
import {
  SyncedClock,
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
  it("splits into days, a padded clock, and hundredths", () => {
    const p = splitStopwatch(95 * DAY + 4 * HOUR + 31 * MINUTE + 9 + 0.42);
    expect(p.days).toBe(95);
    expect(p.clock).toBe("04:31:09");
    expect(p.hundredths).toBe("42");
  });

  it("pads every field so the readout never changes width", () => {
    const p = splitStopwatch(1.05);
    expect(p.clock).toBe("00:00:01");
    expect(p.hundredths).toBe("05");
  });

  it("floors hundredths so seconds and hundredths never disagree", () => {
    // 1.999s must read 01 . 99, never 01 . 00 of the next second.
    const p = splitStopwatch(1.999);
    expect(p.clock).toBe("00:00:01");
    expect(p.hundredths).toBe("99");
  });

  it("clamps negatives", () => {
    const p = splitStopwatch(-3);
    expect(p.days).toBe(0);
    expect(p.clock).toBe("00:00:00");
    expect(p.hundredths).toBe("00");
  });
});

describe("splitStopwatch precision", () => {
  it("keeps hundredths exact at streak lengths that matter", () => {
    // A 412-day run: the float is large enough that a fractional subtraction
    // loses the hundredth. Every one of these must come back exact.
    for (const h of [0, 1, 5, 42, 99]) {
      const p = splitStopwatch(412 * DAY + 4 * HOUR + 31 * MINUTE + 9 + h / 100);
      expect(p.hundredths).toBe(String(h).padStart(2, "0"));
      expect(p.days).toBe(412);
      expect(p.clock).toBe("04:31:09");
    }
  });
});
