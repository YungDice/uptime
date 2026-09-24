-- Uptime: complete schema, generated from supabase/migrations/.
--
-- Paste this whole file into the Supabase Dashboard SQL Editor and run it.
-- It is the same content as the numbered migrations, concatenated in order,
-- and exists because this machine cannot reach Postgres directly (outbound
-- 5432/6543 are blocked), so `supabase db push` cannot run from here.
--
-- Safe to re-run: every statement is CREATE OR REPLACE, CREATE IF NOT EXISTS,
-- or a DROP ... IF EXISTS followed by a CREATE. Re-running it on a database
-- that already has the earlier migrations applies only what changed.
--
-- Do not edit by hand: run `npm run db:bundle` after changing a migration.
--
-- Generated from:
--   0001_schema.sql
--   0002_derivations.sql
--   0003_sweep_and_snapshot.sql
--   0004_actions.sql
--   0005_economy_actions.sql
--   0006_boards_and_rls.sql
--   0007_push.sql
--   0008_follows.sql
--   0009_accounts.sql
--   0010_avatars_and_follow_direction.sql
--   0011_public_profiles.sql
--   0012_limits.sql
--   0013_clock_transfers_and_scale.sql

-- ==========================================================================
-- 0001_schema.sql
-- ==========================================================================

-- Uptime: core schema.
--
-- Time is stored as bigint epoch seconds rather than timestamptz throughout.
-- The whole model is "elapsed = now - streak_start", and keeping both sides of
-- that subtraction in the same unit as the client removes a class of interval
-- and timezone mismatches between the SQL and the TypeScript that mirrors it.

create extension if not exists pgcrypto;

-- --- tunables -------------------------------------------------------------
-- Mirrors src/core/constants.ts. Kept as immutable functions rather than a
-- settings table so the planner can inline them and so changing a rule is a
-- migration with a reviewable diff.

create or replace function uptime_now() returns bigint
  language sql stable as $$ select extract(epoch from now())::bigint $$;

create or replace function uptime_check_in_window() returns bigint
  language sql immutable as $$ select (60 * 24 * 60 * 60)::bigint $$;   -- 60 days

create or replace function uptime_accrual_rate() returns numeric
  language sql immutable as $$ select 0.1::numeric $$;

create or replace function uptime_revive_restore_fraction() returns numeric
  language sql immutable as $$ select 0.5::numeric $$;

create or replace function uptime_max_sent_per_day() returns bigint
  language sql immutable as $$ select (7 * 24 * 60 * 60)::bigint $$;    -- 7 days

create or replace function uptime_min_account_age() returns bigint
  language sql immutable as $$ select (14 * 24 * 60 * 60)::bigint $$;   -- 14 days

-- --- tables ---------------------------------------------------------------

create table if not exists profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  handle            text unique not null check (handle ~ '^[a-z0-9_]{2,24}$'),
  display_name      text not null,
  created_at        bigint not null default uptime_now(),

  -- The two fields the whole app derives from. Null start means no run.
  streak_start      bigint,
  last_seen         bigint not null default uptime_now(),

  -- Sum of closed runs only. The run in progress is never folded in here.
  lifetime_seconds  bigint not null default 0 check (lifetime_seconds >= 0),

  constraint streak_start_sane check (streak_start is null or streak_start <= last_seen + uptime_check_in_window())
);

create table if not exists streak_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  started_at      bigint not null,
  ended_at        bigint not null,
  length_seconds  bigint not null check (length_seconds >= 0),
  reason          text not null check (reason in ('lapsed', 'voluntary', 'reset')),
  -- Set when a friend bought this run back. The row stays: a reset never
  -- erases the record, and deleting it would also null the gift's pointer to
  -- it, which is what the rescues leaderboard counts.
  revived_at      bigint
);

create index if not exists streak_runs_user_idx on streak_runs (user_id, length_seconds desc);

-- Directed follows. A donation needs the pair in both directions; see
-- uptime_connected below. Storing one row per direction keeps "follow" usable
-- on its own later without reshaping the table.
create table if not exists follows (
  follower_id  uuid not null references profiles (id) on delete cascade,
  followee_id  uuid not null references profiles (id) on delete cascade,
  created_at   bigint not null default uptime_now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on follows (followee_id);

-- The donation ledger. Balances are sums over these rows, never a column.
create table if not exists gifts (
  id              uuid primary key default gen_random_uuid(),
  from_user_id    uuid not null references profiles (id) on delete cascade,
  to_user_id      uuid not null references profiles (id) on delete cascade,
  amount_seconds  bigint not null check (amount_seconds > 0),
  created_at      bigint not null default uptime_now(),
  -- Set when the gift was spent reviving rather than given outright.
  revived_run_id  uuid references streak_runs (id) on delete set null,
  constraint no_self_gift check (from_user_id <> to_user_id)
);

create index if not exists gifts_from_idx on gifts (from_user_id, created_at desc);
create index if not exists gifts_to_idx on gifts (to_user_id, created_at desc);

-- ==========================================================================
-- 0002_derivations.sql
-- ==========================================================================

-- Uptime: the derived quantities.
--
-- Nothing in this file stores a running total. Every function here is either a
-- subtraction against uptime_now() or a sum over the ledger, which is what
-- makes the leaderboards a GROUP BY rather than a synchronisation problem.

-- Elapsed on the run in progress. Zero when nothing is running or it lapsed.
create or replace function uptime_elapsed(p_start bigint, p_last_seen bigint, p_now bigint default null)
returns bigint language sql stable as $$
  select case
    when p_start is null then 0
    when coalesce(p_now, uptime_now()) >= p_last_seen + uptime_check_in_window() then 0
    else greatest(0, coalesce(p_now, uptime_now()) - p_start)
  end;
$$;

-- True once the check-in window has run out. The lapse dates to the deadline,
-- not to whenever the sweeper noticed.
create or replace function uptime_has_lapsed(p_start bigint, p_last_seen bigint, p_now bigint default null)
returns boolean language sql stable as $$
  select p_start is not null
     and coalesce(p_now, uptime_now()) >= p_last_seen + uptime_check_in_window();
$$;

-- Credit a run up to last_seen, not through the grace window: a user is
-- credited for time they were demonstrably around for.
create or replace function uptime_run_length(p_start bigint, p_last_seen bigint)
returns bigint language sql immutable as $$
  select greatest(0, p_last_seen - p_start);
$$;

create or replace function uptime_total_sent(p_user uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount_seconds), 0)::bigint from gifts where from_user_id = p_user;
$$;

create or replace function uptime_total_received(p_user uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount_seconds), 0)::bigint from gifts where to_user_id = p_user;
$$;

create or replace function uptime_sent_in_last_day(p_user uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount_seconds), 0)::bigint
    from gifts
   where from_user_id = p_user
     and created_at > uptime_now() - 86400;
$$;

-- Spendable balance: a fraction of all time kept, plus gifts in, minus gifts
-- out. Floored at zero defensively; the send path makes an overdraft
-- impossible, but a balance must never render negative.
create or replace function uptime_balance(p_user uuid)
returns bigint language sql stable as $$
  select greatest(0,
           floor((p.lifetime_seconds + uptime_elapsed(p.streak_start, p.last_seen))
                 * uptime_accrual_rate())::bigint
           + uptime_total_received(p_user)
           - uptime_total_sent(p_user))
    from profiles p
   where p.id = p_user;
$$;

create or replace function uptime_revived_length(p_lost bigint)
returns bigint language sql immutable as $$
  select floor(greatest(0, p_lost) * uptime_revive_restore_fraction())::bigint;
$$;

create or replace function uptime_revive_cost(p_lost bigint)
returns bigint language sql immutable as $$
  select ceil(uptime_revived_length(p_lost) * uptime_accrual_rate())::bigint;
$$;

-- Mutual follow. The gate on every gift: this alone kills the two-throwaway-
-- accounts-donating-in-a-circle attack.
create or replace function uptime_connected(p_a uuid, p_b uuid)
returns boolean language sql stable as $$
  select exists (select 1 from follows where follower_id = p_a and followee_id = p_b)
     and exists (select 1 from follows where follower_id = p_b and followee_id = p_a);
$$;

-- A fresh signup can play; it just cannot move the public rankings yet.
create or replace function uptime_counts_toward_boards(p_user uuid)
returns boolean language sql stable as $$
  select uptime_now() - created_at >= uptime_min_account_age() from profiles where id = p_user;
$$;

-- ==========================================================================
-- 0003_sweep_and_snapshot.sql
-- ==========================================================================

-- Uptime: the lapse sweep and the read model.

-- The stop problem, server side.
--
-- A server clock never dies on its own, so this is the only thing that ends a
-- streak without the user asking. It files the run at the deadline rather than
-- at the moment the sweeper ran, so a late sweep does not hand out free days.
--
-- Split deliberately into a per-user sweep and a batch one. Every action calls
-- the per-user sweep on the rows it touches, which means an action can never
-- proceed against a streak the batch job has not reached yet - checking in on
-- an already-lapsed streak would otherwise resurrect it.
create or replace function uptime_sweep_user(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  ran bigint;
begin
  select * into me from profiles where id = p_user for update;
  if not found or not uptime_has_lapsed(me.streak_start, me.last_seen) then
    return false;
  end if;

  ran := uptime_run_length(me.streak_start, me.last_seen);

  insert into streak_runs (user_id, started_at, ended_at, length_seconds, reason)
  values (me.id, me.streak_start, me.last_seen + uptime_check_in_window(), ran, 'lapsed');

  update profiles
     set streak_start = null,
         lifetime_seconds = lifetime_seconds + ran
   where id = me.id;

  return true;
end;
$$;

-- The scheduled job. Idempotent: a row it has already filed no longer matches.
create or replace function uptime_sweep_lapsed(p_limit int default 5000)
returns int language plpgsql security definer set search_path = public as $$
declare
  due uuid;
  swept int := 0;
begin
  for due in
    select id from profiles
     where streak_start is not null
       and uptime_now() >= last_seen + uptime_check_in_window()
     order by last_seen
     limit p_limit
  loop
    if uptime_sweep_user(due) then
      swept := swept + 1;
    end if;
  end loop;

  return swept;
end;
$$;

create or replace function uptime_status_json(p_start bigint, p_last_seen bigint)
returns jsonb language sql stable as $$
  select case
    when p_start is null then jsonb_build_object('kind', 'idle')
    when uptime_has_lapsed(p_start, p_last_seen) then jsonb_build_object(
      'kind', 'lapsed',
      'elapsed', greatest(0, uptime_now() - p_start),
      'lapsedAt', p_last_seen + uptime_check_in_window(),
      'length', uptime_run_length(p_start, p_last_seen))
    when (p_last_seen + uptime_check_in_window()) - uptime_now() <= 7 * 86400 then jsonb_build_object(
      'kind', 'expiring',
      'elapsed', uptime_now() - p_start,
      'windowRemaining', (p_last_seen + uptime_check_in_window()) - uptime_now())
    else jsonb_build_object(
      'kind', 'alive',
      'elapsed', uptime_now() - p_start,
      'windowRemaining', (p_last_seen + uptime_check_in_window()) - uptime_now())
  end;
$$;

-- Everything one screen needs, in one round trip.
create or replace function uptime_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me profiles;
  result jsonb;
begin
  select * into me from profiles where id = auth.uid();
  if not found then
    raise exception 'No profile for the current user';
  end if;

  select jsonb_build_object(
    'serverNow', uptime_now(),
    'me', jsonb_build_object(
      'id', me.id,
      'handle', me.handle,
      'displayName', me.display_name,
      'createdAt', me.created_at,
      'streak', jsonb_build_object('streakStart', me.streak_start, 'lastSeen', me.last_seen),
      'lifetimeSeconds', me.lifetime_seconds,
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'startedAt', r.started_at,
                 'endedAt', r.ended_at,
                 'length', r.length_seconds,
                 'reason', r.reason,
                 'revivedAt', r.revived_at) order by r.ended_at)
          from streak_runs r where r.user_id = me.id), '[]'::jsonb)
    ),
    'status', uptime_status_json(me.streak_start, me.last_seen),
    -- Default anchor: last_seen as it stands. uptime_open() overrides this
    -- with the value from before the visit; see Snapshot.windowAnchor.
    'windowAnchor', me.last_seen,
    'balance', uptime_balance(me.id),
    'totalSent', uptime_total_sent(me.id),
    'totalReceived', uptime_total_received(me.id),
    'sentInLastDay', uptime_sent_in_last_day(me.id),
    'lastRun', (
      select jsonb_build_object(
               'startedAt', r.started_at, 'endedAt', r.ended_at,
               'length', r.length_seconds, 'reason', r.reason,
               'revivedAt', r.revived_at)
        from streak_runs r where r.user_id = me.id
       order by r.ended_at desc limit 1),
    'personalBest', greatest(
      uptime_elapsed(me.streak_start, me.last_seen),
      coalesce((select max(length_seconds) from streak_runs where user_id = me.id), 0)),
    'friends', coalesce((
      select jsonb_agg(friend_json order by friend_order desc)
        from (
          select jsonb_build_object(
                   'profile', jsonb_build_object(
                     'id', f.id, 'handle', f.handle,
                     'displayName', f.display_name, 'createdAt', f.created_at),
                   'streak', jsonb_build_object('streakStart', f.streak_start, 'lastSeen', f.last_seen),
                   'connected', uptime_connected(me.id, f.id),
                   'revive', case when last_run.id is null then null else jsonb_build_object(
                     'lostLength', last_run.length_seconds,
                     'restores', uptime_revived_length(last_run.length_seconds),
                     'cost', uptime_revive_cost(last_run.length_seconds)) end
                 ) as friend_json,
                 uptime_elapsed(f.streak_start, f.last_seen) as friend_order
            from profiles f
            left join lateral (
              select r.id, r.length_seconds
                from streak_runs r
               where r.user_id = f.id and r.reason = 'lapsed'
                 and r.revived_at is null and f.streak_start is null
               order by r.ended_at desc
               limit 1
            ) last_run on true
           -- Either direction lists them; only a mutual follow lets time move.
           where f.id <> me.id
             and (exists (select 1 from follows w
                           where w.follower_id = me.id and w.followee_id = f.id)
               or exists (select 1 from follows w
                           where w.follower_id = f.id and w.followee_id = me.id))
        ) friends), '[]'::jsonb),
    'recentGifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'fromUserId', g.from_user_id,
               'toUserId', g.to_user_id,
               'amount', g.amount_seconds,
               'createdAt', g.created_at,
               'revivedStreakId', g.revived_run_id) order by g.created_at desc)
        from (select * from gifts
               where from_user_id = me.id or to_user_id = me.id
               order by created_at desc limit 12) g), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- Opening the app.
