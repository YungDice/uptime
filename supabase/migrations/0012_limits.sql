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
