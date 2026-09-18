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
