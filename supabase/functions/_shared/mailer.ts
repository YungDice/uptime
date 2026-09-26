// Sending one email, by whichever route the secrets name (see mailSettings in
// reminder.ts). Deno only: it imports nodemailer by npm specifier, which is
// why it is apart from reminder.ts, whose tests run in Node.

import nodemailer from "npm:nodemailer@^9";
import type { MailSettings } from "./reminder.ts";

export interface Message {
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** How many sends may be in flight at once on this route. */
  concurrency: number;
  /**
   * True once the message was accepted for delivery.
   *
   * `once` names this message for good. Resend uses it to refuse a duplicate
   * if a run sends and then fails to record that it did; SMTP has no such
   * thing, so there a failed record can mean a second copy the next day.
   */
  send(to: string, message: Message, once: string): Promise<boolean>;
  close(): void;
}

export function openMailer(
  settings: Exclude<MailSettings, { kind: "off" }>,
): Mailer {
  if (settings.kind === "smtp") {
    // One pooled connection set, reused for the whole run: a fresh TLS login
    // per message is slow, and Gmail treats a burst of them as suspicious.
    // 465 is SMTP over TLS from the first byte; any other port starts plain
    // and upgrades with STARTTLS.
    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      auth: { user: settings.user, pass: settings.pass },
      pool: true,
      maxConnections: 3,
    });
    return {
      concurrency: 3,
      async send(to, message) {
        try {
          await transport.sendMail({ from: settings.from, to, ...message });
          return true;
        } catch (err) {
          console.error("smtp send failed", err instanceof Error ? err.message : err);
          return false;
        }
      },
      close: () => transport.close(),
    };
  }

  return {
    concurrency: 16,
    async send(to, message, once) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${settings.key}`,
            "content-type": "application/json",
            "Idempotency-Key": once,
          },
          body: JSON.stringify({ from: settings.from, to: [to], ...message }),
        });
        if (!res.ok) console.error("resend", res.status, await res.text());
        return res.ok;
      } catch (err) {
        console.error("resend send failed", err);
        return false;
      }
    },
    close: () => {},
  };
}
