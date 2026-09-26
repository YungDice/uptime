import { describe, expect, it } from "vitest";
import { DAY } from "../constants";
import { milestonePassed, milestoneProgress } from "../milestones";

describe("milestoneProgress", () => {
  it("targets the first rung on a brand new streak", () => {
    const p = milestoneProgress(0);
    expect(p.previousDays).toBeNull();
    expect(p.nextDays).toBe(1);
  });

  it("spans the gap between rungs, not zero-to-next", () => {
    const p = milestoneProgress(95 * DAY);
    expect(p.previousDays).toBe(60);
    expect(p.nextDays).toBe(100);
    expect(p.fraction).toBeCloseTo(35 / 40, 5);
    expect(p.daysRemaining).toBe(5);
  });

  it("measures each rung against a wider span, so progress slows without lying", () => {
    expect(milestoneProgress(99.9 * DAY).fraction).toBeGreaterThan(0.9);
    expect(milestoneProgress(100.1 * DAY).fraction).toBeLessThan(0.05);
    expect(milestoneProgress(100.1 * DAY).nextDays).toBe(180);
  });

  it("saturates once the ladder is exhausted", () => {
    const p = milestoneProgress(5000 * DAY);
    expect(p.nextDays).toBeNull();
    expect(p.fraction).toBe(1);
  });
});

describe("milestonePassed", () => {
  it("names the rung crossed between two readings of a run", () => {
    expect(milestonePassed(95 * DAY, 101 * DAY)).toBe(100);
  });

  it("names the highest when several were crossed at once", () => {
    // Away for a long stretch of a young run: 1, 7 and 30 all went by.
    expect(milestonePassed(0.5 * DAY, 40 * DAY)).toBe(30);
  });

  it("is null when no rung was crossed", () => {
    expect(milestonePassed(101 * DAY, 150 * DAY)).toBeNull();
  });

  it("counts a rung reached exactly, and not one already behind", () => {
    expect(milestonePassed(99 * DAY, 100 * DAY)).toBe(100);
    expect(milestonePassed(100 * DAY, 120 * DAY)).toBeNull();
  });
});
