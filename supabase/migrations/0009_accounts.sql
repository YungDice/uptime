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
