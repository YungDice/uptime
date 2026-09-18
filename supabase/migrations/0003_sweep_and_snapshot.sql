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
