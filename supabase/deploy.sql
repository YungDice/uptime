-- Uptime: complete schema, generated from supabase/migrations/.
--
-- Paste this whole file into the Supabase Dashboard SQL Editor and run it.
-- It is the same content as the numbered migrations, concatenated in order,
-- and exists because this machine cannot reach Postgres directly (outbound
-- 5432/6543 are blocked), so `supabase db push` cannot run from here.
--
-- Safe to re-run: every statement is CREATE OR REPLACE, CREATE IF NOT EXISTS,
-- or a DROP ... IF EXISTS followed by a CREATE.
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

begin;

-- ======================================================================
-- 0001_schema.sql
-- ======================================================================

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

-- ======================================================================
-- 0002_derivations.sql
-- ======================================================================

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

-- ======================================================================
-- 0003_sweep_and_snapshot.sql
-- ======================================================================

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

-- ======================================================================
-- 0004_actions.sql
-- ======================================================================

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

-- ======================================================================
-- 0005_economy_actions.sql
-- ======================================================================

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

-- ======================================================================
-- 0006_boards_and_rls.sql
-- ======================================================================

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

-- ======================================================================
-- 0007_push.sql
-- ======================================================================

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

-- ======================================================================
-- 0008_follows.sql
-- ======================================================================

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

commit;
