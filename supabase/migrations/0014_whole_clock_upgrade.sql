-- Uptime: the whole-clock upgrade, and the free share it lifts.
--
-- Since 0013 a gift moves time off the sender's clock and onto the
-- recipient's, and every account could send everything on its clock. Now:
--
--   - A free account may send a tenth of what its run has held: 6 minutes for
--     every hour on the clock, the ratio the old bank accrued at.
--   - The whole-clock upgrade, a one-off purchase, lifts that: everything on
--     the clock can be sent, and without the rolling 7-day daily cap, so a
--     whole clock can go in one gift. The 120-sends-an-hour limit stays for
--     everyone: it guards the ledger, not the economy.
--   - Revives are unchanged. They are paid off the whole clock, upgrade or not.
--
-- The purchase is made on a Stripe Checkout page opened by the
-- `create-checkout` Edge Function and recorded here only by `stripe-webhook`,
-- on Stripe's signed word that it was paid. No client can write a purchase.

-- ==========================================================================
-- What has been sent out of the run now on the clock
-- ==========================================================================

-- A gift moves `streak_start`, so the clock alone forgets what has already
-- been sent out of it. Measured against the clock alone, a free account could
-- send a tenth, then a tenth of what was left, and so on until it was empty.
-- The share is therefore a tenth of (clock + sent_this_run): sending leaves
-- that sum unchanged, so the share goes down by exactly what was sent.
alter table profiles add column if not exists sent_this_run bigint not null default 0;