--
-- Split from uptime_snapshot because opening is itself a sign of life, and the
-- window bar has to be measured from *before* that touch - otherwise it can
-- only ever read full, since looking at it is what refills it.
create or replace function uptime_open()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  anchor bigint;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform uptime_sweep_user(auth.uid());
  select last_seen into anchor from profiles where id = auth.uid();
  perform uptime_touch(auth.uid());

  return jsonb_set(uptime_snapshot(), '{windowAnchor}', to_jsonb(anchor));
end;
$$;

grant execute on function uptime_open() to authenticated;

-- ==========================================================================
-- 0004_actions.sql
-- ==========================================================================

-- Uptime: the write surface.
--
-- Every rule lives here rather than in the client. A refusal comes back as
-- { ok: false, message } instead of an exception, because a rejected gift is
-- an ordinary outcome the interface should explain, not an error.

create or replace function uptime_ensure_profile(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  insert into profiles (id, handle, display_name)
  values (uid, p_handle, initcap(p_handle))
  on conflict (id) do update set last_seen = uptime_now();

  return jsonb_build_object('ok', true);
end;
$$;

-- Any sign of life. The only thing that keeps a streak alive.
create or replace function uptime_touch(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = uptime_now() where id = p_user;
$$;

create or replace function uptime_check_in()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles;
begin
  perform uptime_sweep_user(auth.uid());
  select * into me from profiles where id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if me.streak_start is null then
    return jsonb_build_object('ok', false, 'message', 'No streak running. Start one to begin.');
  end if;

  perform uptime_touch(me.id);
  return jsonb_build_object(
    'ok', true,
    'message', 'Confirmed - your streak continues.',
    'snapshot', uptime_snapshot());
end;
$$;

create or replace function uptime_start_streak()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles;
begin
  perform uptime_sweep_user(auth.uid());
  select * into me from profiles where id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if me.streak_start is not null then
    return jsonb_build_object('ok', false, 'message', 'A streak is already running.');
  end if;

  update profiles set streak_start = uptime_now(), last_seen = uptime_now() where id = me.id;
  return jsonb_build_object(
    'ok', true, 'message', 'Your clock is running.', 'snapshot', uptime_snapshot());
end;
$$;

-- Ending your own streak on purpose, tracked as its own reason for flavour.
create or replace function uptime_stop_streak()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  ran bigint;
begin
  perform uptime_sweep_user(auth.uid());
  select * into me from profiles where id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if me.streak_start is null then
    return jsonb_build_object('ok', false, 'message', 'No streak running.');
  end if;

  ran := greatest(0, uptime_now() - me.streak_start);

  insert into streak_runs (user_id, started_at, ended_at, length_seconds, reason)
  values (me.id, me.streak_start, uptime_now(), ran, 'voluntary');

  update profiles
     set streak_start = null,
         lifetime_seconds = lifetime_seconds + ran,
         last_seen = uptime_now()
   where id = me.id;

  return jsonb_build_object(
    'ok', true,
    'message', 'You stopped your own clock after ' || (ran / 86400)::int || ' days.',
    'snapshot', uptime_snapshot());
end;
$$;

-- ==========================================================================
-- 0005_economy_actions.sql
-- ==========================================================================

-- Uptime: sending and reviving. The only place time changes hands.

create or replace function uptime_send_time(p_to uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  recipient profiles;
  bal bigint;
  today bigint;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_to);

  if p_amount is null or p_amount <= 0 or p_amount <> floor(p_amount) then
    return jsonb_build_object('ok', false, 'message', 'Pick an amount of time to send.');
  end if;
  if p_to = me_id then
    return jsonb_build_object('ok', false, 'message', 'You cannot send time to yourself.');
  end if;

  -- Lock the sender row first so two concurrent sends cannot both read the
  -- same balance and jointly overdraw it.
  perform 1 from profiles where id = me_id for update;

  select * into recipient from profiles where id = p_to;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;

  if not uptime_connected(me_id, p_to) then
    return jsonb_build_object('ok', false, 'message', 'You can only send time to people you both follow.');
  end if;

  bal := uptime_balance(me_id);
  if p_amount > bal then
    return jsonb_build_object('ok', false, 'message', 'That is more than you have banked.');
  end if;

  today := uptime_sent_in_last_day(me_id);
  if today + p_amount > uptime_max_sent_per_day() then
    return jsonb_build_object('ok', false, 'message',
      'You have hit today''s sending limit. It resets on a rolling 24 hours.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds)
  values (me_id, p_to, p_amount);

  -- Receiving is a sign of life for the recipient, as is sending for you.
  perform uptime_touch(me_id);
  perform uptime_touch(p_to);

  return jsonb_build_object(
    'ok', true,
    'message', 'Sent to ' || recipient.display_name || '.',
    'snapshot', uptime_snapshot());
end;
$$;

-- Spend banked time to bring a friend's lapsed streak back, halved.
--
-- The restored streak is backdated rather than credited: the run resumes as
-- though it had begun `restores` seconds ago, and last_seen resets so the
-- rescued streak is not swept again on the next pass.
create or replace function uptime_revive(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  friend profiles;
  last_run streak_runs;
  cost bigint;
  restores bigint;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;
  -- Both sides, because the revive target's lapse is the whole precondition.
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_user);

  perform 1 from profiles where id = me_id for update;
  select * into friend from profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;
  if not uptime_connected(me_id, p_user) then
    return jsonb_build_object('ok', false, 'message', 'You can only revive people you both follow.');
  end if;
  if friend.streak_start is not null then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has a streak running.');
  end if;

  -- Already-revived runs are excluded, or the same run could be bought back
  -- again and again.
  select * into last_run from streak_runs
   where user_id = p_user and reason = 'lapsed' and revived_at is null
   order by ended_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has no broken streak to revive.');
  end if;

  cost := uptime_revive_cost(last_run.length_seconds);
  restores := uptime_revived_length(last_run.length_seconds);

  if cost > uptime_balance(me_id) then
    return jsonb_build_object('ok', false, 'message', 'Not enough banked time for this rescue.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds, revived_run_id)
  values (me_id, p_user, cost, last_run.id);

  -- The revived stretch is running again, so it stops counting toward the
  -- lifetime total - but the run itself stays on the record, marked.
  update streak_runs set revived_at = uptime_now() where id = last_run.id;

  update profiles
     set streak_start = uptime_now() - restores,
         last_seen = uptime_now(),
         lifetime_seconds = greatest(0, lifetime_seconds - last_run.length_seconds)
   where id = p_user;

  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', 'You brought ' || friend.display_name || ' back at ' || (restores / 86400)::int || ' days.',
    'snapshot', uptime_snapshot());
end;
$$;

-- ==========================================================================
-- 0006_boards_and_rls.sql
-- ==========================================================================

-- Uptime: leaderboards and row-level security.

-- Every board is a subtraction or a sum over rows that already exist. None of
-- them maintains a total, so a board can never disagree with a profile.
create or replace function uptime_board(p_board text, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  with rows as (
    select p.id, p.handle, p.display_name,
           case p_board
             when 'current-streak' then uptime_elapsed(p.streak_start, p.last_seen)
             when 'longest-ever' then greatest(
               uptime_elapsed(p.streak_start, p.last_seen),
               coalesce((select max(length_seconds) from streak_runs r where r.user_id = p.id), 0))
             when 'lifetime-total' then
               p.lifetime_seconds + uptime_elapsed(p.streak_start, p.last_seen)
             when 'most-donated' then
               case when uptime_counts_toward_boards(p.id) then uptime_total_sent(p.id) else 0 end
             when 'most-received' then uptime_total_received(p.id)
             when 'most-revives' then
               case when uptime_counts_toward_boards(p.id)
                 then (select count(*) from gifts g
                        where g.from_user_id = p.id and g.revived_run_id is not null)
                 else 0 end
             else 0
           end as value
      from profiles p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', id,
           'handle', handle,
           'displayName', display_name,
           'value', value,
           'unit', case when p_board = 'most-revives' then 'count' else 'seconds' end
         ) order by value desc), '[]'::jsonb)
    from (select * from rows where value > 0 order by value desc limit p_limit) ranked;
$$;

-- --- row-level security ---------------------------------------------------
-- Reads are open across profiles because the leaderboards are public by
-- design. Writes go through the security-definer functions above only: no
-- client can insert a gift, edit a streak, or move its own last_seen directly.

alter table profiles     enable row level security;
alter table streak_runs  enable row level security;
alter table follows      enable row level security;
alter table gifts        enable row level security;

drop policy if exists profiles_readable on profiles;
create policy profiles_readable on profiles for select using (true);

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists runs_readable on streak_runs;
create policy runs_readable on streak_runs for select using (true);

drop policy if exists gifts_readable on gifts;
create policy gifts_readable on gifts for select using (true);

drop policy if exists follows_readable on follows;
create policy follows_readable on follows for select using (true);

-- Following is the one thing a client may write directly, and only as itself.
drop policy if exists follows_self_insert on follows;
create policy follows_self_insert on follows
  for insert with check (follower_id = auth.uid());

drop policy if exists follows_self_delete on follows;
create policy follows_self_delete on follows
  for delete using (follower_id = auth.uid());

-- A profile may update itself, but not its own clock or its own balance
-- inputs. Those move only through the functions above.
create or replace function uptime_guard_profile_writes()
returns trigger language plpgsql as $$
begin
  -- Only client-facing roles are guarded. PostgREST reaches the database as
  -- `authenticator` and then SET ROLEs to `authenticated`, so comparing
  -- current_user against session_user would never fire; naming the roles is
  -- what actually distinguishes a client write from the server's own.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.streak_start is distinct from old.streak_start
     or new.last_seen is distinct from old.last_seen
     or new.lifetime_seconds is distinct from old.lifetime_seconds
     or new.created_at is distinct from old.created_at then
    raise exception 'Streak fields are managed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_writes on profiles;
create trigger guard_profile_writes
  before update on profiles
  for each row execute function uptime_guard_profile_writes();

-- Supabase grants the client roles broad table privileges by default, so the
-- policies above are not on their own enough. Take the write privileges back
-- explicitly and hand out only what a client legitimately does directly:
-- reading, and following someone. Everything else goes through the functions.
revoke all on profiles, streak_runs, gifts, follows from anon, authenticated;

grant select on profiles, streak_runs, gifts, follows to anon, authenticated;
grant insert, delete on follows to authenticated;

grant execute on function uptime_snapshot()                     to authenticated;
grant execute on function uptime_ensure_profile(text)           to authenticated;
grant execute on function uptime_check_in()                     to authenticated;
grant execute on function uptime_start_streak()                 to authenticated;
grant execute on function uptime_stop_streak()                  to authenticated;
grant execute on function uptime_send_time(uuid, bigint)        to authenticated;
grant execute on function uptime_revive(uuid)                   to authenticated;
grant execute on function uptime_board(text, int)               to authenticated, anon;

-- ==========================================================================
-- 0007_push.sql
-- ==========================================================================

-- Uptime: device registration for the check-in prompt.
--
-- The prompt is a convenience, never the mechanism. The window is measured
-- server-side from last_seen, so a user who denies notifications keeps their
-- streak exactly as long as one who allows them. Nothing in this file can
-- extend or end a streak.

create table if not exists device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  platform      text not null check (platform in ('apns', 'fcm', 'wns')),
  token         text not null,
  created_at    bigint not null default uptime_now(),
  last_used_at  bigint,
  unique (platform, token)
);

create index if not exists device_tokens_user_idx on device_tokens (user_id);

-- When a user was last nudged, so a single closing window does not produce a
-- prompt a day for a week.
create table if not exists nudges (
  user_id    uuid primary key references profiles (id) on delete cascade,
  sent_at    bigint not null,
  -- The deadline this nudge was about. A new streak means a new deadline,
  -- which is what makes one nudge per window rather than one per user.
  deadline   bigint not null
);

-- Who is close enough to the end of their window to be worth a prompt.
create or replace function uptime_due_for_nudge(p_limit int default 1000)
returns table (user_id uuid, handle text, deadline bigint, platform text, token text)
language sql stable security definer set search_path = public as $$
  select p.id, p.handle, p.last_seen + uptime_check_in_window(), d.platform, d.token
    from profiles p
    join device_tokens d on d.user_id = p.id
    left join nudges n on n.user_id = p.id
   where p.streak_start is not null
     -- Inside the lead, but not yet lapsed.
     and uptime_now() >= p.last_seen + uptime_check_in_window() - (7 * 86400)
     and uptime_now() < p.last_seen + uptime_check_in_window()
     -- Not already nudged about this same deadline.
     and (n.user_id is null or n.deadline is distinct from p.last_seen + uptime_check_in_window())
   order by p.last_seen
   limit p_limit;
$$;

create or replace function uptime_record_nudge(p_user uuid, p_deadline bigint)
returns void language sql security definer set search_path = public as $$
  insert into nudges (user_id, sent_at, deadline)
  values (p_user, uptime_now(), p_deadline)
  on conflict (user_id) do update set sent_at = uptime_now(), deadline = excluded.deadline;
$$;

-- A device registers itself; that is the only write a client makes here.
create or replace function uptime_register_device(p_platform text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  insert into device_tokens (user_id, platform, token)
  values (auth.uid(), p_platform, p_token)
  on conflict (platform, token) do update
    set user_id = auth.uid(), last_used_at = uptime_now();

  return jsonb_build_object('ok', true);
end;
$$;

alter table device_tokens enable row level security;
alter table nudges enable row level security;

drop policy if exists device_tokens_self on device_tokens;
create policy device_tokens_self on device_tokens for select using (user_id = auth.uid());

revoke all on device_tokens, nudges from anon, authenticated;
grant select on device_tokens to authenticated;
grant execute on function uptime_register_device(text, text) to authenticated;

-- ==========================================================================
-- 0008_follows.sql
-- ==========================================================================

-- Uptime: finding and following people.
--
-- Donations are gated on a mutual follow, which means following has to be
-- reachable or the whole economy is unusable on a fresh account. These are the
-- only writes a client makes outside the action functions.

-- Lookup by handle. Returns the public fields only; there is nothing private
-- on a profile, but being explicit here keeps it that way as fields are added.
create or replace function uptime_find_user(p_handle text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
           'id', p.id,
           'handle', p.handle,
           'displayName', p.display_name,
           'createdAt', p.created_at) end
    from profiles p where p.handle = lower(trim(p_handle));
$$;

create or replace function uptime_follow(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  target profiles;
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  select * into target from profiles where handle = lower(trim(p_handle));
  if not found then
    return jsonb_build_object('ok', false, 'message', 'No account with that handle.');
  end if;
  if target.id = me_id then
    return jsonb_build_object('ok', false, 'message', 'That is you.');
  end if;

  insert into follows (follower_id, followee_id)
  values (me_id, target.id)
  on conflict do nothing;

  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', case
      when uptime_connected(me_id, target.id)
        then 'You and ' || target.display_name || ' can now send each other time.'
      else 'Following ' || target.display_name || '. Time can move once they follow you back.'
    end,
    'snapshot', uptime_snapshot());
end;
$$;

create or replace function uptime_unfollow(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  delete from follows where follower_id = me_id and followee_id = p_user;

  return jsonb_build_object('ok', true, 'message', 'Unfollowed.', 'snapshot', uptime_snapshot());
end;
$$;

grant execute on function uptime_find_user(text) to authenticated;
grant execute on function uptime_follow(text)    to authenticated;
grant execute on function uptime_unfollow(uuid)  to authenticated;

-- ==========================================================================
-- 0009_accounts.sql
-- ==========================================================================

-- Uptime: accounts.
--
-- Playing without an account is a first-class state, not a degraded one: the
-- clock starts on the first tap and the streak is real. What an anonymous
-- account cannot do is take part in anything involving other people - it
-- cannot appear on a leaderboard and it cannot donate time.
--
-- The reason is abuse, not ceremony. Anonymous accounts are free and unlimited,
-- so a ranking that counted them would be a ranking of whoever scripted the
-- most signups, and a donation ledger that accepted them would be a free
-- supply of senders. Both defences have to live here, where the client cannot
-- reach them.

-- Authoritative and always current: Supabase flips this column itself when an
-- anonymous user attaches an email, so there is no flag of ours to keep in
-- sync and no window where a just-upgraded account still reads as anonymous.
create or replace function uptime_is_anonymous(p_user uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(u.is_anonymous, true) from auth.users u where u.id = p_user;
$$;

-- What the client needs to render the account surface, and to explain a
-- refusal before the round trip rather than after it.
create or replace function uptime_account()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
           'isAnonymous', coalesce(u.is_anonymous, true),
           'email', u.email,
           'createdAt', extract(epoch from u.created_at)::bigint)
    from auth.users u where u.id = auth.uid();
$$;

-- --- handles ---------------------------------------------------------------
-- A handle is how one person finds another, so it is the one identifier a user
-- should get to choose. Uniqueness and shape are enforced here; the table
-- constraint is the backstop.

create or replace function uptime_set_handle(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wanted text := lower(trim(p_handle));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;
  if wanted !~ '^[a-z0-9_]{2,24}$' then
    return jsonb_build_object('ok', false, 'message',
      'Handles are 2-24 characters, using letters, numbers and underscores.');
  end if;
  if exists (select 1 from profiles where handle = wanted and id <> auth.uid()) then
    return jsonb_build_object('ok', false, 'message', 'That handle is taken.');
  end if;

  update profiles set handle = wanted where id = auth.uid();
  return jsonb_build_object('ok', true, 'message', 'Handle updated.', 'snapshot', uptime_snapshot());
end;
$$;

create or replace function uptime_set_display_name(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wanted text := trim(p_name);
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;
  if length(wanted) < 1 or length(wanted) > 40 then
    return jsonb_build_object('ok', false, 'message', 'Pick a name between 1 and 40 characters.');
  end if;

  update profiles set display_name = wanted where id = auth.uid();
  return jsonb_build_object('ok', true, 'message', 'Name updated.', 'snapshot', uptime_snapshot());
end;
$$;

grant execute on function uptime_is_anonymous(uuid)   to authenticated;
grant execute on function uptime_account()            to authenticated;
grant execute on function uptime_set_handle(text)     to authenticated;
grant execute on function uptime_set_display_name(text) to authenticated;

-- --- the two things an anonymous account cannot do -------------------------

-- 1. Donate. Rebuilt rather than patched so the gate sits with the other
--    refusals, in the order a user meets them.
create or replace function uptime_send_time(p_to uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  recipient profiles;
  bal bigint;
  today bigint;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_to);

  if uptime_is_anonymous(me_id) then
    return jsonb_build_object('ok', false, 'message',
      'Create an account to send time. Your streak carries over.');
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> floor(p_amount) then
    return jsonb_build_object('ok', false, 'message', 'Pick an amount of time to send.');
  end if;
  if p_to = me_id then
    return jsonb_build_object('ok', false, 'message', 'You cannot send time to yourself.');
  end if;

  -- Lock the sender row first so two concurrent sends cannot both read the
  -- same balance and jointly overdraw it.
  perform 1 from profiles where id = me_id for update;

  select * into recipient from profiles where id = p_to;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;

  if not uptime_connected(me_id, p_to) then
    return jsonb_build_object('ok', false, 'message', 'You can only send time to people you both follow.');
  end if;

  bal := uptime_balance(me_id);
  if p_amount > bal then
    return jsonb_build_object('ok', false, 'message', 'That is more than you have banked.');
  end if;

  today := uptime_sent_in_last_day(me_id);
  if today + p_amount > uptime_max_sent_per_day() then
    return jsonb_build_object('ok', false, 'message',
      'You have hit today''s sending limit. It resets on a rolling 24 hours.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds)
  values (me_id, p_to, p_amount);

  perform uptime_touch(me_id);
  perform uptime_touch(p_to);

  return jsonb_build_object(
    'ok', true,
    'message', 'Sent to ' || recipient.display_name || '.',
    'snapshot', uptime_snapshot());
end;
$$;

-- Reviving spends banked time on someone else, so it is a donation too.
create or replace function uptime_revive(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  friend profiles;
  last_run streak_runs;
  cost bigint;
  restores bigint;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_user);

  if uptime_is_anonymous(me_id) then
    return jsonb_build_object('ok', false, 'message',
      'Create an account to revive a friend. Your streak carries over.');
  end if;

  perform 1 from profiles where id = me_id for update;
  select * into friend from profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;
  if not uptime_connected(me_id, p_user) then
    return jsonb_build_object('ok', false, 'message', 'You can only revive people you both follow.');
  end if;
  if friend.streak_start is not null then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has a streak running.');
  end if;

  select * into last_run from streak_runs
   where user_id = p_user and reason = 'lapsed' and revived_at is null
   order by ended_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has no broken streak to revive.');
  end if;

  cost := uptime_revive_cost(last_run.length_seconds);
  restores := uptime_revived_length(last_run.length_seconds);

  if cost > uptime_balance(me_id) then
    return jsonb_build_object('ok', false, 'message', 'Not enough banked time for this rescue.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds, revived_run_id)
  values (me_id, p_user, cost, last_run.id);

  update streak_runs set revived_at = uptime_now() where id = last_run.id;

  update profiles
     set streak_start = uptime_now() - restores,
         last_seen = uptime_now(),
         lifetime_seconds = greatest(0, lifetime_seconds - last_run.length_seconds)
   where id = p_user;

  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', 'You brought ' || friend.display_name || ' back at ' || (restores / 86400)::int || ' days.',
    'snapshot', uptime_snapshot());
end;
$$;

-- 2. Appear on a leaderboard. Anonymous accounts are free and unlimited, so a
--    board that counted them would rank whoever scripted the most signups.
create or replace function uptime_board(p_board text, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  with rows as (
    select p.id, p.handle, p.display_name,
           case p_board
             when 'current-streak' then uptime_elapsed(p.streak_start, p.last_seen)
             when 'longest-ever' then greatest(
               uptime_elapsed(p.streak_start, p.last_seen),
               coalesce((select max(length_seconds) from streak_runs r where r.user_id = p.id), 0))
             when 'lifetime-total' then
               p.lifetime_seconds + uptime_elapsed(p.streak_start, p.last_seen)
             when 'most-donated' then
               case when uptime_counts_toward_boards(p.id) then uptime_total_sent(p.id) else 0 end
             when 'most-received' then uptime_total_received(p.id)
             when 'most-revives' then
               case when uptime_counts_toward_boards(p.id)
                 then (select count(*) from gifts g
                        where g.from_user_id = p.id and g.revived_run_id is not null)
                 else 0 end
             else 0
           end as value
      from profiles p
     where not uptime_is_anonymous(p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', id,
           'handle', handle,
           'displayName', display_name,
           'value', value,
           'unit', case when p_board = 'most-revives' then 'count' else 'seconds' end
         ) order by value desc), '[]'::jsonb)
    from (select * from rows where value > 0 order by value desc limit p_limit) ranked;
$$;

grant execute on function uptime_board(text, int) to authenticated, anon;

-- ==========================================================================
-- 0010_avatars_and_follow_direction.sql
-- ==========================================================================

-- Uptime: profile pictures, and which way a follow points.
--
-- Two additions that the read model could not express before:
--
--   1. An avatar. Stored in Supabase Storage rather than the database - a
--      profile picture is a file, and putting bytes in a column would make
--      every snapshot read carry them.
--
--   2. The *direction* of a follow. The friends list already returned people
--      who follow you but whom you do not follow back, and labelled them
--      identically to the opposite case. One is someone waiting on you; the
--      other is someone you are waiting on. Only the first is a request you
--      can act on, and the UI could not tell them apart.

-- --- avatars ---------------------------------------------------------------

alter table profiles add column if not exists avatar_url text;

-- The bucket is public: an avatar is shown beside a handle on a leaderboard
-- anyone can read, so a signed URL would buy nothing and cost a round trip per
-- face. Writes are still restricted to the owner's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

-- Objects live under a folder named for the owner's uid, which is what makes
-- "your own avatar" expressible as a policy at all.
drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Clients have no update privilege on profiles, so the column moves through
-- here. The shape check is the point: without it this is a free field for
-- pointing every viewer's browser at an arbitrary host, which turns a profile
-- picture into a tracking beacon and lets one account display another's file.
create or replace function uptime_set_avatar(p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  wanted text := nullif(trim(coalesce(p_url, '')), '');
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  if wanted is not null and wanted !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/' || me_id::text || '/') then
    return jsonb_build_object('ok', false, 'message', 'That image is not in your own avatar folder.');
  end if;

  update profiles set avatar_url = wanted where id = me_id;
  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', case when wanted is null then 'Photo removed.' else 'Photo updated.' end,
    'snapshot', uptime_snapshot());
end;
$$;

-- --- read model ------------------------------------------------------------

create or replace function uptime_find_user(p_handle text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
           'id', p.id,
           'handle', p.handle,
           'displayName', p.display_name,
           'avatarUrl', p.avatar_url,
           'createdAt', p.created_at) end
    from profiles p where p.handle = lower(trim(p_handle));
$$;

-- Rebuilt rather than patched: the friends sub-select gains two booleans and
-- every profile object gains a face, and a jsonb_set patch over this much
-- nesting would be unreadable.
create or replace function uptime_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me profiles;
  result jsonb;
begin
  select * into me from profiles where id = auth.uid();
  if not found then
    raise exception 'No profile for the current user';
  end if;

  select jsonb_build_object(
    'serverNow', uptime_now(),
    'me', jsonb_build_object(
      'id', me.id,
      'handle', me.handle,
      'displayName', me.display_name,
      'avatarUrl', me.avatar_url,
      'createdAt', me.created_at,
      'streak', jsonb_build_object('streakStart', me.streak_start, 'lastSeen', me.last_seen),
      'lifetimeSeconds', me.lifetime_seconds,
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'startedAt', r.started_at,
                 'endedAt', r.ended_at,
                 'length', r.length_seconds,
                 'reason', r.reason,
                 'revivedAt', r.revived_at) order by r.ended_at)
          from streak_runs r where r.user_id = me.id), '[]'::jsonb)
    ),
    'status', uptime_status_json(me.streak_start, me.last_seen),
    'windowAnchor', me.last_seen,
    'balance', uptime_balance(me.id),
    'totalSent', uptime_total_sent(me.id),
    'totalReceived', uptime_total_received(me.id),
    'sentInLastDay', uptime_sent_in_last_day(me.id),
    'lastRun', (
      select jsonb_build_object(
               'startedAt', r.started_at, 'endedAt', r.ended_at,
               'length', r.length_seconds, 'reason', r.reason,
               'revivedAt', r.revived_at)
        from streak_runs r where r.user_id = me.id
       order by r.ended_at desc limit 1),
    'personalBest', greatest(
      uptime_elapsed(me.streak_start, me.last_seen),
      coalesce((select max(length_seconds) from streak_runs where user_id = me.id), 0)),
    'friends', coalesce((
      select jsonb_agg(friend_json order by friend_order desc)
        from (
          select jsonb_build_object(
                   'profile', jsonb_build_object(
                     'id', f.id, 'handle', f.handle,
                     'displayName', f.display_name,
                     'avatarUrl', f.avatar_url,
                     'createdAt', f.created_at),
                   'streak', jsonb_build_object('streakStart', f.streak_start, 'lastSeen', f.last_seen),
                   'connected', uptime_connected(me.id, f.id),
                   'iFollow', exists (select 1 from follows w
                                       where w.follower_id = me.id and w.followee_id = f.id),
                   'followsMe', exists (select 1 from follows w
                                         where w.follower_id = f.id and w.followee_id = me.id),
                   'revive', case when last_run.id is null then null else jsonb_build_object(
                     'lostLength', last_run.length_seconds,
                     'restores', uptime_revived_length(last_run.length_seconds),
                     'cost', uptime_revive_cost(last_run.length_seconds)) end
                 ) as friend_json,
                 uptime_elapsed(f.streak_start, f.last_seen) as friend_order
            from profiles f
            left join lateral (
              select r.id, r.length_seconds
                from streak_runs r
               where r.user_id = f.id and r.reason = 'lapsed'
                 and r.revived_at is null and f.streak_start is null
               order by r.ended_at desc
               limit 1
            ) last_run on true
           where f.id <> me.id
             and (exists (select 1 from follows w
                           where w.follower_id = me.id and w.followee_id = f.id)
               or exists (select 1 from follows w
                           where w.follower_id = f.id and w.followee_id = me.id))
        ) friends), '[]'::jsonb),
    'recentGifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'fromUserId', g.from_user_id,
               'toUserId', g.to_user_id,
               'amount', g.amount_seconds,
               'createdAt', g.created_at,
               'revivedStreakId', g.revived_run_id) order by g.created_at desc)
        from (select * from gifts
               where from_user_id = me.id or to_user_id = me.id
               order by created_at desc limit 12) g), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- Boards carry a face too, so the podium has something to show.
