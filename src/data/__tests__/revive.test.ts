import { describe, expect, it } from "vitest";
import { isRevivable } from "../store";

/**
 * The two adapters spell "nothing to revive" differently, and only one of them
 * is reachable from a test without a network - which is exactly how the server
 * spelling went unnoticed. These pin both spellings against one predicate, so
 * the untestable adapter's shape is still covered by something.
 */
describe("isRevivable", () => {
  it("is false when the key is absent, the way the local adapter leaves it", () => {
    expect(isRevivable({})).toBe(false);
  });

  it("is false when the key is null, the way jsonb_build_object leaves it", () => {
    // The regression. `revive !== undefined` passes this, which offered a
    // Revive button for people whose clocks had never stopped.
    expect(isRevivable({ revive: null })).toBe(false);
  });

  it("is true only when there is an actual run to buy back", () => {
    expect(isRevivable({ revive: { lostLength: 86400, restores: 43200, cost: 21600 } })).toBe(true);
  });

  it("does not mistake a zero-cost revive for an absent one", () => {
    // Truthiness on the object, never on a field inside it: a free revive is
    // still a revive, and `cost` reaching 0 must not make the offer vanish.
    expect(isRevivable({ revive: { lostLength: 0, restores: 0, cost: 0 } })).toBe(true);
  });
});
