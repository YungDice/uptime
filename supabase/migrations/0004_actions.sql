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
