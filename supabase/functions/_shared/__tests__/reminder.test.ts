import { describe, expect, it } from "vitest";
import { reminderEmail } from "../reminder.ts";

const DAY = 86400;
// Thursday 1 October 2026, 00:00 UTC.
const NOW = Date.UTC(2026, 9, 1) / 1000;

describe("the reminder email", () => {
  const facts = { display_name: "Dice", streak_start: NOW - 412 * DAY, deadline: NOW + 7 * DAY };

  it("says when the streak ends and how long it has run", () => {
    const mail = reminderEmail(facts, NOW);
    expect(mail.subject).toBe("Your streak ends in 7 days");
    expect(mail.text).toContain("running for 412 days");
    expect(mail.text).toContain("closes on Thursday, October 8");
  });

  it("says the one thing that keeps it going, and how to stop the email", () => {
    const mail = reminderEmail(facts, NOW);
    expect(mail.text).toContain("Opening Uptime once before then is all it takes");
    expect(mail.text).toContain("turn it off");
  });

  it("says tomorrow on the last day rather than 'in 1 days'", () => {
    expect(reminderEmail({ ...facts, deadline: NOW + DAY / 2 }, NOW).subject).toBe(
      "Your streak ends tomorrow",
    );
  });

  it("escapes a display name in the HTML, which is whatever its owner typed", () => {
    const mail = reminderEmail({ ...facts, display_name: '<img src=x onerror="a">' }, NOW);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });
});
