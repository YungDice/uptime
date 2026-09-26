// The reminder email's words, apart from the function that sends them, so a
// test can read them without starting a server. Plain TypeScript: runs in
// Deno for the function and in Node for the test.

export interface ReminderFacts {
  display_name: string;
  /** Epoch seconds the current run began. */
  streak_start: number;
  /** Epoch seconds the check-in window closes. */
  deadline: number;
}

/**
 * The email itself.
 *
 * Says what will happen and the one thing that stops it, in the app's own
 * plain voice. No urgency it has not earned: a week is a long time, and
 * PRODUCT.md is explicit that the product never nags.
 */
export function reminderEmail(
  facts: ReminderFacts,
  now: number,
): { subject: string; text: string; html: string } {
  const daysLeft = Math.max(1, Math.ceil((facts.deadline - now) / 86400));
  const days = Math.max(0, Math.floor((now - facts.streak_start) / 86400));
  const when = new Date(facts.deadline * 1000).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const ending = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`;
  const run = days === 1 ? "1 day" : `${days} days`;

  const lines = [
    `Hi ${facts.display_name},`,
    `Your Uptime clock has been running for ${run}. You haven't opened the app in a while, so your check-in window closes on ${when} - after that, the streak ends.`,
    "Opening Uptime once before then is all it takes. Nothing else to do.",
    "You get this email once per window, and only when a streak is close to ending. You can turn it off in Uptime, under Account.",
  ];

  return {
    subject: `Your streak ends ${ending}`,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
  };
}

/** A display name is whatever its owner typed, so it is escaped for HTML. */
function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&#39;",
    '"': "&quot;",
  };
  return value.replace(/[<>&'"]/g, (c) => map[c] as string);
}