create or replace function uptime_board(p_board text, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  with rows as (
    select p.id, p.handle, p.display_name, p.avatar_url,
           case p_board
             when 'current-streak' then uptime_elapsed(p.streak_start, p.last_seen)
             when 'longest-ever' then greatest(
               uptime_elapsed(p.streak_start, p.last_seen),
               coalesce((select max(length_seconds) from streak_runs r where r.user_id = p.id), 0))
             when 'lifetime-total' then
               p.lifetime_seconds + uptime_elapsed(p.streak_start, p.last_seen)
             when 'most-donated' then
               case when uptime_counts_toward_boards(p.id) then uptime_total_sent(p.id) else 0 end
             when 'most-received' then uptime_total_received(p.id)
             when 'most-revives' then
               case when uptime_counts_toward_boards(p.id)
                 then (select count(*) from gifts g
                        where g.from_user_id = p.id and g.revived_run_id is not null)
                 else 0 end
             else 0
           end as value
      from profiles p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', id,
           'handle', handle,
           'displayName', display_name,
           'avatarUrl', avatar_url,
           'value', value,
           'unit', case when p_board = 'most-revives' then 'count' else 'seconds' end
         ) order by value desc), '[]'::jsonb)
    from (select * from rows where value > 0 order by value desc limit p_limit) ranked;
