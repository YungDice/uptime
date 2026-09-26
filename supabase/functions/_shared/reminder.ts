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

/**
 * How the reminder goes out, read from the function's secrets.
 *
 * Two routes. SMTP - Gmail with an App Password, or any mail server - and
 * Resend's HTTP API. SMTP wins when both are set, since it is the one that
 * also carries the project's sign-up and reset mail and so is known to work.
 */
export type MailSettings =
  | {
      kind: "smtp";
      host: string;
      port: number;
      user: string;
      pass: string;
      from: string;
      dailyLimit: number;
    }
  | { kind: "resend"; key: string; from: string; dailyLimit: number }
  | { kind: "off"; reason: string };

/**
 * Ports Supabase Edge Functions may not connect out to.
 *
 * https://supabase.com/docs/guides/functions/limits - 465 is open, and it is
 * the port Gmail serves SMTP over TLS on. A send to either of these does not
 * fail, it hangs until the function is killed, so they are refused up front.
 */
const BLOCKED_PORTS = [25, 587];

/**
 * Reminders per run when nothing says otherwise.
 *
 * SMTP's is low because it is usually Gmail, which allows about 500 messages
 * a day for the whole account - and Supabase Auth's confirmation and reset
 * emails come out of the same 500. Anyone left over is still inside their
 * week and is reached on the next day's run.
 */
const DEFAULT_LIMIT = { smtp: 300, resend: 1000 };

export function mailSettings(env: (name: string) => string | undefined): MailSettings {
  const from = env("REMINDER_FROM");
  const limit = (fallback: number) => {
    const wanted = Number(env("REMINDER_DAILY_LIMIT"));
    return Number.isFinite(wanted) && wanted > 0 ? Math.floor(wanted) : fallback;
  };

  const host = env("SMTP_HOST");
  if (host) {
    const user = env("SMTP_USER");
    const pass = env("SMTP_PASS");
    const port = Number(env("SMTP_PORT") ?? 465);
    const missing = [
      ["SMTP_USER", user],
      ["SMTP_PASS", pass],
      ["REMINDER_FROM", from],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0 || !user || !pass || !from) {
      return { kind: "off", reason: `SMTP_HOST is set but ${missing.join(", ")} is not` };
    }
    if (!Number.isInteger(port) || BLOCKED_PORTS.includes(port)) {
      return {
        kind: "off",
        reason: `Supabase Edge Functions cannot send on port ${env("SMTP_PORT")}. Use 465.`,
      };
    }
    return {
      kind: "smtp",
      host,
      port,
      user,
      // Google shows an App Password as four groups of four. The spaces are
      // not part of it, and pasting them in is the usual way it gets refused.
      pass: pass.replace(/\s+/g, ""),
      from,
      dailyLimit: limit(DEFAULT_LIMIT.smtp),
    };
  }

  const key = env("RESEND_API_KEY");
  if (key && from) return { kind: "resend", key, from, dailyLimit: limit(DEFAULT_LIMIT.resend) };

  return {
    kind: "off",
    reason:
      "Set SMTP_HOST, SMTP_USER, SMTP_PASS and REMINDER_FROM - or RESEND_API_KEY and REMINDER_FROM",
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