-- A run that begins or ends has had nothing sent out of it.
--
-- Kept by a trigger rather than by each function that starts or files a run:
-- there are five of those today (start, stop, both sweeps, and a revive
-- restarting a friend's run), and whichever one forgot would hand the next run
-- the last one's allowance - or its debt. A transfer moves a start without
-- ending the run, so it keeps the count; so does a revive's price.
create or replace function uptime_reset_sent_this_run()
returns trigger language plpgsql as $fn$
begin
  if new.streak_start is null or old.streak_start is null then
    new.sent_this_run := 0;
  end if;
  return new;
end;
$fn$;

drop trigger if exists reset_sent_this_run on profiles;
create trigger reset_sent_this_run
  before update of streak_start on profiles
  for each row execute function uptime_reset_sent_this_run();

-- The new column is server-managed like the clock beside it.
create or replace function uptime_guard_profile_writes()
returns trigger language plpgsql as $fn$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.streak_start is distinct from old.streak_start
     or new.last_seen is distinct from old.last_seen
     or new.lifetime_seconds is distinct from old.lifetime_seconds
     or new.created_at is distinct from old.created_at
     or new.is_anonymous is distinct from old.is_anonymous
     or new.best_run_seconds is distinct from old.best_run_seconds
     or new.total_sent is distinct from old.total_sent
     or new.total_received is distinct from old.total_received
     or new.rescues is distinct from old.rescues
     or new.sent_this_run is distinct from old.sent_this_run then
    raise exception 'Streak fields are managed by the server';
  end if;
  return new;
end;
$fn$;

-- ==========================================================================
-- Purchases
-- ==========================================================================

-- One row per paid Checkout Session, written only by `uptime_grant_whole_clock`.
-- Keyed on the session because Stripe delivers an event at least once, not
-- exactly once: the second delivery of a payment is a no-op. A refund marks
-- the row rather than deleting it - the payment happened, and so did the
-- refund.
create table if not exists purchases (
  id              text    primary key,                -- the Checkout Session id
  user_id         uuid    not null references profiles(id) on delete cascade,
  payment_intent  text,                               -- how a refund finds it
  amount_cents    int     not null,
  currency        text    not null,
  created_at      bigint  not null default uptime_now(),
  refunded_at     bigint
);

create index if not exists purchases_user_idx
  on purchases (user_id) where refunded_at is null;
create index if not exists purchases_payment_intent_idx
  on purchases (payment_intent) where payment_intent is not null;

-- Nobody reads or writes this from a client. Supabase grants the client roles
-- privileges on every new table by default, so take them back explicitly; the
-- snapshot says whether *you* have the upgrade, and that is all anyone learns.
alter table purchases enable row level security;
revoke all on purchases from anon, authenticated;

-- ==========================================================================
-- What may be sent
-- ==========================================================================

-- Mirrors FREE_SEND_SHARE in src/core/constants.ts.
create or replace function uptime_free_send_share() returns numeric
  language sql immutable as $fn$ select 0.1::numeric $fn$;

create or replace function uptime_sends_whole_clock(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from purchases where user_id = p_user and refunded_at is null);
$fn$;

-- How much of a clock reading `p_clock` may be sent. Mirrors `sendable` in
-- src/core/economy.ts: everything with the upgrade, otherwise a tenth of what
-- the run has held less what has already gone out of it.
create or replace function uptime_sendable(p_clock bigint, p_sent_this_run bigint, p_whole boolean)
returns bigint language sql immutable as $fn$
  select case
    when coalesce(p_clock, 0) <= 0 then 0
    when p_whole then p_clock
    else greatest(0, least(p_clock,
           floor((p_clock + greatest(0, coalesce(p_sent_this_run, 0))) * uptime_free_send_share())::bigint
           - greatest(0, coalesce(p_sent_this_run, 0))))
  end;
$fn$;

-- Kept under its old name, as in 0013; now the share rather than the clock.
create or replace function uptime_balance(p_user uuid)
returns bigint language sql stable as $fn$
  select uptime_sendable(uptime_elapsed(p.streak_start, p.last_seen), p.sent_this_run,
                         uptime_sends_whole_clock(p.id))
    from profiles p where p.id = p_user;
$fn$;

-- Sending time: 0013's, with the share in place of the whole clock.
create or replace function uptime_send_time(p_to uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id     uuid := auth.uid();
  me        profiles;
  recipient profiles;
  t         bigint;
  clock     bigint;
  allowed   bigint;
  whole     boolean;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if p_amount is null or p_amount <= 0 or p_amount <> floor(p_amount) then
    return jsonb_build_object('ok', false, 'message', 'Pick an amount of time to send.');
  end if;
  if p_to = me_id then
    return jsonb_build_object('ok', false, 'message', 'You cannot send time to yourself.');
  end if;

  if uptime_is_anonymous(me_id) then
    return jsonb_build_object('ok', false, 'message',
      'Create an account to send time. Your streak carries over.');
  end if;

  -- The amount is capped per day, but the number of sends was not: a loop
  -- could file one-second gifts by the hundred thousand, and every one is a
  -- ledger row read back forever by the rolling cap and the audit trail.
  if not uptime_rate_ok('send_time', 120, 3600) then
    return jsonb_build_object('ok', false, 'message',
      'That is a lot of sending in one go. Try again shortly.');
  end if;

  perform 1 from profiles where id in (me_id, p_to) order by id for update;
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_to);

  select * into recipient from profiles where id = p_to;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;
  select * into me from profiles where id = me_id;

  if not uptime_connected(me_id, p_to) then
    return jsonb_build_object('ok', false, 'message', 'You can only send time to people you both follow.');
  end if;

  -- A gift lands on a running clock. A stopped one has nowhere to put it, and
  -- a lapsed one is what a revive is for - a plain gift restarting it would be
  -- a revive that skipped the price.
  if recipient.streak_start is null then
    return jsonb_build_object('ok', false, 'message',
      recipient.display_name || '''s clock isn''t running, so there''s nothing to add time to.');
  end if;

  -- All of the clock with the upgrade; a tenth of the run without.
  t := uptime_now();
  whole := uptime_sends_whole_clock(me_id);
  clock := case when me.streak_start is null then 0 else greatest(0, t - me.streak_start) end;
  allowed := uptime_sendable(clock, me.sent_this_run, whole);
  if p_amount > allowed then
    return jsonb_build_object('ok', false, 'message',
      case
        when clock <= 0 then 'Your clock has no time on it to send.'
        when allowed < clock and allowed <= 0
          then 'You''ve sent all a free account can from this clock: 6 minutes for every hour on it.'
        when allowed < clock
          then 'That''s more than a free account can send from this clock: 6 minutes for every hour on it.'
        else 'That''s more than your clock has on it.' end);
  end if;

  -- The daily cap is a free account's; the upgrade lifts it with the share.
  if not whole and uptime_sent_in_last_day(me_id) + p_amount > uptime_max_sent_per_day() then
    return jsonb_build_object('ok', false, 'message',
      'You have hit today''s sending limit. It resets on a rolling 24 hours.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds, created_at)
  values (me_id, p_to, p_amount, t);

  -- The transfer. Both sides are a sign of life, as they always were, and the
  -- sender's run remembers what went out of it.
  update profiles
     set streak_start = streak_start + p_amount,
         last_seen = t,
         sent_this_run = sent_this_run + p_amount
   where id = me_id;
  update profiles set streak_start = streak_start - p_amount, last_seen = t where id = p_to;

  return jsonb_build_object(
    'ok', true,
    'message', 'Sent to ' || recipient.display_name || '. It''s on their clock now.',
    'snapshot', uptime_snapshot());
end;
$fn$;

-- ==========================================================================
-- Recording a payment
-- ==========================================================================

-- Called by `stripe-webhook` with the service role, and by nothing else.
-- False when the account has been deleted since it paid: there is nothing to
-- unlock, and failing would only make Stripe retry for three days.
create or replace function uptime_grant_whole_clock(
  p_session        text,
  p_user           uuid,
  p_payment_intent text,
  p_amount_cents   int,
  p_currency       text)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if not exists (select 1 from profiles where id = p_user) then
    return false;
  end if;
  insert into purchases (id, user_id, payment_intent, amount_cents, currency)
  values (p_session, p_user, p_payment_intent, coalesce(p_amount_cents, 0), lower(coalesce(p_currency, '')))
  on conflict (id) do nothing;
  return true;
end;
$fn$;

-- A full refund locks the account again. Time already sent stays sent: a gift
-- lands on somebody else's clock, and taking it back off would punish them.
create or replace function uptime_revoke_whole_clock(p_payment_intent text)
returns int language plpgsql security definer set search_path = public as $fn$
declare
  n int;
begin
  update purchases
     set refunded_at = uptime_now()
   where payment_intent = p_payment_intent and refunded_at is null;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- ==========================================================================
-- The reads that say so
-- ==========================================================================

-- The pulse also carries the upgrade: a payment finishes in the browser, and
-- an open app has to notice the unlock the same way it notices a gift.
create or replace function uptime_pulse()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
           'serverNow', uptime_now(),
           'streakStart', p.streak_start,
           'totalReceived', p.total_received,
           'sendsWholeClock', uptime_sends_whole_clock(p.id))
    from profiles p
   where p.id = auth.uid();
$fn$;

-- 0013's snapshot, plus what the share needs: the run's sent total on your
-- own record, whether the upgrade is yours, and the share as the balance.
create or replace function uptime_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  me profiles;
  t  bigint := uptime_now();
  whole boolean;
  result jsonb;
begin
  select * into me from profiles where id = auth.uid();
  if not found then
    raise exception 'No profile for the current user';
  end if;
  whole := uptime_sends_whole_clock(me.id);

  select jsonb_build_object(
    'serverNow', t,
    'me', jsonb_build_object(
      'id', me.id,
      'handle', me.handle,
      'displayName', me.display_name,
      'avatarUrl', me.avatar_url,
      'createdAt', me.created_at,
      'streak', jsonb_build_object(
        'streakStart', me.streak_start,
        'lastSeen', me.last_seen,
        'sentThisRun', me.sent_this_run),
      'lifetimeSeconds', me.lifetime_seconds,
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'startedAt', r.started_at,
                 'endedAt', r.ended_at,
                 'length', r.length_seconds,
                 'reason', r.reason,
                 'revivedAt', r.revived_at) order by r.ended_at)
          from (select * from streak_runs
                 where user_id = me.id
                 order by ended_at desc
                 limit uptime_snapshot_history_cap()) r), '[]'::jsonb)
    ),
    'status', uptime_status_json(me.streak_start, me.last_seen),
    'windowAnchor', me.last_seen,
    'balance', uptime_sendable(uptime_elapsed(me.streak_start, me.last_seen, t), me.sent_this_run, whole),
    'sendsWholeClock', whole,
    'totalSent', me.total_sent,
    'totalReceived', me.total_received,
    'sentInLastDay', uptime_sent_in_last_day(me.id),
    'lastRun', (
      select jsonb_build_object(
               'startedAt', r.started_at, 'endedAt', r.ended_at,
               'length', r.length_seconds, 'reason', r.reason,
               'revivedAt', r.revived_at)
        from streak_runs r where r.user_id = me.id
       order by r.ended_at desc limit 1),
    'personalBest', greatest(uptime_elapsed(me.streak_start, me.last_seen, t), me.best_run_seconds),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile', jsonb_build_object(
                 'id', f.id, 'handle', f.handle,
                 'displayName', f.display_name,
                 'avatarUrl', f.avatar_url,
                 'createdAt', f.created_at),
               'streak', jsonb_build_object('streakStart', f.streak_start, 'lastSeen', f.last_seen),
               'connected', f.i_follow and f.follows_me,
               'iFollow', f.i_follow,
               'followsMe', f.follows_me,
               'revive', case when last_run.id is null then null else jsonb_build_object(
                 'lostLength', last_run.length_seconds,
                 'restores', uptime_revived_length(last_run.length_seconds),
                 'cost', uptime_revive_cost(last_run.length_seconds)) end
             ) order by f.friend_order desc, f.id)
        from (
          select p.id, p.handle, p.display_name, p.avatar_url, p.created_at,
                 p.streak_start, p.last_seen,
                 rel.i_follow, rel.follows_me,
                 uptime_elapsed(p.streak_start, p.last_seen, t) as friend_order
            from (
              select edge.other_id,
                     bool_or(edge.i_follow) as i_follow,
                     bool_or(edge.follows_me) as follows_me
                from (
                  select followee_id as other_id, true as i_follow, false as follows_me
                    from follows where follower_id = me.id
                  union all
                  select follower_id, false, true
                    from follows where followee_id = me.id
                ) edge
               group by edge.other_id
            ) rel
            join profiles p on p.id = rel.other_id
           where p.id <> me.id
           order by friend_order desc, p.id
           limit uptime_snapshot_friend_cap()
        ) f
        left join lateral (
          select r.id, r.length_seconds
            from streak_runs r
           where r.user_id = f.id and r.reason = 'lapsed'
             and r.revived_at is null and f.streak_start is null
           order by r.ended_at desc
           limit 1
        ) last_run on true), '[]'::jsonb),
    'recentGifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'fromUserId', g.from_user_id,
               'toUserId', g.to_user_id,
               'amount', g.amount_seconds,
               'createdAt', g.created_at,
               'revivedStreakId', g.revived_run_id) order by g.created_at desc)
        from (
          select * from (
            (select * from gifts where from_user_id = me.id order by created_at desc limit 12)
            union all
            (select * from gifts where to_user_id = me.id order by created_at desc limit 12)
          ) both_ways
          order by created_at desc
          limit 12
        ) g), '[]'::jsonb)
  ) into result;

  return result;
end;
$fn$;

-- ==========================================================================
-- Who may call what
-- ==========================================================================

revoke execute on function uptime_reset_sent_this_run()                          from public, anon, authenticated;
revoke execute on function uptime_sends_whole_clock(uuid)                        from public, anon, authenticated;
revoke execute on function uptime_grant_whole_clock(text, uuid, text, int, text) from public, anon, authenticated;
revoke execute on function uptime_revoke_whole_clock(text)                       from public, anon, authenticated;
revoke execute on function uptime_balance(uuid)                                  from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function uptime_sends_whole_clock(uuid)                        to service_role;
    grant execute on function uptime_grant_whole_clock(text, uuid, text, int, text) to service_role;
    grant execute on function uptime_revoke_whole_clock(text)                       to service_role;
  end if;
end $$;
