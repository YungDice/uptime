// Uptime: the "still here?" prompt.
//
// Sends one low-friction notification per closing window, with an action
// button that answers without opening the app. This is the piece with no
// precedent in Nexo or Rater, and it is the only part of the system that
// needs per-platform credentials.
//
// The prompt is a convenience, never the mechanism. If every provider below is
// unconfigured this function does nothing and streaks behave identically - the
// window is measured server-side from last_seen either way.
//
// Required secrets, per platform you actually ship:
//   FCM_SERVICE_ACCOUNT_JSON  Android. A service-account key, JSON, one line.
//   APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID   iOS.
//   WNS_CLIENT_ID / WNS_CLIENT_SECRET                            Windows.
//
// Deploy:   supabase functions deploy nudge-check-in
// Schedule: daily, the same way as sweep-lapsed (see that function's header).

import { createClient } from "jsr:@supabase/supabase-js@2";

interface DueRow {
  user_id: string;
  handle: string;
  deadline: number;
  platform: "apns" | "fcm" | "wns";
  token: string;
}

const TITLE = "Still there?";

/**
 * Pushes in flight at once.
 *
 * Delivery used to be strictly one after another, so a run's wall-clock time
 * was the sum of every provider round trip - a thousand due users at a couple
 * of hundred milliseconds each is longer than an Edge Function is allowed to
 * live, and the users past the cut-off were simply never nudged. A small pool
 * keeps the run inside its limit without opening a thousand sockets at once.
 */
const CONCURRENCY = 16;

/**
 * Provider credentials, minted once per run rather than once per push.
 *
 * Every FCM send used to perform a fresh service-account token exchange and
 * every WNS send a fresh OAuth login - a thousand nudges meant a thousand
 * token requests, which is how a batch job gets itself rate limited by the
 * very provider it is trying to reach. Each token is valid for an hour, far
 * longer than one run. Created per request, not per isolate, so a warm
 * isolate can never hand out a token that has since expired.
 */
type Credentials = Map<string, Promise<string>>;

function cached(creds: Credentials, key: string, make: () => Promise<string>): Promise<string> {
  let pending = creds.get(key);
  if (pending === undefined) {
    // A failed exchange is forgotten, so the next push can try again rather
    // than every remaining push inheriting the one failure.
    pending = make().catch((err) => {
      creds.delete(key);
      throw err;
    });
    creds.set(key, pending);
  }
  return pending;
}

const bodyFor = (daysLeft: number) =>
  daysLeft <= 1
    ? "Your streak ends tomorrow unless you check in."
    : `Your check-in window closes in ${daysLeft} days.`;

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey.length === 0 || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return json({ error: "forbidden" }, 403);
  }

  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await client.rpc("uptime_due_for_nudge", { p_limit: 1000 });
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as DueRow[];
  const now = Math.floor(Date.now() / 1000);
  const creds: Credentials = new Map();
  let sent = 0;
  let skipped = 0;

  await forEachLimited(rows, CONCURRENCY, async (row) => {
    const daysLeft = Math.max(1, Math.ceil((row.deadline - now) / 86400));
    const delivered = await deliver(row, bodyFor(daysLeft), creds);
    if (delivered) {
      sent += 1;
      // Recorded only on a successful send, so an outage retries tomorrow
      // rather than silently burning the one nudge this window gets.
      await client.rpc("uptime_record_nudge", { p_user: row.user_id, p_deadline: row.deadline });
    } else {
      skipped += 1;
    }
  });

  console.log(`nudge: ${sent} sent, ${skipped} skipped of ${rows.length} due`);
  return json({ due: rows.length, sent, skipped });
});

