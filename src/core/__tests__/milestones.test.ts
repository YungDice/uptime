import { describe, expect, it } from "vitest";
import { DAY } from "../constants";
import { milestoneProgress } from "../milestones";

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
