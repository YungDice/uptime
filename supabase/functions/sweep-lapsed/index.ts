// Uptime: the scheduled lapse sweep.
//
// The one recurring job the app needs. Everything else is derived at read
// time; this exists because a streak that has run out of window has to be
// filed even if its owner never opens the app again - which is, by
// definition, exactly the case it handles.
//
// Deploy:  supabase functions deploy sweep-lapsed
// Schedule (daily at 03:00 UTC), from the SQL editor:
//
//   select cron.schedule(
//     'uptime-sweep-lapsed', '0 3 * * *',
//     $$ select net.http_post(
//          url := '<project-url>/functions/v1/sweep-lapsed',
//          headers := jsonb_build_object(
//            'Authorization', 'Bearer ' || current_setting('app.service_role_key')) ) $$);
//
// Running it hourly is also fine and costs nothing: uptime_sweep_lapsed is
// idempotent, and a row it has already filed no longer matches the query.

import { createClient } from "jsr:@supabase/supabase-js@2";

/** Rows per statement. */
const BATCH = 5000;

/** Stop starting new batches after this long; well inside the function limit. */
const BUDGET_MS = 60_000;

Deno.serve(async (req: Request) => {
  // Only the service role may sweep; a lapse is a destructive act on someone
  // else's streak and must never be reachable with an anon key.
  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey.length === 0 || auth !== `Bearer ${serviceKey}`) {
    return json({ error: "forbidden" }, 403);
  }

  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
    auth: { persistSession: false },
  });

  // Batched, so no single statement holds a long transaction over the table -
  // but drained, not one batch per run. With one fixed batch a day, a backlog
  // bigger than the batch (a launch cohort all going quiet in the same week)
  // took days to clear, and every one of those streaks sat on the boards as
  // running until it was reached. The budget keeps the run well inside the
  // function's wall-clock limit; whatever is left is next run's.
  const started = Date.now();
  let swept = 0;
  let passes = 0;

  for (;;) {
    const { data, error } = await client.rpc("uptime_sweep_lapsed", { p_limit: BATCH });
    if (error) {
      console.error("sweep failed", error);
      return json({ error: error.message, swept }, 500);
    }
    const n = typeof data === "number" ? data : 0;
    swept += n;
    passes += 1;
    if (n < BATCH || Date.now() - started > BUDGET_MS) break;
  }

  console.log(`swept ${swept} lapsed streak(s) in ${passes} pass(es)`);
  return json({ swept, passes });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
