// Uptime: Stripe's word that the whole-clock upgrade was paid for, or refunded.
//
// The only thing that unlocks an account. `create-checkout` starts a payment;
// this records it once Stripe says it went through, and locks the account
// again on a full refund. Every request is checked against the endpoint's
// signing secret before anything is read from it.
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
// Secret:  supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//
// Then in the Stripe dashboard (Developers -> Webhooks), add an endpoint at
// `<project-url>/functions/v1/stripe-webhook` listening for:
//
//   checkout.session.completed
//   checkout.session.async_payment_succeeded
//   charge.refunded
//
// and copy its signing secret into STRIPE_WEBHOOK_SECRET. JWT verification is
// off for this function (config.toml) because Stripe has no Supabase session
// to send; the signature is the authentication.
//
// Stripe retries anything that is not a 2xx for up to three days, so a failed
// database write answers 500 and is simply tried again. Both writes are
// idempotent: a delivered-twice event unlocks, or locks, exactly once.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readUpgradeEvent, verifySignature } from "../_shared/stripe.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  if (secret.length === 0) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET is not set");
    return json({ error: "not configured" }, 503);
  }

  // The raw body: the signature is over these exact bytes.
  const payload = await req.text();
  const signed = await verifySignature(
    payload,
    req.headers.get("Stripe-Signature"),
    secret,
    Math.floor(Date.now() / 1000),
  );
  if (!signed) return json({ error: "bad signature" }, 400);

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "bad payload" }, 400);
  }

  const change = readUpgradeEvent(event);
  if (change.kind === "ignore") return json({ received: true, ignored: change.reason });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  if (change.kind === "grant") {
    const { data, error } = await admin.rpc("uptime_grant_whole_clock", {
      p_session: change.sessionId,
      p_user: change.userId,
      p_payment_intent: change.paymentIntent,
      p_amount_cents: change.amountCents,
      p_currency: change.currency,
    });
    if (error) {
      console.error("stripe-webhook: could not record the purchase", change.sessionId, error);
      return json({ error: "could not record the purchase" }, 500);
    }
    if (data !== true) {
      // Paid for an account that has since been deleted. Nothing to unlock;
      // retrying would not change that. Refund it from the dashboard.
      console.warn("stripe-webhook: paid for an account that no longer exists", change.userId, change.sessionId);
    } else {
      console.log("stripe-webhook: unlocked", change.userId, change.sessionId);
    }
    return json({ received: true });
  }

  const { data: revoked, error } = await admin.rpc("uptime_revoke_whole_clock", {
    p_payment_intent: change.paymentIntent,
  });
  if (error) {
    console.error("stripe-webhook: could not record the refund", change.paymentIntent, error);
    return json({ error: "could not record the refund" }, 500);
  }
  if (revoked) console.log("stripe-webhook: refunded, locked again", change.paymentIntent);
  return json({ received: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