$$;

-- Where the caller sits on a board, so a profile can say "3rd" without
-- shipping the whole table to the client to count it.
create or replace function uptime_my_rank(p_board text)
returns jsonb language sql stable security definer set search_path = public as $$
  with rows as (
    select p.id,
           case p_board
             when 'current-streak' then uptime_elapsed(p.streak_start, p.last_seen)
             when 'longest-ever' then greatest(
               uptime_elapsed(p.streak_start, p.last_seen),
               coalesce((select max(length_seconds) from streak_runs r where r.user_id = p.id), 0))
             when 'lifetime-total' then
               p.lifetime_seconds + uptime_elapsed(p.streak_start, p.last_seen)
             when 'most-donated' then
               case when uptime_counts_toward_boards(p.id) then uptime_total_sent(p.id) else 0 end
             when 'most-received' then uptime_total_received(p.id)
             when 'most-revives' then
               case when uptime_counts_toward_boards(p.id)
                 then (select count(*) from gifts g
                        where g.from_user_id = p.id and g.revived_run_id is not null)
                 else 0 end
             else 0
           end as value
      from profiles p
  ),
  ranked as (
    select id, value, rank() over (order by value desc) as position,
           count(*) over () as total
      from rows where value > 0
  )
  select coalesce((
    select jsonb_build_object('board', p_board, 'position', position, 'of', total, 'value', value)
      from ranked where id = auth.uid()), 'null'::jsonb);
$$;

grant execute on function uptime_set_avatar(text) to authenticated;
grant execute on function uptime_my_rank(text)    to authenticated, anon;

-- ==========================================================================
-- 0011_public_profiles.sql
-- ==========================================================================

-- Uptime: other people's profiles, and the word for the name you pick.
--
-- Two changes that belong together because both are about the moment one user
-- looks at another:
--
--   1. `uptime_profile`. Every list in the app draws names you can now tap,
--      including a leaderboard full of strangers, and nothing could read a
--      single account you were not already connected to. The friends array
--      inside `uptime_snapshot` is not that read - it exists to draw rows in a
--      list you are part of, and it stops at the edge of your own graph.
--
--   2. "Handle" becomes "Nickname" in every message a user can see. The column
--      keeps its name: `handle` is what it is in the schema, in the unique
--      index and in every function signature, and renaming a column to match a
--      caption is how a rename turns into an outage. Only the strings move.

-- --- a public profile -------------------------------------------------------

-- Everything one profile page needs, for any account, in one round trip.
--
-- Deliberately returns the two raw timestamps rather than a computed elapsed:
-- the client derives its own counter from `streakStart` against the ticking
-- clock, and a profile whose counter was a number frozen at fetch time would
-- be the one place in the app where somebody else's clock had stopped.
--
-- security definer, like every other read here, because RLS on `profiles`
-- confines a client to its own row. What is exposed is the same public shape
-- the boards already publish, plus the viewer's own relationship to it.
create or replace function uptime_profile(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  them profiles;
  last_run streak_runs;
begin
  select * into them from profiles where id = p_user;
  if not found then
    return 'null'::jsonb;
  end if;

  -- The revivable run: the most recent lapse nobody has bought back yet, and
  -- only while they are actually stopped. Same predicate the snapshot uses.
  select * into last_run
    from streak_runs r
   where r.user_id = them.id
     and r.reason = 'lapsed'
     and r.revived_at is null
     and them.streak_start is null
   order by r.ended_at desc
   limit 1;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', them.id,
      'handle', them.handle,
      'displayName', them.display_name,
      'avatarUrl', them.avatar_url,
      'createdAt', them.created_at),
    'streak', jsonb_build_object(
      'streakStart', them.streak_start,
      'lastSeen', them.last_seen),
    'lifetimeSeconds', them.lifetime_seconds,
    'personalBest', greatest(
      uptime_elapsed(them.streak_start, them.last_seen),
      coalesce((select max(length_seconds) from streak_runs where user_id = them.id), 0)),
    'totalSent', uptime_total_sent(them.id),
    'totalReceived', uptime_total_received(them.id),
    'rescues', (select count(*) from gifts g
                 where g.from_user_id = them.id and g.revived_run_id is not null),
    'connected', me_id is not null and uptime_connected(me_id, them.id),
    'iFollow', me_id is not null and exists (
      select 1 from follows w where w.follower_id = me_id and w.followee_id = them.id),
    'followsMe', me_id is not null and exists (
      select 1 from follows w where w.follower_id = them.id and w.followee_id = me_id),
    'revive', case when last_run.id is null then null else jsonb_build_object(
      'lostLength', last_run.length_seconds,
      'restores', uptime_revived_length(last_run.length_seconds),
      'cost', uptime_revive_cost(last_run.length_seconds)) end);
end;
$$;

grant execute on function uptime_profile(uuid) to authenticated, anon;

