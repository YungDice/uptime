import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  UPGRADE_PRICE,
  UPGRADE_TAG,
  checkoutParams,
  readUpgradeEvent,
  verifySignature,
} from "../stripe.ts";

const SECRET = "whsec_test_secret";
const NOW = 1_790_000_000;

/** A header built the way Stripe documents it, independently of the code under test. */
function header(payload: string, t = NOW, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

const PAID = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_a1",
      object: "checkout.session",
      client_reference_id: "00000000-0000-0000-0000-00000000000a",
      metadata: { uptime: UPGRADE_TAG, user_id: "00000000-0000-0000-0000-00000000000a" },
      payment_status: "paid",
      payment_intent: "pi_123",
      amount_total: 500,
      currency: "usd",
    },
  },
};

describe("verifySignature", () => {
  const body = JSON.stringify(PAID);

  it("accepts a body signed with the endpoint's secret", async () => {
    expect(await verifySignature(body, header(body), SECRET, NOW)).toBe(true);
  });

  it("accepts any matching v1 while a secret is being rolled", async () => {
    const rolled = `${header(body)},v1=${"0".repeat(64)}`;
    const reversed = `t=${NOW},v1=${"f".repeat(64)},${header(body).split(",")[1]}`;
    expect(await verifySignature(body, rolled, SECRET, NOW)).toBe(true);
    expect(await verifySignature(body, reversed, SECRET, NOW)).toBe(true);
  });

  it("refuses a body that was changed after signing", async () => {
    const tampered = body.replace('"amount_total":500', '"amount_total":1');
    expect(await verifySignature(tampered, header(body), SECRET, NOW)).toBe(false);
  });

  it("refuses the wrong secret", async () => {
    expect(await verifySignature(body, header(body, NOW, "whsec_other"), SECRET, NOW)).toBe(false);
  });

  it("refuses a replay older than the tolerance, and a timestamp from the future", async () => {
    expect(await verifySignature(body, header(body, NOW - 301), SECRET, NOW)).toBe(false);
    expect(await verifySignature(body, header(body, NOW + 301), SECRET, NOW)).toBe(false);
    expect(await verifySignature(body, header(body, NOW - 299), SECRET, NOW)).toBe(true);
  });

  it("refuses a missing or malformed header, and an empty secret", async () => {
    expect(await verifySignature(body, null, SECRET, NOW)).toBe(false);
    expect(await verifySignature(body, "", SECRET, NOW)).toBe(false);
    expect(await verifySignature(body, `t=${NOW}`, SECRET, NOW)).toBe(false);
    expect(await verifySignature(body, header(body).replace(/^t=\d+/, "t=abc"), SECRET, NOW)).toBe(false);
    expect(await verifySignature(body, header(body, NOW, ""), "", NOW)).toBe(false);
  });
});

describe("readUpgradeEvent", () => {
  it("grants on a paid checkout this app created", () => {
    expect(readUpgradeEvent(PAID)).toEqual({
      kind: "grant",
      sessionId: "cs_test_a1",
      userId: "00000000-0000-0000-0000-00000000000a",
      paymentIntent: "pi_123",
      amountCents: 500,
      currency: "usd",
    });
  });

  it("grants when the delayed payment finally settles", () => {
    const settled = { ...PAID, type: "checkout.session.async_payment_succeeded" };
    expect(readUpgradeEvent(settled).kind).toBe("grant");
  });

  it("waits on a checkout that completed unpaid", () => {
    const unpaid = { ...PAID, data: { object: { ...PAID.data.object, payment_status: "unpaid" } } };
    expect(readUpgradeEvent(unpaid)).toEqual({ kind: "ignore", reason: "not paid yet" });
  });

  it("ignores anything else sold on the same Stripe account", () => {
    const other = { ...PAID, data: { object: { ...PAID.data.object, metadata: {} } } };
    expect(readUpgradeEvent(other).kind).toBe("ignore");
  });

  it("takes the payment id from an expanded payment intent too", () => {
    const expanded = {
      ...PAID,
      data: { object: { ...PAID.data.object, payment_intent: { id: "pi_456", object: "payment_intent" } } },
    };
    const event = readUpgradeEvent(expanded);
    expect(event.kind === "grant" && event.paymentIntent).toBe("pi_456");
  });

  it("revokes on a full refund and not on a partial one", () => {
    const refund = (refunded: boolean) => ({
      type: "charge.refunded",
      data: { object: { id: "ch_1", payment_intent: "pi_123", refunded, amount_refunded: 500 } },
    });
    expect(readUpgradeEvent(refund(true))).toEqual({ kind: "revoke", paymentIntent: "pi_123" });
    expect(readUpgradeEvent(refund(false)).kind).toBe("ignore");
  });

  it("ignores events it does not handle, and junk", () => {
    expect(readUpgradeEvent({ type: "customer.created", data: { object: {} } }).kind).toBe("ignore");
    expect(readUpgradeEvent(null).kind).toBe("ignore");
    expect(readUpgradeEvent("nope").kind).toBe("ignore");
  });
});

describe("checkoutParams", () => {
  const params = checkoutParams({
    userId: "00000000-0000-0000-0000-00000000000a",
    email: "a@example.com",
    returnUrl: "https://example.com/uptime?from=app",
  });

  it("charges the server's price, once", () => {
    expect(params.get("mode")).toBe("payment");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe(String(UPGRADE_PRICE.amountCents));
    expect(params.get("line_items[0][price_data][currency]")).toBe(UPGRADE_PRICE.currency);
    expect(params.get("line_items[0][quantity]")).toBe("1");
    expect(UPGRADE_PRICE.amountCents).toBe(500);
  });

  it("names the account and tags the session and its payment", () => {
    expect(params.get("client_reference_id")).toBe("00000000-0000-0000-0000-00000000000a");
    expect(params.get("metadata[uptime]")).toBe(UPGRADE_TAG);
    expect(params.get("payment_intent_data[metadata][uptime]")).toBe(UPGRADE_TAG);
    expect(params.get("customer_email")).toBe("a@example.com");
  });

  it("returns to the configured page, keeping its own query", () => {
    expect(params.get("success_url")).toBe("https://example.com/uptime?from=app&checkout=done");
    expect(params.get("cancel_url")).toBe("https://example.com/uptime?from=app&checkout=cancelled");
  });

  it("leaves the email off when there is none", () => {
    const anonymousEmail = checkoutParams({
      userId: "u",
      email: null,
      returnUrl: "https://example.com/",
    });
    expect(anonymousEmail.has("customer_email")).toBe(false);
  });
});
