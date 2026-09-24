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
