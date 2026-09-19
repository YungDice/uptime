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
