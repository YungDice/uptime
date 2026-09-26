import { describe, expect, it } from "vitest";
import { BOARDS, DAY, boardCreditFrom, countsTowardBoards } from "@/core";

describe("when a new account starts counting on the aged boards", () => {
  const user = { createdAt: 1_000_000 };

  it("is the same instant countsTowardBoards starts saying yes", () => {
    // The Boards tab quotes this date to people waiting on it, so it has to be
    // the day the board actually changes its mind, not a day either side.
    const from = boardCreditFrom(user);
    expect(countsTowardBoards(user, from - 1)).toBe(false);
    expect(countsTowardBoards(user, from)).toBe(true);
  });

  it("is fourteen days after sign-up", () => {
    expect(boardCreditFrom(user) - user.createdAt).toBe(14 * DAY);
  });

  it("is named on exactly the boards the SQL gates by account age", () => {
    // uptime_board_top filters on created_at for these two and no others.
    const gated = BOARDS.filter((b) => b.agedCredit !== undefined).map((b) => b.id);
    expect(gated).toEqual(["most-donated", "most-revives"]);
  });
});
