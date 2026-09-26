-- Uptime: the three writes 0012 left unlimited.
--
--   1. Display names. 0012 limited nickname changes because a name that keeps
--      changing on a public board is how one account impersonates another -
--      but the boards show the display name, and that had no limit at all.
--
--   2. Device registration. Any signed-in account, anonymous ones included,
--      could register any string as a push token, as often as it liked. For
--      WNS the token is a URL that nudge-check-in POSTs to with the Windows
--      push service's bearer token attached, so an unchecked one hands that
--      token to whoever registered the URL. Tokens are now checked against the
--      shape each service actually issues, new registrations are limited, and
--      an account keeps only its newest few devices.
--
--   3. The handle a new profile starts with. The client derives it from the
--      account id, but the server took whatever it was sent, so a script could
--      claim any unused nickname once per anonymous account - skipping the
--      set_handle limit entirely. The first handle now has to carry the id's
--      own suffix.

-- ==========================================================================
-- Display names
-- ==========================================================================

create or replace function uptime_set_display_name(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  wanted text := trim(p_name);
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;
  if length(wanted) < 1 or length(wanted) > 40 then
    return jsonb_build_object('ok', false, 'message', 'Pick a name between 1 and 40 characters.');
  end if;
  -- Checked after the shape, so a typo does not spend one of the day's changes.
  if not uptime_rate_ok('set_display_name', 10, 86400) then
    return jsonb_build_object('ok', false, 'message',
      'Names can be changed a few times a day. Try again tomorrow.');
  end if;

  update profiles set display_name = wanted where id = auth.uid();
  return jsonb_build_object('ok', true, 'message', 'Name updated.', 'snapshot', uptime_snapshot());
end;
$fn$;

-- ==========================================================================
-- Push tokens
-- ==========================================================================

create or replace function uptime_max_devices() returns int
  language sql immutable as $fn$ select 5 $fn$;

-- What each push service actually issues. The WNS check is the one that
-- matters: that token is a URL the nudge job sends a bearer token to, and
-- Microsoft's guidance is to accept only channel URIs on notify.windows.com.
-- APNs is held to hex because it is spliced into the request path. Lengths
-- over 255 are checked apart from the pattern: a Postgres regex refuses a
-- repetition count above that.
create or replace function uptime_device_token_ok(p_platform text, p_token text)
returns boolean language sql immutable as $fn$
  select coalesce(case p_platform
    when 'apns' then p_token ~ '^[0-9a-fA-F]{64,200}$'
    when 'fcm'  then length(p_token) between 20 and 4096
                 and p_token ~ '^[A-Za-z0-9_:-]+$'
    when 'wns'  then length(p_token) <= 2048
                 and p_token ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com/[^[:space:]]*$'
    else false
  end, false);
$fn$;

create or replace function uptime_register_device(p_platform text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id  uuid := auth.uid();
  wanted text := trim(coalesce(p_token, ''));
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;
  if not uptime_device_token_ok(p_platform, wanted) then
    return jsonb_build_object('ok', false, 'message', 'That is not a push token this app can use.');
  end if;

  -- Only a token new to this account counts. Re-registering the one it
  -- already holds is what a launch does, and must never be refused.
  if not exists (select 1 from device_tokens
                  where platform = p_platform and token = wanted and user_id = me_id)
     and not uptime_rate_ok('register_device', 20, 86400) then
    return jsonb_build_object('ok', false, 'message',
      'This account has registered a lot of devices today. Try again tomorrow.');
  end if;

  insert into device_tokens (user_id, platform, token)
  values (me_id, p_platform, wanted)
  on conflict (platform, token) do update
    set user_id = me_id, last_used_at = uptime_now();

  -- A reinstall mints a new token and nothing retires the old one, so an
  -- account keeps its newest few rather than being refused a new device.
  delete from device_tokens d
   where d.user_id = me_id
     and d.id not in (
       select k.id from device_tokens k
        where k.user_id = me_id
        order by coalesce(k.last_used_at, k.created_at) desc, k.created_at desc
        limit uptime_max_devices());

  return jsonb_build_object('ok', true);
end;
$fn$;

-- Anything already registered that the check would now refuse - including
-- any URL that is not a WNS channel - goes here rather than on the next nudge.
delete from device_tokens where not uptime_device_token_ok(platform, token);

-- ==========================================================================
-- The first handle
-- ==========================================================================

-- 0015's, with the handle held to the rule the client already follows.
create or replace function uptime_ensure_profile(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  uid    uuid := auth.uid();
  hex    text;
  wanted text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  hex := replace(uid::text, '-', '');
  wanted := lower(trim(coalesce(p_handle, '')));
  -- Mirrors handleFor() in src/data/supabase.ts: any stem, then the first
  -- eight hex digits of this account's own id. Anything else is replaced.
  if wanted !~ ('^[a-z0-9_]{1,15}_' || left(hex, 8) || '$') then
    wanted := 'user_' || left(hex, 8);
  end if;

  if not exists (select 1 from profiles where id = uid) then
    begin
      insert into profiles (id, handle, display_name, is_anonymous)
      values (uid, wanted, initcap(wanted), uptime_is_anonymous(uid))
      on conflict (id) do nothing;
    exception when unique_violation then
      -- Eight hex digits collide somewhere past tens of thousands of
      -- accounts, and someone can also pick that nickname first. Nineteen
      -- digits do neither. Without this the unlucky account could never
      -- create a profile, and the app would not start for it.
      insert into profiles (id, handle, display_name, is_anonymous)
      values (uid, 'user_' || left(hex, 19), initcap('user_' || left(hex, 19)), uptime_is_anonymous(uid))
      on conflict (id) do nothing;
    end;
  end if;

  -- Through the touch, so a lapsed run is filed before the visit counts.
  perform uptime_touch(uid);

  return jsonb_build_object('ok', true);
end;
$fn$;

grant execute on function uptime_set_display_name(text)        to authenticated;
grant execute on function uptime_register_device(text, text)   to authenticated;
grant execute on function uptime_ensure_profile(text)          to authenticated;