-- --- "handle" -> "nickname", in the strings only ----------------------------

create or replace function uptime_set_handle(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wanted text := lower(trim(p_handle));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;
  if wanted !~ '^[a-z0-9_]{2,24}$' then
    return jsonb_build_object('ok', false, 'message',
      'Nicknames are 2-24 characters, using letters, numbers and underscores.');
  end if;
  if exists (select 1 from profiles where handle = wanted and id <> auth.uid()) then
    return jsonb_build_object('ok', false, 'message', 'That nickname is taken.');
  end if;

  update profiles set handle = wanted where id = auth.uid();
  return jsonb_build_object('ok', true, 'message', 'Nickname updated.', 'snapshot', uptime_snapshot());
end;
$$;

create or replace function uptime_follow(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  target profiles;
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  select * into target from profiles where handle = lower(trim(p_handle));
  if not found then
    return jsonb_build_object('ok', false, 'message', 'No account with that nickname.');
  end if;
  if target.id = me_id then
    return jsonb_build_object('ok', false, 'message', 'That is you.');
  end if;

  insert into follows (follower_id, followee_id)
  values (me_id, target.id)
  on conflict do nothing;

  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', case
      when uptime_connected(me_id, target.id)
        then 'You and ' || target.display_name || ' can now send each other time.'
      else 'Following ' || target.display_name || '. Time can move once they follow you back.'
    end,
    'snapshot', uptime_snapshot());
end;
$$;

-- ==========================================================================
-- 0012_limits.sql
-- ==========================================================================

-- Uptime: bounds on reads, rate limits on writes.
--
-- Two different problems that get confused with each other, so they are solved
-- separately here.
--
--   Reads are not rate limited. `uptime_open` runs on every launch, every time
--   the window regains focus, and after every action; throttling it would
--   break the product. What was wrong with the reads is that their cost was
--   tied to how many accounts exist rather than to how much the caller asked
--   for - the snapshot scanned every profile in the table to find a dozen
--   friends, and the board built its answer over every profile before taking
--   the top twenty. Those are fixed by bounding and by indexing, below. A
--   genuine per-IP read limit belongs in front of PostgREST, not in SQL.
--
--   Writes are rate limited, because every one of them is a row somebody else
--   eventually has to read. `nudges` already proved the shape - one row per
--   user, checked before acting - and this generalises it rather than adding a
--   second bespoke table.

-- --- the bucket ------------------------------------------------------------

create table if not exists rate_limits (
  user_id            uuid   not null references profiles (id) on delete cascade,
  action             text   not null,
  window_started_at  bigint not null default uptime_now(),
  count              int    not null default 0,
  primary key (user_id, action)
);

-- No policy is added on purpose: RLS on with no policy denies every client
-- read, and the only thing that touches this table is a security-definer
-- function. A user who could read their own bucket could also see exactly how
-- close to a limit they were, which is a thing only a script wants to know.
alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

-- Count one use of `p_action`, and say whether it was allowed.
--
-- A fixed window rather than a sliding one: a sliding window needs a row per
-- event, which is the thing being defended against. The cost of the simpler
-- choice is that a caller can spend two windows' worth across a boundary, and
-- for limits set to "far more than a person does, far less than a script does"
-- that does not matter.
--
-- Written as one upsert rather than a select followed by an update, and that
-- is the whole reason this is a function. Two concurrent calls that each read
-- the count before either writes would both see room and both proceed, which
-- is exactly the burst a limit exists to stop. `on conflict do update` takes a
-- row lock, so the increments serialise.
create or replace function uptime_rate_ok(p_action text, p_max int, p_window bigint)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  uid  uuid := auth.uid();
  used int;
begin
  if uid is null then return false; end if;

  insert into rate_limits (user_id, action, window_started_at, count)
  values (uid, p_action, uptime_now(), 1)
  on conflict (user_id, action) do update
    -- Reset and increment are decided from the same expression, so a window
    -- that has expired starts over at one instead of continuing to climb.
    set window_started_at = case
          when uptime_now() - rate_limits.window_started_at >= p_window
            then uptime_now()
          else rate_limits.window_started_at
        end,
        count = case
          when uptime_now() - rate_limits.window_started_at >= p_window
            then 1
          else rate_limits.count + 1
        end
  returning count into used;

  return used <= p_max;
end;
$fn$;

-- --- bounds on the read model ---------------------------------------------

-- How many friends one snapshot will carry, and how much history.
--
-- Both were unbounded. `history` is every run the account has ever filed, sent
-- on every snapshot, so an account that had started and stopped its clock a
-- few thousand times made every subsequent read of its own profile heavier -
-- and nothing stopped it doing that, because start and stop had no cooldown.
--
-- Nothing client-side derives anything from these arrays: `personalBest` and
-- `lastRun` are their own fields, computed server-side over every row,
-- precisely so that truncating the list here changes what is displayed and not
-- what is true.
create or replace function uptime_snapshot_friend_cap() returns int
  language sql immutable as $fn$ select 100 $fn$;

create or replace function uptime_snapshot_history_cap() returns int
  language sql immutable as $fn$ select 50 $fn$;

create or replace function uptime_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  me profiles;
  result jsonb;
begin
  select * into me from profiles where id = auth.uid();
  if not found then
    raise exception 'No profile for the current user';
  end if;

  select jsonb_build_object(
    'serverNow', uptime_now(),
    'me', jsonb_build_object(
      'id', me.id,
      'handle', me.handle,
      'displayName', me.display_name,
      'avatarUrl', me.avatar_url,
      'createdAt', me.created_at,
      'streak', jsonb_build_object('streakStart', me.streak_start, 'lastSeen', me.last_seen),
      'lifetimeSeconds', me.lifetime_seconds,
      -- Newest N, handed back oldest-first. The inner order is what the limit
      -- applies to; the outer one is the order the client expects.
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
    'balance', uptime_balance(me.id),
    'totalSent', uptime_total_sent(me.id),
    'totalReceived', uptime_total_received(me.id),
    'sentInLastDay', uptime_sent_in_last_day(me.id),
    'lastRun', (
      select jsonb_build_object(
               'startedAt', r.started_at, 'endedAt', r.ended_at,
               'length', r.length_seconds, 'reason', r.reason,
               'revivedAt', r.revived_at)
        from streak_runs r where r.user_id = me.id
       order by r.ended_at desc limit 1),
    'personalBest', greatest(
      uptime_elapsed(me.streak_start, me.last_seen),
      coalesce((select max(length_seconds) from streak_runs where user_id = me.id), 0)),
    -- Driven from `follows`, not from `profiles`.
    --
    -- The previous version selected every row of `profiles` and asked, per
    -- row, whether either direction of a follow existed. That is a sequential
    -- scan of the whole user table on the app's hottest endpoint, and it got
    -- slower for everyone each time anybody signed up - including the
    -- throwaway accounts anonymous sign-in hands out for free. Starting from
    -- the caller's own follow rows makes the work proportional to how many
    -- people they actually follow, which is the number the result is about,
    -- and both directions are already indexed.
    'friends', coalesce((
      select jsonb_agg(friend_json order by friend_order desc)
        from (
          select jsonb_build_object(
                   'profile', jsonb_build_object(
                     'id', f.id, 'handle', f.handle,
                     'displayName', f.display_name,
                     'avatarUrl', f.avatar_url,
                     'createdAt', f.created_at),
                   'streak', jsonb_build_object('streakStart', f.streak_start, 'lastSeen', f.last_seen),
                   'connected', uptime_connected(me.id, f.id),
                   'iFollow', exists (select 1 from follows w
                                       where w.follower_id = me.id and w.followee_id = f.id),
                   'followsMe', exists (select 1 from follows w
                                         where w.follower_id = f.id and w.followee_id = me.id),
                   'revive', case when last_run.id is null then null else jsonb_build_object(
                     'lostLength', last_run.length_seconds,
                     'restores', uptime_revived_length(last_run.length_seconds),
                     'cost', uptime_revive_cost(last_run.length_seconds)) end
                 ) as friend_json,
                 uptime_elapsed(f.streak_start, f.last_seen) as friend_order
            from (
              select followee_id as id from follows where follower_id = me.id
              union
              select follower_id  as id from follows where followee_id = me.id
            ) rel
            join profiles f on f.id = rel.id
            left join lateral (
              select r.id, r.length_seconds
                from streak_runs r
               where r.user_id = f.id and r.reason = 'lapsed'
                 and r.revived_at is null and f.streak_start is null
               order by r.ended_at desc
               limit 1
            ) last_run on true
           where f.id <> me.id
           -- The output alias, not the expression again: ordering by the
           -- latter would evaluate `uptime_elapsed` a second time per friend
           -- purely to sort by a number already sitting in the row.
           order by friend_order desc
           limit uptime_snapshot_friend_cap()
        ) friends), '[]'::jsonb),
    'recentGifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'fromUserId', g.from_user_id,
               'toUserId', g.to_user_id,
               'amount', g.amount_seconds,
               'createdAt', g.created_at,
               'revivedStreakId', g.revived_run_id) order by g.created_at desc)
        from (select * from gifts
               where from_user_id = me.id or to_user_id = me.id
               order by created_at desc limit 12) g), '[]'::jsonb)
  ) into result;

  return result;
end;
$fn$;

-- The board, with a ceiling the caller cannot raise.
--
-- `p_limit` was passed straight into `LIMIT`. The anon key is in every shipped
-- bundle and this function is granted to `anon`, so anyone could ask for the
-- whole table and have the server build a JSONB array of it in memory - once
-- per request, as fast as they cared to send them.
create or replace function uptime_board(p_board text, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with capped as (select least(greatest(coalesce(p_limit, 20), 1), 100) as n),
  rows as (
    select p.id, p.handle, p.display_name, p.avatar_url,
           case p_board
             when 'current-streak' then uptime_elapsed(p.streak_start, p.last_seen)
             when 'longest-ever' then greatest(
               uptime_elapsed(p.streak_start, p.last_seen),
               coalesce((select max(length_seconds) from streak_runs r where r.user_id = p.id), 0))
             when 'lifetime-total' then
               p.lifetime_seconds + uptime_elapsed(p.streak_start, p.last_seen)
             when 'most-donated' then
               case when uptime_counts_toward_boards(p.id) then uptime_total_sent(p.id) else 0 end
             when 'most-received' then uptime_total_received(p.id)
             when 'most-revives' then
               case when uptime_counts_toward_boards(p.id)
                 then (select count(*) from gifts g
                        where g.from_user_id = p.id and g.revived_run_id is not null)
                 else 0 end
             else 0
           end as value
      from profiles p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', id,
           'handle', handle,
           'displayName', display_name,
           'avatarUrl', avatar_url,
           'value', value,
           'unit', case when p_board = 'most-revives' then 'count' else 'seconds' end
         ) order by value desc), '[]'::jsonb)
    from (select r.* from rows r
           where r.value > 0
           order by r.value desc
           limit (select n from capped)) ranked;
$fn$;

-- --- rate limits on the write surface --------------------------------------

-- Start and stop, with a cooldown.
--
-- These are the cheapest possible writes and the most expensive possible
-- habit: each stop files a `streak_runs` row that lives forever, is counted by
-- `personalBest` and by `longest-ever` on every read, and used to be
-- serialised into every snapshot. Nothing stopped a client calling the pair in
-- a loop. Twenty an hour is far past anything a person does - the product is
-- about a clock you leave alone - and far below what a loop achieves.
create or replace function uptime_start_streak()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me profiles;
begin
  if not uptime_rate_ok('streak_toggle', 20, 3600) then
    return jsonb_build_object('ok', false, 'message',
      'You have started and stopped your clock a lot just now. Try again shortly.');
  end if;

  perform uptime_sweep_user(auth.uid());
  select * into me from profiles where id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if me.streak_start is not null then
    return jsonb_build_object('ok', false, 'message', 'A streak is already running.');
  end if;

  update profiles set streak_start = uptime_now(), last_seen = uptime_now() where id = me.id;
  return jsonb_build_object(
    'ok', true, 'message', 'Your clock is running.', 'snapshot', uptime_snapshot());
end;
$fn$;

create or replace function uptime_stop_streak()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me profiles;
  ran bigint;
