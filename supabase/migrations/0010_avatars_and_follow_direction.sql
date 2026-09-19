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
