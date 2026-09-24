// Uptime: start buying the whole-clock upgrade.
//
// Free accounts can send 6 minutes for every hour on their clock; this sells
// the right to send all of it, once, for UPGRADE_PRICE. The app calls this
// with the user's session, gets back a Stripe Checkout URL and opens it in the
// browser. Nothing is unlocked here - that is `stripe-webhook`'s job, on
// Stripe's signed word that the payment went through.
//
// Deploy:  supabase functions deploy create-checkout
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_live_... \
//                               CHECKOUT_RETURN_URL=https://...
//
// CHECKOUT_RETURN_URL is where the browser lands after paying or cancelling,
// with `?checkout=done` or `?checkout=cancelled` added. It is fixed here
// rather than sent by the client, so nobody can mint a real Stripe page that
// hands its payer on to a site of their choosing.
//
// JWT verification stays on (the default): only a signed-in session reaches
// this, and the account is read from that session's own token.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { checkoutParams } from "../_shared/stripe.ts";

// The browser build calls this cross-origin, and so does the desktop shell,
// whose pages are served from its own origin.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const returnUrl = Deno.env.get("CHECKOUT_RETURN_URL") ?? "";
  if (stripeKey.length === 0 || returnUrl.length === 0) {
    console.error("create-checkout: STRIPE_SECRET_KEY or CHECKOUT_RETURN_URL is not set");
    return json({ error: "Payments aren't set up on this server yet." }, 503);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Who is buying comes from the token, never from the request body.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (authError || !user) {
    return json({ error: "Your session has expired. Open the app again and retry." }, 401);
  }

  // The same gate as sending: an anonymous account cannot send time at all,
  // and a purchase needs an account that can be signed back into.
  if (user.is_anonymous) {
    return json(
      { error: "Create an account first. The upgrade belongs to it, and your streak carries over." },
      403,
    );
  }

  const { data: owned, error: ownedError } = await admin.rpc("uptime_sends_whole_clock", {
    p_user: user.id,
  });
  if (ownedError) {
    console.error("create-checkout: could not read the account", ownedError);
    return json({ error: "Could not start the payment. Try again in a moment." }, 500);
  }
  if (owned === true) {
    return json({ error: "You can already send your whole clock." }, 409);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: checkoutParams({ userId: user.id, email: user.email ?? null, returnUrl }),
  });
  const session = (await response.json().catch(() => null)) as
    | { url?: unknown; error?: { message?: string } }
    | null;

  if (!response.ok || typeof session?.url !== "string") {
    console.error("create-checkout: Stripe refused the session", response.status, session?.error?.message);
    return json({ error: "Could not start the payment. Try again in a moment." }, 502);
  }

  return json({ url: session.url });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
