// Uptime: Stripe, for the whole-clock upgrade.
//
// The price, the Checkout Session, and reading the webhook - the parts of the
// purchase that are rules rather than plumbing. No Stripe SDK and no Deno
// APIs, only URLSearchParams and Web Crypto, so the same file runs inside both
// Edge Functions and under vitest (`__tests__/stripe.test.ts`).

/**
 * What the upgrade costs, and the only place that decides it.
 *
 * The client shows `WHOLE_CLOCK_PRICE_LABEL` from src/core/constants.ts but
 * never names an amount: the session is priced here, server-side, so a client
 * cannot choose what it pays. Change the two together.
 */
export const UPGRADE_PRICE = { amountCents: 500, currency: "usd" } as const;

/**
 * Stamped on every session this app creates.
 *
 * A Stripe webhook endpoint hears about every checkout on the account, and the
 * account may sell other things. Only a session carrying this tag unlocks
 * anything.
 */
export const UPGRADE_TAG = "whole-clock";

/** How old a signed webhook may be before it is refused as a replay. Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface CheckoutFor {
  userId: string;
  /** Prefills the payment form; the receipt goes here. */
  email: string | null;
  /** Where Stripe sends the browser afterwards. See `CHECKOUT_RETURN_URL`. */
  returnUrl: string;
}

/**
 * The form body for `POST /v1/checkout/sessions`.
 *
 * The account rides as `client_reference_id`, taken from the caller's verified
 * token by the function - never from anything the client sent - and the tag
 * rides in the metadata of both the session and its payment, so a refund can be
 * traced back from the payment alone.
 */
export function checkoutParams({ userId, email, returnUrl }: CheckoutFor): URLSearchParams {
  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": UPGRADE_PRICE.currency,
    "line_items[0][price_data][unit_amount]": String(UPGRADE_PRICE.amountCents),
    "line_items[0][price_data][product_data][name]": "Uptime: send your whole clock",
    "line_items[0][price_data][product_data][description]":
      "Send everything on your clock to a friend, not just 6 minutes for every hour. One payment, yours for good.",
    client_reference_id: userId,
    "metadata[uptime]": UPGRADE_TAG,
    "metadata[user_id]": userId,
    "payment_intent_data[metadata][uptime]": UPGRADE_TAG,
    "payment_intent_data[metadata][user_id]": userId,
    success_url: withParam(returnUrl, "checkout", "done"),
    cancel_url: withParam(returnUrl, "checkout", "cancelled"),
  });
  if (email) params.set("customer_email", email);
  return params;
}

function withParam(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

/** What one webhook event means for the upgrade. */
export type UpgradeEvent =
  | {
      kind: "grant";
      sessionId: string;
      userId: string;
      paymentIntent: string | null;
      amountCents: number;
      currency: string;
    }
  | { kind: "revoke"; paymentIntent: string }
  | { kind: "ignore"; reason: string };

/**
 * Read a verified webhook event.
 *
 * Two events can unlock: `checkout.session.completed` for a card, which is paid
 * by the time it fires, and `checkout.session.async_payment_succeeded` for the
 * methods that settle later - their `completed` event arrives unpaid and is
 * skipped here. A full refund locks the account again; a partial one does not.
 * Everything else, including every checkout this app did not create, is
 * acknowledged and ignored.
 */
export function readUpgradeEvent(event: unknown): UpgradeEvent {
  const type = field(event, "type");
  const object = field(field(event, "data"), "object");

  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    if (field(field(object, "metadata"), "uptime") !== UPGRADE_TAG) {
      return { kind: "ignore", reason: "not an Uptime checkout" };
    }
    if (field(object, "payment_status") !== "paid") {
      return { kind: "ignore", reason: "not paid yet" };
    }
    const sessionId = field(object, "id");
    const userId = field(object, "client_reference_id");
    if (typeof sessionId !== "string" || typeof userId !== "string") {
      return { kind: "ignore", reason: "no session or account on the event" };
    }
    const intent = field(object, "payment_intent");
    const amount = field(object, "amount_total");
    const currency = field(object, "currency");
    return {
      kind: "grant",
      sessionId,
      userId,
      // Expanded on some API versions, a bare id on others.
      paymentIntent:
        typeof intent === "string"
          ? intent
          : typeof field(intent, "id") === "string"
            ? (field(intent, "id") as string)
            : null,
      amountCents: typeof amount === "number" ? amount : 0,
      currency: typeof currency === "string" ? currency : UPGRADE_PRICE.currency,
    };
  }

  if (type === "charge.refunded") {
    const intent = field(object, "payment_intent");
    if (field(object, "refunded") !== true) {
      return { kind: "ignore", reason: "partial refund" };
    }
    if (typeof intent !== "string") {
      return { kind: "ignore", reason: "refund with no payment to trace" };
    }
    // Not filtered by tag: a refund of anything else matches no purchase, so
    // the revoke is a no-op for it.
    return { kind: "revoke", paymentIntent: intent };
  }

  return { kind: "ignore", reason: `unhandled event ${String(type)}` };
}

/**
 * Whether a webhook body really came from Stripe.
 *
 * The `Stripe-Signature` header is `t=<unix time>,v1=<hex HMAC>[,v1=...]`: an
 * HMAC-SHA256 of `<t>.<raw body>` under the endpoint's signing secret. More
 * than one `v1` appears while a secret is being rolled, and any of them may
 * match. The timestamp is inside the signature, so refusing an old one is what
 * stops a captured request being replayed later.
 *
 * `payload` must be the raw body as received - parsed and re-serialised JSON
 * is not byte-identical and will not verify.
 */
export async function verifySignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!header || !secret) return false;

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares every character, so the time taken says nothing about where two strings differ. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