begin
  if not uptime_rate_ok('streak_toggle', 20, 3600) then
    return jsonb_build_object('ok', false, 'message',
      'You have started and stopped your clock a lot just now. Try again shortly.');
  end if;

  perform uptime_sweep_user(auth.uid());
  select * into me from profiles where id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if me.streak_start is null then
    return jsonb_build_object('ok', false, 'message', 'No streak running.');
  end if;

  ran := greatest(0, uptime_now() - me.streak_start);

  insert into streak_runs (user_id, started_at, ended_at, length_seconds, reason)
  values (me.id, me.streak_start, uptime_now(), ran, 'voluntary');

  update profiles
     set streak_start = null,
         lifetime_seconds = lifetime_seconds + ran,
         last_seen = uptime_now()
   where id = me.id;

  return jsonb_build_object(
    'ok', true,
    'message', 'You stopped your own clock after ' || (ran / 86400)::int || ' days.',
    'snapshot', uptime_snapshot());
end;
$fn$;

-- Following, through the function only, and with a ceiling.
--
-- `grant insert on follows to authenticated` let a client write follow rows
-- directly, so `uptime_follow` was advice rather than a gate: a script could
-- insert one row per account in the table. That is a self-inflicted outage
-- before it is an attack - the snapshot's friends list is built from exactly
-- these rows - and it inflates every other member's `followsMe` checks too.
--
-- The privilege is withdrawn and the cap lives here instead. `uptime_unfollow`
-- already existed, so nothing legitimate needed the direct write.
revoke insert, delete on follows from authenticated;

create or replace function uptime_max_follows() returns int
  language sql immutable as $fn$ select 2000 $fn$;

create or replace function uptime_follow(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id uuid := auth.uid();
  target profiles;
  held  int;
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  if not uptime_rate_ok('follow', 60, 3600) then
    return jsonb_build_object('ok', false, 'message',
      'That is a lot of following in one go. Try again shortly.');
  end if;

  select count(*) into held from follows where follower_id = me_id;
  if held >= uptime_max_follows() then
    return jsonb_build_object('ok', false, 'message',
      'You are following as many people as one account can.');
  end if;

  select * into target from profiles where handle = lower(trim(p_handle));
  if not found then
    return jsonb_build_object('ok', false, 'message', 'No account with that nickname.');
  end if;
  if target.id = me_id then
    return jsonb_build_object('ok', false, 'message', 'That is you.');
  end if;

  insert into follows (follower_id, followee_id)
  values (me_id, target.id)
  on conflict do nothing;

  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', case
      when uptime_connected(me_id, target.id)
        then 'You and ' || target.display_name || ' can now send each other time.'
      else 'Following ' || target.display_name || '. Time can move once they follow you back.'
    end,
    'snapshot', uptime_snapshot());
end;
$fn$;

-- Avatar writes, limited by count rather than by size.
--
-- The client now re-encodes every picture to a 512px square of a few tens of
-- kilobytes, so size is no longer the exposure - frequency is. Each call is a
-- storage write plus a delete sweep, and nothing stopped a loop.
create or replace function uptime_set_avatar(p_url text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id uuid := auth.uid();
  wanted text := nullif(trim(coalesce(p_url, '')), '');
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  if not uptime_rate_ok('set_avatar', 30, 3600) then
    return jsonb_build_object('ok', false, 'message',
      'You have changed your picture a lot just now. Try again shortly.');
  end if;

  if wanted is not null and wanted !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/' || me_id::text || '/') then
    return jsonb_build_object('ok', false, 'message', 'That image is not in your own avatar folder.');
  end if;

  update profiles set avatar_url = wanted where id = me_id;
  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', case when wanted is null then 'Photo removed.' else 'Photo updated.' end,
    'snapshot', uptime_snapshot());
end;
$fn$;

