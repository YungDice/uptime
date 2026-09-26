import { describe, expect, it } from "vitest";
import { mailSettings, reminderEmail } from "../reminder.ts";

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

describe("choosing how the reminder is sent", () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  const gmail = {
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "465",
    SMTP_USER: "you@gmail.com",
    SMTP_PASS: "abcd efgh ijkl mnop",
    REMINDER_FROM: "Uptime <you@gmail.com>",
  };

  it("sends through Gmail's SMTP on 465, with the App Password's spaces taken out", () => {
    expect(mailSettings(env(gmail))).toEqual({
      kind: "smtp",
      host: "smtp.gmail.com",
      port: 465,
      user: "you@gmail.com",
      pass: "abcdefghijklmnop",
      from: "Uptime <you@gmail.com>",
      dailyLimit: 300,
    });
  });

  it("defaults to port 465 when none is given", () => {
    const { SMTP_PORT: _port, ...rest } = gmail;
    expect(mailSettings(env(rest))).toMatchObject({ kind: "smtp", port: 465 });
  });

  it.each(["25", "587"])("refuses port %s, which Edge Functions cannot reach", (port) => {
    const settings = mailSettings(env({ ...gmail, SMTP_PORT: port }));
    expect(settings.kind).toBe("off");
    if (settings.kind === "off") expect(settings.reason).toContain("465");
  });

  it("says what is missing rather than failing on the first send", () => {
    const { SMTP_PASS: _pass, ...rest } = gmail;
    const settings = mailSettings(env(rest));
    expect(settings.kind).toBe("off");
    if (settings.kind === "off") expect(settings.reason).toContain("SMTP_PASS");
  });

  it("takes a daily limit, to stay inside Gmail's 500 a day", () => {
    expect(mailSettings(env({ ...gmail, REMINDER_DAILY_LIMIT: "100" }))).toMatchObject({
      dailyLimit: 100,
    });
  });

  it("still sends through Resend when that is what is set", () => {
    expect(
      mailSettings(env({ RESEND_API_KEY: "re_x", REMINDER_FROM: "Uptime <r@example.com>" })),
    ).toEqual({ kind: "resend", key: "re_x", from: "Uptime <r@example.com>", dailyLimit: 1000 });
  });

  it("is off, and says how to turn it on, when nothing is set", () => {
    expect(mailSettings(env({})).kind).toBe("off");
  });
});
