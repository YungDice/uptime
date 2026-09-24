-- Uptime: a sign of life cannot resurrect a streak that already ran out.
--
-- `uptime_touch` moved `last_seen` to now without asking whether the window
-- had already closed. Most actions sweep first, but not all of them: follow,
-- unfollow, set_handle and set_avatar touched straight away, and
-- `uptime_ensure_profile` - which the client calls on every launch, *before*
-- `uptime_open` - wrote `last_seen` directly. So an account 90 days unseen
-- could open the app (or call any of those RPCs) before the scheduled sweep
-- reached it, and the fresh `last_seen` made the sweep that followed see a
-- live streak. The check-in window was only enforced if the cron job won the
-- race.
--
-- The fix lives in the one place every sign of life goes through: the touch
-- sweeps first. Filing an already-lapsed run is idempotent, so the actions
-- that already swept lose nothing by it being done twice.

create or replace function uptime_touch(p_user uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform uptime_sweep_user(p_user);
  update profiles set last_seen = uptime_now() where id = p_user;
end;
$fn$;

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
  on conflict (id) do nothing;

  -- Through the touch, so a lapsed run is filed before the visit counts.
  perform uptime_touch(uid);

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function uptime_touch(uuid) from public, anon, authenticated;
grant execute on function uptime_ensure_profile(text) to authenticated;