-- Renames, limited because a freely changing name on a public leaderboard is
-- how one account impersonates another faster than anyone can report it. The
-- uniqueness check also probes the handle index on every call.
create or replace function uptime_set_handle(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  wanted text := lower(trim(p_handle));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;
  if not uptime_rate_ok('set_handle', 10, 86400) then
    return jsonb_build_object('ok', false, 'message',
      'Nicknames can be changed a few times a day. Try again tomorrow.');
  end if;
  if wanted !~ '^[a-z0-9_]{2,24}$' then
    return jsonb_build_object('ok', false, 'message',
      'Nicknames are 2-24 characters, using letters, numbers and underscores.');
  end if;
  if exists (select 1 from profiles where handle = wanted and id <> auth.uid()) then
    return jsonb_build_object('ok', false, 'message', 'That nickname is taken.');
  end if;

  update profiles set handle = wanted where id = auth.uid();
  return jsonb_build_object('ok', true, 'message', 'Nickname updated.', 'snapshot', uptime_snapshot());
end;
$fn$;

-- --- indexes ---------------------------------------------------------------

-- The nightly sweep's own predicate. Without this it is a sequential scan of
-- every profile to find the few whose window has closed. Partial, because rows
-- with no run in progress are the majority over time and are never candidates.
create index if not exists profiles_due_idx
  on profiles (last_seen) where streak_start is not null;

-- The rescues board counts only gifts that revived something.
create index if not exists gifts_revives_idx
  on gifts (from_user_id) where revived_run_id is not null;

-- The snapshot's lateral join, once per friend.
create index if not exists streak_runs_lapsed_idx
  on streak_runs (user_id, ended_at desc) where reason = 'lapsed' and revived_at is null;

grant execute on function uptime_rate_ok(text, int, bigint) to authenticated;

-- ==========================================================================
-- 0013_clock_transfers_and_scale.sql
-- ==========================================================================

-- Uptime: time moves between clocks, and every read costs what it returns.
--
-- Three changes that share one file because they touch the same functions:
--
--   1. Sending time is a transfer between running clocks. There is no longer a
--      separate bank accruing a tenth of the time kept: what you can send is
--      your own running clock, a gift takes the time straight off it, and the
--      recipient's clock gains exactly that much. A revive is paid the same way,
--      off the reviver's clock. Nothing ticks, so a clock is `now -
--      streak_start` and moving time means moving `streak_start` - later for
--      the sender, earlier for the recipient.
--
--   2. The reads that scaled with the size of the user table no longer do.
--      Every leaderboard used to evaluate a value for every profile in the
--      table - with a correlated sum over the ledger per row - and then keep
--      twenty. `uptime_my_rank` did the same and then windowed over all of it.
--      Those numbers now live on the profile as counters, maintained in the
--      same transaction as the ledger row that changes them, and each board is
--      an index scan that stops after the rows it returns.
--
--   3. The functions a client should never call are no longer callable.
--      Postgres grants EXECUTE on a new function to PUBLIC, and Supabase grants
--      it to `anon` and `authenticated` on top, so the anon key shipped in every
--      bundle could call `uptime_touch(anyone)` - keeping any streak alive
--      forever - run the lapse sweep with any limit it liked, and read every
--      registered push token through `uptime_due_for_nudge`.

-- ==========================================================================
-- Counters on the profile
-- ==========================================================================

-- The ledger stays the truth; these are the parts of it that reads need in
-- O(1). Each is maintained by the statement that changes it (see
-- `uptime_gift_counters` and the run-filing functions below) and can always be
-- rebuilt from scratch by the backfill at the end of this section.
--
-- `is_anonymous` mirrors auth.users so the boards can filter on an indexed
-- column instead of reaching into the auth schema once per row. It is synced
-- whenever the account opens the app (`uptime_open`), which is the first thing
-- that happens after an upgrade, so an upgraded account is ranked on its next
-- read - the same guarantee the auth lookup gave. The send and revive gates
-- still read auth.users directly: those are the checks that must never lag.
alter table profiles add column if not exists is_anonymous     boolean not null default true;
alter table profiles add column if not exists best_run_seconds bigint  not null default 0;
alter table profiles add column if not exists total_sent       bigint  not null default 0;
alter table profiles add column if not exists total_received   bigint  not null default 0;
alter table profiles add column if not exists rescues          int     not null default 0;

-- Rebuilt from the ledger, writing only rows that are actually wrong: this
-- file is also pasted whole via deploy.sql, and a re-run must not rewrite every
-- profile in the table to set each counter to the value it already holds.
with truth as (
  select p.id,
         coalesce((select u.is_anonymous from auth.users u where u.id = p.id), true) as is_anonymous,
         coalesce((select max(r.length_seconds) from streak_runs r where r.user_id = p.id), 0) as best_run_seconds,
         coalesce((select sum(g.amount_seconds) from gifts g where g.from_user_id = p.id), 0) as total_sent,
         coalesce((select sum(g.amount_seconds) from gifts g where g.to_user_id = p.id), 0) as total_received,
         coalesce((select count(*) from gifts g
                    where g.from_user_id = p.id and g.revived_run_id is not null), 0) as rescues
    from profiles p
)
update profiles p
   set is_anonymous     = truth.is_anonymous,
       best_run_seconds = truth.best_run_seconds,
       total_sent       = truth.total_sent,
       total_received   = truth.total_received,
       rescues          = truth.rescues
  from truth
 where p.id = truth.id
   and (p.is_anonymous, p.best_run_seconds, p.total_sent, p.total_received, p.rescues)
       is distinct from
       (truth.is_anonymous, truth.best_run_seconds, truth.total_sent, truth.total_received, truth.rescues);

-- Kept in step with the ledger by a trigger rather than by each writer, because
-- gifts also change without any function of ours running: deleting an account
-- cascades its gifts away, and deleting a revived run nulls `revived_run_id`.
-- Either would otherwise leave a board counting rows that no longer exist.
create or replace function uptime_gift_counters()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update profiles
       set total_sent = greatest(0, total_sent - old.amount_seconds),
           rescues    = greatest(0, rescues - (old.revived_run_id is not null)::int)
     where id = old.from_user_id;
    update profiles
       set total_received = greatest(0, total_received - old.amount_seconds)
     where id = old.to_user_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update profiles
       set total_sent = total_sent + new.amount_seconds,
           rescues    = rescues + (new.revived_run_id is not null)::int
     where id = new.from_user_id;
    update profiles
       set total_received = total_received + new.amount_seconds
     where id = new.to_user_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists gift_counters on gifts;
create trigger gift_counters
  after insert or delete or update of amount_seconds, from_user_id, to_user_id, revived_run_id
  on gifts for each row execute function uptime_gift_counters();

-- The counters are server-managed exactly like the clock is. Clients hold no
-- update privilege on profiles at all; this is the backstop if one is granted.
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
     or new.rescues is distinct from old.rescues then
    raise exception 'Streak fields are managed by the server';
  end if;
  return new;
end;
$fn$;

create or replace function uptime_sync_anonymity(p_user uuid)
returns void language sql security definer set search_path = public, auth as $fn$
  update public.profiles p
     set is_anonymous = coalesce(u.is_anonymous, true)
    from auth.users u
   where p.id = p_user
     and u.id = p_user
     and p.is_anonymous is distinct from coalesce(u.is_anonymous, true);
$fn$;

-- ==========================================================================
-- The economy: your clock is the currency
-- ==========================================================================

-- What an account can send: everything on its running clock, nothing on a
-- stopped or lapsed one. Kept under its old name because the snapshot and the
-- client both call it the balance.
create or replace function uptime_balance(p_user uuid)
returns bigint language sql stable as $fn$
  select uptime_elapsed(p.streak_start, p.last_seen) from profiles p where p.id = p_user;
$fn$;

-- The revive price per restored second, no longer borrowed from an accrual
-- rate that no longer exists. Mirrors REVIVE_COST_PER_RESTORED_SECOND.
create or replace function uptime_revive_cost_rate() returns numeric
  language sql immutable as $fn$ select 0.1::numeric $fn$;

create or replace function uptime_revive_cost(p_lost bigint)
returns bigint language sql immutable as $fn$
  select ceil(uptime_revived_length(p_lost) * uptime_revive_cost_rate())::bigint;
$fn$;

drop function if exists uptime_accrual_rate();

-- Sending time: off your clock, onto theirs.
--
-- Both rows are locked before anything else, in id order. The old version
-- locked the sender and then touched the recipient, and the sweeps before it
-- each locked a row of their own, so two people sending to each other at the
-- same moment took the same two locks in opposite orders and one of them was
-- killed as a deadlock. Now that both clocks move, both rows are written, and
-- a fixed order is what makes that safe.
create or replace function uptime_send_time(p_to uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id     uuid := auth.uid();
  me        profiles;
  recipient profiles;
  t         bigint;
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

  t := uptime_now();
  if me.streak_start is null or p_amount > t - me.streak_start then
    return jsonb_build_object('ok', false, 'message',
      case when me.streak_start is null or t - me.streak_start <= 0
        then 'Your clock has no time on it to send.'
        else 'That''s more than your clock has on it.' end);
  end if;

  if uptime_sent_in_last_day(me_id) + p_amount > uptime_max_sent_per_day() then
    return jsonb_build_object('ok', false, 'message',
      'You have hit today''s sending limit. It resets on a rolling 24 hours.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds, created_at)
  values (me_id, p_to, p_amount, t);

  -- The transfer. Both sides are a sign of life, as they always were.
  update profiles set streak_start = streak_start + p_amount, last_seen = t where id = me_id;
  update profiles set streak_start = streak_start - p_amount, last_seen = t where id = p_to;

  return jsonb_build_object(
    'ok', true,
    'message', 'Sent to ' || recipient.display_name || '. It''s on their clock now.',
    'snapshot', uptime_snapshot());
end;
$fn$;

-- Reviving: paid off the reviver's clock, restoring half the lost run.
--
-- The price is burned rather than handed over - what the friend gets back is
-- the restored run the offer names, not the restored run plus the price. It is
-- still filed as a gift from reviver to friend, which is what the rescues
-- board counts. Locks both rows in id order, for the reason given above.
create or replace function uptime_revive(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id    uuid := auth.uid();
  me       profiles;
  friend   profiles;
  last_run streak_runs;
  cost     bigint;
  restores bigint;
  t        bigint;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if uptime_is_anonymous(me_id) then
    return jsonb_build_object('ok', false, 'message',
      'Create an account to revive a friend. Your streak carries over.');
  end if;

  perform 1 from profiles where id in (me_id, p_user) order by id for update;
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_user);

  select * into friend from profiles where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;
  select * into me from profiles where id = me_id;

  if not uptime_connected(me_id, p_user) then
    return jsonb_build_object('ok', false, 'message', 'You can only revive people you both follow.');
  end if;
  if friend.streak_start is not null then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has a streak running.');
  end if;

  select * into last_run from streak_runs
   where user_id = p_user and reason = 'lapsed' and revived_at is null
   order by ended_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has no broken streak to revive.');
  end if;

  cost := uptime_revive_cost(last_run.length_seconds);
  restores := uptime_revived_length(last_run.length_seconds);
  t := uptime_now();

  if me.streak_start is null then
    return jsonb_build_object('ok', false, 'message',
      'Your clock isn''t running, so there''s no time to pay with.');
  end if;
  if cost > t - me.streak_start then
    return jsonb_build_object('ok', false, 'message', 'Not enough time on your clock for this rescue.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds, created_at, revived_run_id)
  values (me_id, p_user, cost, t, last_run.id);

  update streak_runs set revived_at = t where id = last_run.id;

  update profiles
     set streak_start = t - restores,
         last_seen = t,
         lifetime_seconds = greatest(0, lifetime_seconds - last_run.length_seconds)
   where id = p_user;

  update profiles set streak_start = streak_start + cost, last_seen = t where id = me_id;

  return jsonb_build_object(
    'ok', true,
    'message', 'You brought ' || friend.display_name || ' back at ' || (restores / 86400)::int || ' days.',
    'snapshot', uptime_snapshot());
end;
$fn$;

-- ==========================================================================
-- Filing runs keeps the best run current
-- ==========================================================================

create or replace function uptime_sweep_user(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  me  profiles;
  ran bigint;
begin
  select * into me from profiles where id = p_user for update;
  if not found or not uptime_has_lapsed(me.streak_start, me.last_seen) then
    return false;
  end if;

  ran := uptime_run_length(me.streak_start, me.last_seen);

  insert into streak_runs (user_id, started_at, ended_at, length_seconds, reason)
  values (me.id, me.streak_start, me.last_seen + uptime_check_in_window(), ran, 'lapsed');

  update profiles
     set streak_start = null,
         lifetime_seconds = lifetime_seconds + ran,
         best_run_seconds = greatest(best_run_seconds, ran)
   where id = me.id;

  return true;
end;
$fn$;

-- The scheduled sweep, as one statement over a batch instead of a loop of
-- single-row functions.
--
-- The predicate is written against the bare column (`last_seen <= cutoff`)
-- rather than as `now >= last_seen + window`, because Postgres will not
-- rearrange arithmetic around a column to reach an index: the old spelling
-- read every running profile to find the handful that had lapsed.
-- `skip locked` lets it step round a row an action is holding rather than
-- queueing behind it; the next pass, or that action's own sweep, files it.
create or replace function uptime_sweep_lapsed(p_limit int default 5000)
returns int language plpgsql security definer set search_path = public as $fn$
declare
  cutoff bigint := uptime_now() - uptime_check_in_window();
  swept  int;
begin
  with due as (
    select id, streak_start, last_seen
      from profiles
     where streak_start is not null
       and last_seen <= cutoff
     order by last_seen
     limit greatest(1, least(coalesce(p_limit, 5000), 50000))
       for update skip locked
  ),
  filed as (
    insert into streak_runs (user_id, started_at, ended_at, length_seconds, reason)
    select id, streak_start, last_seen + uptime_check_in_window(),
           uptime_run_length(streak_start, last_seen), 'lapsed'
      from due
  )
  update profiles p
     set streak_start = null,
         lifetime_seconds = p.lifetime_seconds + uptime_run_length(due.streak_start, due.last_seen),
         best_run_seconds = greatest(p.best_run_seconds, uptime_run_length(due.streak_start, due.last_seen))
    from due
   where p.id = due.id;

  get diagnostics swept = row_count;
  return swept;
end;
$fn$;

create or replace function uptime_stop_streak()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me  profiles;
  ran bigint;
begin
  if not uptime_rate_ok('streak_toggle', 20, 3600) then
    return jsonb_build_object('ok', false, 'message',
      'You have started and stopped your clock a lot just now. Try again shortly.');
  end if;

  perform uptime_sweep_user(auth.uid());
  select * into me from profiles where id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;

  if me.streak_start is null then
    return jsonb_build_object('ok', false, 'message', 'No streak running.');
  end if;

  ran := greatest(0, uptime_now() - me.streak_start);

  insert into streak_runs (user_id, started_at, ended_at, length_seconds, reason)
  values (me.id, me.streak_start, uptime_now(), ran, 'voluntary');

  update profiles
     set streak_start = null,
         lifetime_seconds = lifetime_seconds + ran,
         best_run_seconds = greatest(best_run_seconds, ran),
         last_seen = uptime_now()
   where id = me.id;

  return jsonb_build_object(
    'ok', true,
    'message', 'You stopped your own clock after ' || (ran / 86400)::int || ' days.',
    'snapshot', uptime_snapshot());
end;
$fn$;

-- Same fix as the sweep: the window test against the bare column, so the
-- partial index on running profiles' last_seen does the finding.
create or replace function uptime_due_for_nudge(p_limit int default 1000)
returns table (user_id uuid, handle text, deadline bigint, platform text, token text)
language sql stable security definer set search_path = public as $fn$
  select p.id, p.handle, p.last_seen + uptime_check_in_window(), d.platform, d.token
    from profiles p
    join device_tokens d on d.user_id = p.id
    left join nudges n on n.user_id = p.id
   where p.streak_start is not null
     -- Inside the lead, but not yet lapsed.
     and p.last_seen <= uptime_now() - uptime_check_in_window() + 7 * 86400
     and p.last_seen >  uptime_now() - uptime_check_in_window()
     and (n.user_id is null or n.deadline is distinct from p.last_seen + uptime_check_in_window())
   order by p.last_seen
   limit greatest(1, least(coalesce(p_limit, 1000), 10000));
$fn$;

-- ==========================================================================
-- Opening the app
-- ==========================================================================

create or replace function uptime_ensure_profile(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  insert into profiles (id, handle, display_name, is_anonymous)
  values (uid, p_handle, initcap(p_handle), uptime_is_anonymous(uid))
  on conflict (id) do update set last_seen = uptime_now();

  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function uptime_open()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  anchor bigint;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform uptime_sweep_user(auth.uid());
  -- An upgrade flips auth.users.is_anonymous; this is where the boards hear
  -- about it. See the note on the column.
  perform uptime_sync_anonymity(auth.uid());
  select last_seen into anchor from profiles where id = auth.uid();
  perform uptime_touch(auth.uid());

  return jsonb_set(uptime_snapshot(), '{windowAnchor}', to_jsonb(anchor));
end;
$fn$;

-- Has anything moved? One primary-key read, for the client's timer.
--
-- Somebody sending you time changes your clock while you are looking at it.
-- An open app asks this every half minute and only re-reads the snapshot when
-- the answer changed, so the cost of noticing a gift is one index lookup per
-- open client rather than one friend list per open client. Read-only, and
-- deliberately not a sign of life: a tab left open is not a person.
create or replace function uptime_pulse()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
           'serverNow', uptime_now(),
           'streakStart', p.streak_start,
           'totalReceived', p.total_received)
    from profiles p
   where p.id = auth.uid();
$fn$;

-- ==========================================================================
-- The read model
-- ==========================================================================

-- The snapshot, with every per-row cost bounded by the size of the answer.
--
--   - Totals and the personal best come off the profile's counters instead of
--     a sum over the whole ledger and a max over every run.
--   - The friends list is ordered and cut to its cap *before* anything is done
--     per friend. The old one ran the revive lookup and three follow probes for
--     every account the caller was linked to - up to four thousand at the
--     follow cap - and then threw all but a hundred away.
--   - Which way each follow points comes from the same two index scans that
--     found the friends, rather than from three more probes per friend.
--   - Recent gifts are the newest dozen from each direction merged, instead of
--     an OR that fetched and sorted every gift the account was ever part of.
create or replace function uptime_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  me profiles;
  t  bigint := uptime_now();
  result jsonb;
begin
  select * into me from profiles where id = auth.uid();
  if not found then
    raise exception 'No profile for the current user';
  end if;

  select jsonb_build_object(
    'serverNow', t,
    'me', jsonb_build_object(
      'id', me.id,
      'handle', me.handle,
      'displayName', me.display_name,
      'avatarUrl', me.avatar_url,
      'createdAt', me.created_at,
      'streak', jsonb_build_object('streakStart', me.streak_start, 'lastSeen', me.last_seen),
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
    'balance', uptime_elapsed(me.streak_start, me.last_seen, t),
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

create or replace function uptime_profile(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  me_id uuid := auth.uid();
  them profiles;
  last_run streak_runs;
begin
  select * into them from profiles where id = p_user;
  if not found then
    return 'null'::jsonb;
  end if;

  select * into last_run
    from streak_runs r
   where r.user_id = them.id
     and r.reason = 'lapsed'
     and r.revived_at is null
     and them.streak_start is null
   order by r.ended_at desc
   limit 1;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', them.id,
      'handle', them.handle,
      'displayName', them.display_name,
      'avatarUrl', them.avatar_url,
      'createdAt', them.created_at),
    'streak', jsonb_build_object(
      'streakStart', them.streak_start,
      'lastSeen', them.last_seen),
    'lifetimeSeconds', them.lifetime_seconds,
    'personalBest', greatest(uptime_elapsed(them.streak_start, them.last_seen), them.best_run_seconds),
    'totalSent', them.total_sent,
    'totalReceived', them.total_received,
    'rescues', them.rescues,
    'connected', me_id is not null and uptime_connected(me_id, them.id),
    'iFollow', me_id is not null and exists (
      select 1 from follows w where w.follower_id = me_id and w.followee_id = them.id),
    'followsMe', me_id is not null and exists (
      select 1 from follows w where w.follower_id = them.id and w.followee_id = me_id),
    'revive', case when last_run.id is null then null else jsonb_build_object(
      'lostLength', last_run.length_seconds,
      'restores', uptime_revived_length(last_run.length_seconds),
      'cost', uptime_revive_cost(last_run.length_seconds)) end);
end;
$fn$;

-- ==========================================================================
-- Leaderboards that stop after the rows they return
-- ==========================================================================

-- One partial index per board, each restricted to the rows that board can
-- ever show, so an index scan with a LIMIT reads twenty entries and stops.
--
-- `not is_anonymous` is part of every predicate, which also restores a rule
-- that had quietly gone missing: 0009 kept anonymous accounts off the boards,
-- and the versions of uptime_board and uptime_my_rank in 0010 and 0012 were
-- rebuilt without that filter.
create index if not exists profiles_board_running_idx
  on profiles (streak_start, id) where streak_start is not null and not is_anonymous;
create index if not exists profiles_board_best_idx
  on profiles (best_run_seconds desc) where best_run_seconds > 0 and not is_anonymous;
create index if not exists profiles_board_career_running_idx
  on profiles ((lifetime_seconds - streak_start) desc) where streak_start is not null and not is_anonymous;
create index if not exists profiles_board_career_idx
  on profiles (lifetime_seconds desc) where lifetime_seconds > 0 and not is_anonymous;
create index if not exists profiles_board_sent_idx
  on profiles (total_sent desc, id) where total_sent > 0 and not is_anonymous;
create index if not exists profiles_board_received_idx
  on profiles (total_received desc, id) where total_received > 0 and not is_anonymous;
create index if not exists profiles_board_rescues_idx
  on profiles (rescues desc, id) where rescues > 0 and not is_anonymous;

-- The snapshot's `lastRun` and history, newest first per account.
create index if not exists streak_runs_recent_idx on streak_runs (user_id, ended_at desc);

-- The top of one board, as (id, value) rows in order.
--
-- Two boards rank by a value that is partly still running. "Running now" is
-- `now - streak_start`, which orders exactly as `streak_start` ascending, so
-- the index on the start is the index on the clock. "Hall of fame" is the
-- larger of the live run and the best closed one, and "Career total" is the
-- closed runs plus the live one; neither is one column. Both are answered as
-- the top N of each part merged: anyone in the true top N is necessarily in the
-- top N of whichever part their value comes from, so the merge of the two
-- short lists contains the whole answer.
create or replace function uptime_board_top(p_board text, p_limit int)
returns table (id uuid, value bigint)
language plpgsql stable security definer set search_path = public as $fn$
#variable_conflict use_column
declare
  t     bigint := uptime_now();
  alive bigint := uptime_now() - uptime_check_in_window();  -- last_seen after this: still running
  aged  bigint := uptime_now() - uptime_min_account_age();  -- created_at at or before this: counts
begin
  case p_board
  when 'current-streak' then
    return query
      select p.id, t - p.streak_start
        from profiles p
       where p.streak_start is not null and not p.is_anonymous
         and p.last_seen > alive and p.streak_start < t
       order by p.streak_start, p.id
       limit p_limit;

  when 'longest-ever' then
    return query
      select c.id, c.v from (
        select p.id,
               greatest(case when p.streak_start is not null and p.last_seen > alive
                             then t - p.streak_start else 0 end,
                        p.best_run_seconds) as v
          from profiles p
         where p.id in (
                 (select q.id from profiles q
                   where q.streak_start is not null and not q.is_anonymous
                     and q.last_seen > alive and q.streak_start < t
                   order by q.streak_start
                   limit p_limit)
                 union
                 (select q.id from profiles q
                   where q.best_run_seconds > 0 and not q.is_anonymous
                   order by q.best_run_seconds desc
                   limit p_limit))
      ) c
       where c.v > 0
       order by c.v desc, c.id
       limit p_limit;

  when 'lifetime-total' then
    return query
      select c.id, c.v from (
        select p.id,
               p.lifetime_seconds + case when p.streak_start is not null and p.last_seen > alive
                                         then t - p.streak_start else 0 end as v
          from profiles p
         where p.id in (
                 (select q.id from profiles q
                   where q.streak_start is not null and not q.is_anonymous and q.last_seen > alive
                   order by (q.lifetime_seconds - q.streak_start) desc
                   limit p_limit)
                 union
                 (select q.id from profiles q
                   where q.lifetime_seconds > 0 and not q.is_anonymous
                   order by q.lifetime_seconds desc
                   limit p_limit))
      ) c
       where c.v > 0
       order by c.v desc, c.id
       limit p_limit;

  when 'most-donated' then
    return query
      select p.id, p.total_sent
        from profiles p
       where p.total_sent > 0 and not p.is_anonymous and p.created_at <= aged
       order by p.total_sent desc, p.id
       limit p_limit;

  when 'most-received' then
    return query
      select p.id, p.total_received
        from profiles p
       where p.total_received > 0 and not p.is_anonymous
       order by p.total_received desc, p.id
       limit p_limit;

  when 'most-revives' then
    return query
      select p.id, p.rescues::bigint
        from profiles p
       where p.rescues > 0 and not p.is_anonymous and p.created_at <= aged
       order by p.rescues desc, p.id
       limit p_limit;

  else
    return;
  end case;
end;
$fn$;

create or replace function uptime_board(p_board text, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', p.id,
           'handle', p.handle,
           'displayName', p.display_name,
           'avatarUrl', p.avatar_url,
           'value', b.value,
           'unit', case when p_board = 'most-revives' then 'count' else 'seconds' end
         ) order by b.value desc, p.id), '[]'::jsonb)
    from uptime_board_top(p_board, least(greatest(coalesce(p_limit, 20), 1), 100)) b
    join profiles p on p.id = b.id;
$fn$;

-- How many accounts are on each board, remembered for a few minutes.
--
-- "12th of 40,312" needs the 40,312, and counting a board is a pass over its
-- whole index - fine once, not once per person opening their Account tab. The
-- figure is a denominator on a caption; ten minutes stale is invisible, and
-- `uptime_my_rank` never lets it read smaller than the position it sits under.
create table if not exists board_sizes (
  board        text   primary key,
  total        bigint not null,
  computed_at  bigint not null
);

alter table board_sizes enable row level security;
revoke all on board_sizes from anon, authenticated;

create or replace function uptime_board_size_ttl() returns bigint
  language sql immutable as $fn$ select 600::bigint $fn$;

create or replace function uptime_board_size(p_board text)
returns bigint language plpgsql volatile security definer set search_path = public as $fn$
declare
  t      bigint := uptime_now();
  alive  bigint := uptime_now() - uptime_check_in_window();
  aged   bigint := uptime_now() - uptime_min_account_age();
  cached board_sizes;
  n      bigint;
begin
  if p_board not in ('current-streak', 'longest-ever', 'lifetime-total',
                     'most-donated', 'most-received', 'most-revives') then
    return 0;
  end if;

  select * into cached from board_sizes where board = p_board;
  if found and t - cached.computed_at < uptime_board_size_ttl() then
    return cached.total;
  end if;

  n := case p_board
    when 'current-streak' then
      (select count(*) from profiles p
        where p.streak_start is not null and not p.is_anonymous
          and p.last_seen > alive and p.streak_start < t)
    when 'longest-ever' then
      (select count(*) from profiles p where p.best_run_seconds > 0 and not p.is_anonymous)
      + (select count(*) from profiles p
          where p.streak_start is not null and not p.is_anonymous
            and p.last_seen > alive and p.streak_start < t and p.best_run_seconds = 0)
    when 'lifetime-total' then
      (select count(*) from profiles p where p.lifetime_seconds > 0 and not p.is_anonymous)
      + (select count(*) from profiles p
          where p.streak_start is not null and not p.is_anonymous
            and p.last_seen > alive and p.streak_start < t and p.lifetime_seconds = 0)
    when 'most-donated' then
      (select count(*) from profiles p
        where p.total_sent > 0 and not p.is_anonymous and p.created_at <= aged)
    when 'most-received' then
      (select count(*) from profiles p where p.total_received > 0 and not p.is_anonymous)
    when 'most-revives' then
      (select count(*) from profiles p
        where p.rescues > 0 and not p.is_anonymous and p.created_at <= aged)
  end;

  insert into board_sizes (board, total, computed_at) values (p_board, n, t)
  on conflict (board) do update set total = excluded.total, computed_at = excluded.computed_at;
  return n;
end;
$fn$;

-- Where the caller sits: one plus everyone strictly ahead, which is what SQL's
-- rank() gives, counted along the same indexes the board reads. The count
-- still grows with the placing - 40,000th means reading 40,000 index entries -
-- but it no longer grows with the size of the table, and nobody's first page
-- of the board pays for anybody else's placing.
create or replace function uptime_my_rank(p_board text)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  t      bigint := uptime_now();
  alive  bigint := uptime_now() - uptime_check_in_window();
  aged   bigint := uptime_now() - uptime_min_account_age();
  me     profiles;
  live   bigint;
  mine   bigint;
  above  bigint := 0;
  extra  bigint := 0;
begin
  select * into me from profiles where id = auth.uid();
  if not found or me.is_anonymous then
    return 'null'::jsonb;
  end if;

  live := case when me.streak_start is not null and me.last_seen > alive
               then t - me.streak_start else 0 end;
  mine := case p_board
    when 'current-streak' then live
    when 'longest-ever'   then greatest(live, me.best_run_seconds)
    when 'lifetime-total' then me.lifetime_seconds + live
    when 'most-donated'   then case when me.created_at <= aged then me.total_sent else 0 end
    when 'most-received'  then me.total_received
    when 'most-revives'   then case when me.created_at <= aged then me.rescues else 0 end
    else 0
  end;
  if mine <= 0 then
    return 'null'::jsonb;
  end if;

  case p_board
  when 'current-streak' then
    select count(*) into above from profiles p
     where p.streak_start is not null and not p.is_anonymous
       and p.last_seen > alive and p.streak_start < me.streak_start;

  when 'longest-ever' then
    -- Ahead on a closed run, plus ahead on the live run alone.
    select count(*) into above from profiles p
     where p.best_run_seconds > 0 and not p.is_anonymous and p.best_run_seconds > mine;
    select count(*) into extra from profiles p
     where p.streak_start is not null and not p.is_anonymous
       and p.last_seen > alive and p.streak_start < t - mine
       and p.best_run_seconds <= mine;

  when 'lifetime-total' then
    -- Running: lifetime + (t - start) > mine, rearranged onto the index.
    select count(*) into above from profiles p
     where p.streak_start is not null and not p.is_anonymous and p.last_seen > alive
       and (p.lifetime_seconds - p.streak_start) > mine - t;
    select count(*) into extra from profiles p
     where p.lifetime_seconds > 0 and not p.is_anonymous and p.lifetime_seconds > mine
       and not (p.streak_start is not null and p.last_seen > alive);

  when 'most-donated' then
    select count(*) into above from profiles p
     where p.total_sent > 0 and not p.is_anonymous
       and p.total_sent > mine and p.created_at <= aged;

  when 'most-received' then
    select count(*) into above from profiles p
     where p.total_received > 0 and not p.is_anonymous and p.total_received > mine;

  when 'most-revives' then
    select count(*) into above from profiles p
     where p.rescues > 0 and not p.is_anonymous
       and p.rescues > mine and p.created_at <= aged;
  end case;

  return jsonb_build_object(
    'board', p_board,
    'position', above + extra + 1,
    'of', greatest(uptime_board_size(p_board), above + extra + 1),
    'value', mine);
end;
$fn$;

-- ==========================================================================
-- Who may call what
-- ==========================================================================

-- Server-side only. Each of these either acts on an account named by
-- parameter rather than on the caller, or exists to be composed into the
-- actions above. None of them re-checks who is asking, because none of them
-- was ever meant to be asked by a client.
revoke execute on function uptime_touch(uuid)                  from public, anon, authenticated;
revoke execute on function uptime_sweep_user(uuid)             from public, anon, authenticated;
revoke execute on function uptime_sweep_lapsed(int)            from public, anon, authenticated;
revoke execute on function uptime_due_for_nudge(int)           from public, anon, authenticated;
revoke execute on function uptime_record_nudge(uuid, bigint)   from public, anon, authenticated;
revoke execute on function uptime_rate_ok(text, int, bigint)   from public, anon, authenticated;
revoke execute on function uptime_sync_anonymity(uuid)         from public, anon, authenticated;
revoke execute on function uptime_gift_counters()              from public, anon, authenticated;
revoke execute on function uptime_board_top(text, int)         from public, anon, authenticated;
revoke execute on function uptime_board_size(text)             from public, anon, authenticated;
revoke execute on function uptime_balance(uuid)                from public, anon, authenticated;
revoke execute on function uptime_sent_in_last_day(uuid)       from public, anon, authenticated;
revoke execute on function uptime_total_sent(uuid)             from public, anon, authenticated;
revoke execute on function uptime_total_received(uuid)         from public, anon, authenticated;

-- The two scheduled Edge Functions run with the service role.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function uptime_sweep_lapsed(int)          to service_role;
    grant execute on function uptime_due_for_nudge(int)         to service_role;
    grant execute on function uptime_record_nudge(uuid, bigint) to service_role;
  end if;
end $$;

grant execute on function uptime_pulse()                       to authenticated;
grant execute on function uptime_board(text, int)              to authenticated, anon;
grant execute on function uptime_my_rank(text)                 to authenticated, anon;
grant execute on function uptime_profile(uuid)                 to authenticated, anon;