/** Run `work` over `items` with at most `limit` in flight. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await work(item);
    }
  });
  await Promise.all(lanes);
}

async function deliver(row: DueRow, body: string, creds: Credentials): Promise<boolean> {
  try {
    switch (row.platform) {
      case "fcm":
        return await sendFcm(row.token, body, creds);
      case "apns":
        return await sendApns(row.token, body, creds);
      case "wns":
        return await sendWns(row.token, body, creds);
    }
  } catch (err) {
    console.error(`deliver failed for ${row.platform}`, err);
    return false;
  }
}

// --- Android -------------------------------------------------------------

async function sendFcm(token: string, body: string, creds: Credentials): Promise<boolean> {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) return false;

  const account = JSON.parse(raw) as {
    client_email: string;
    private_key: string;
    project_id: string;
  };
  const accessToken = await cached(creds, "fcm", () => googleAccessToken(account));

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: TITLE, body },
          // The action that makes this cost about one second: the app answers
          // it without being opened. See src/notifications/checkIn.ts.
          android: { notification: { click_action: "UPTIME_CHECK_IN" } },
          data: { action: "check-in" },
        },
      }),
    },
  );

  if (!res.ok) console.error("fcm", res.status, await res.text());
  return res.ok;
}

/** Service-account JWT exchanged for an OAuth token, per Google's flow. */
async function googleAccessToken(account: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signRs256(
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const payload = (await res.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("no access token from Google");
  return payload.access_token;
}

// --- iOS -----------------------------------------------------------------

async function sendApns(token: string, body: string, creds: Credentials): Promise<boolean> {
  const p8 = Deno.env.get("APNS_KEY_P8");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const bundleId = Deno.env.get("APNS_BUNDLE_ID");
  if (!p8 || !keyId || !teamId || !bundleId) return false;

  // Apple asks for the provider token to be reused, not re-signed per request:
  // it throttles connections that refresh it more than once every 20 minutes.
  const jwt = await cached(creds, "apns", () =>
    signEs256({ iss: teamId, iat: Math.floor(Date.now() / 1000) }, p8, keyId),
  );

  const res = await fetch(`https://api.push.apple.com/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: TITLE, body },
        // Registered by the app so the notification carries an "I am still
        // here" button rather than only opening the app.
        category: "UPTIME_CHECK_IN",
      },
    }),
  });

  if (!res.ok) console.error("apns", res.status, await res.text());
  return res.ok;
}

// --- Windows -------------------------------------------------------------

async function sendWns(channelUri: string, body: string, creds: Credentials): Promise<boolean> {
  const clientId = Deno.env.get("WNS_CLIENT_ID");
  const clientSecret = Deno.env.get("WNS_CLIENT_SECRET");
  if (!clientId || !clientSecret) return false;

  const access_token = await cached(creds, "wns", async () => {
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://wns.windows.com/.default",
      }),
    });
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw new Error("no access token from WNS");
    return access_token;
  });

  const toast =
    `<toast launch="uptime://check-in"><visual><binding template="ToastGeneric">` +
    `<text>${escapeXml(TITLE)}</text><text>${escapeXml(body)}</text>` +
    `</binding></visual><actions>` +
    `<action content="I am still here" arguments="uptime://check-in" activationType="background"/>` +
    `</actions></toast>`;

  const res = await fetch(channelUri, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "X-WNS-Type": "wns/toast",
      "content-type": "text/xml",
    },
    body: toast,
  });

  if (!res.ok) console.error("wns", res.status, await res.text());
  return res.ok;
}

// --- signing helpers -----------------------------------------------------

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

async function signRs256(claim: object, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return signJwt(claim, { alg: "RS256", typ: "JWT" }, key, { name: "RSASSA-PKCS1-v1_5" });
}

async function signEs256(claim: object, privateKeyPem: string, keyId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return signJwt(claim, { alg: "ES256", kid: keyId, typ: "JWT" }, key, {
    name: "ECDSA",
    hash: "SHA-256",
  });
}

async function signJwt(
  claim: object,
  header: object,
  key: CryptoKey,
  algorithm: AlgorithmIdentifier | EcdsaParams,
): Promise<string> {
  const encoder = new TextEncoder();
  const head = b64url(encoder.encode(JSON.stringify(header)));
  const payload = b64url(encoder.encode(JSON.stringify(claim)));
  const signature = await crypto.subtle.sign(algorithm, key, encoder.encode(`${head}.${payload}`));
  return `${head}.${payload}.${b64url(new Uint8Array(signature))}`;
}

function escapeXml(value: string): string {
  const map: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  };
  return value.replace(/[<>&'"]/g, (c) => map[c] as string);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
