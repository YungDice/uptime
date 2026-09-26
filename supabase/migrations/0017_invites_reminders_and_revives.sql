-- Uptime: invite links, the reminder email, and revives off the daily cap.
--
--   1. The daily cap counts sends only. A revive's price is on the ledger, and
--      uptime_revive never checked the cap - but its cost still counted toward
--      it, so a free account that rescued someone was then refused a send as
--      "today's limit" without having sent anything.
--
--   2. Invite links. Following is the way into everything social, and it took
--      two people each typing the other's exact nickname. A link carries a
--      code that stands for its owner; opening it and saying yes makes the
--      follow mutual at once. The code, not the nickname, is what proves the
--      owner handed it out: a link built from a nickname could be written by
--      anyone, and would make that person follow whoever opened it.
--
--   3. The reminder email. One message a week before a check-in window
--      closes, for accounts with a confirmed address, unless they turned it
--      off. It shares `nudges` with the push path, so a window gets one
--      reminder however many ways there are to deliver it.

-- ==========================================================================
-- 1. The daily cap
-- ==========================================================================

create or replace function uptime_sent_in_last_day(p_user uuid)
returns bigint language sql stable as $fn$
  select coalesce(sum(amount_seconds), 0)::bigint
    from gifts
   where from_user_id = p_user
     and revived_run_id is null
     and created_at > uptime_now() - 86400;
$fn$;

-- ==========================================================================
-- 2. Invite links
-- ==========================================================================

-- One standing code per account, made the first time it is asked for. Its
-- own table rather than a column on profiles, whose update triggers guard
-- the counters and have no business knowing about invites.
create table if not exists invite_codes (
  code        text   primary key,
  user_id     uuid   not null unique references profiles (id) on delete cascade,
  created_at  bigint not null default uptime_now()
);

alter table invite_codes enable row level security;
revoke all on invite_codes from anon, authenticated;

-- Twelve hex digits of a v4 uuid: 48 random bits. Guessing one takes about
-- 10^14 tries, against a limit of 60 lookups an hour.
create or replace function uptime_invite_code()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id uuid := auth.uid();
  mine  text;
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  select code into mine from invite_codes where user_id = me_id;
  while mine is null loop
    begin
      insert into invite_codes (code, user_id)
      values (left(replace(gen_random_uuid()::text, '-', ''), 12), me_id)
      returning code into mine;
    exception when unique_violation then
      -- Either the code was taken, and the loop draws another, or this
      -- account's row appeared in between, and it is read here.
      select code into mine from invite_codes where user_id = me_id;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'code', mine);
end;
$fn$;

-- Who a code belongs to, so the app can say whose invite it is before anyone
-- follows anyone. Null for a code that is not one. Volatile only because the
-- lookup limit writes: this is the call a guesser would make.
create or replace function uptime_invite_preview(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  inviter profiles;
begin
  if auth.uid() is null or not uptime_rate_ok('invite_lookup', 60, 3600) then
    return 'null'::jsonb;
  end if;

  select p.* into inviter
    from invite_codes i join profiles p on p.id = i.user_id
   where i.code = lower(trim(coalesce(p_code, '')));
  if not found then
    return 'null'::jsonb;
  end if;

  return jsonb_build_object(
    'id', inviter.id,
    'handle', inviter.handle,
    'displayName', inviter.display_name,
    'avatarUrl', inviter.avatar_url,
    'createdAt', inviter.created_at);
end;
$fn$;

-- Say yes to an invite: both follows at once.
--
-- The owner's side is consent given in advance - they made the link and sent
-- it - and the caller's is this call. Neither is a sign of life for the owner,
-- who did nothing just now, so only the caller is touched.
create or replace function uptime_accept_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me_id   uuid := auth.uid();
  inviter profiles;
begin
  if me_id is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;
  if not uptime_rate_ok('invite_lookup', 60, 3600) then
    return jsonb_build_object('ok', false, 'message',
      'That is a lot of invites in one go. Try again shortly.');
  end if;

  select p.* into inviter
    from invite_codes i join profiles p on p.id = i.user_id
   where i.code = lower(trim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('ok', false, 'message',
      'That invite link doesn''t work. Ask for a new one.');
  end if;
  if inviter.id = me_id then
    return jsonb_build_object('ok', false, 'message',
      'That is your own invite link. Send it to a friend.');
  end if;

  -- The same cap uptime_follow keeps, on each side that would gain a follow.
  if not exists (select 1 from follows where follower_id = me_id and followee_id = inviter.id)
     and (select count(*) from follows where follower_id = me_id) >= uptime_max_follows() then
    return jsonb_build_object('ok', false, 'message',
      'You are following as many people as one account can.');
  end if;
  if not exists (select 1 from follows where follower_id = inviter.id and followee_id = me_id)
     and (select count(*) from follows where follower_id = inviter.id) >= uptime_max_follows() then
    return jsonb_build_object('ok', false, 'message',
      inviter.display_name || ' is following as many people as one account can.');
  end if;

  insert into follows (follower_id, followee_id)
  values (me_id, inviter.id), (inviter.id, me_id)
  on conflict do nothing;

  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', 'You and ' || inviter.display_name || ' follow each other now, so time can move between you.',
    'snapshot', uptime_snapshot());
end;
$fn$;

-- ==========================================================================
-- 3. The reminder email
-- ==========================================================================

-- Absent means on. The reminder is the one thing standing between a quiet
-- user and a lapse they were never warned about, so it is not opt-in - but it
-- is one line of a switch away from off.
create table if not exists reminder_settings (
  user_id  uuid    primary key references profiles (id) on delete cascade,
  email    boolean not null default true
);

alter table reminder_settings enable row level security;
revoke all on reminder_settings from anon, authenticated;

create or replace function uptime_set_email_reminders(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  insert into reminder_settings (user_id, email)
  values (auth.uid(), coalesce(p_on, true))
  on conflict (user_id) do update set email = excluded.email;

  return jsonb_build_object(
    'ok', true,
    'message', case when coalesce(p_on, true)
      then 'You''ll get one email a week before your check-in window closes.'
      else 'No reminder emails. Your streak works exactly the same without them.'
    end);
end;
$fn$;

-- The account read gains the switch. It already reads auth.users, and the
-- snapshot deliberately does not, which is why it rides here.
create or replace function uptime_account()
returns jsonb language sql stable security definer set search_path = public, auth as $fn$
  select jsonb_build_object(
           'isAnonymous', coalesce(u.is_anonymous, true),
           'email', u.email,
           'createdAt', extract(epoch from u.created_at)::bigint,
           'emailReminders', coalesce(
             (select r.email from reminder_settings r where r.user_id = u.id), true))
    from auth.users u where u.id = auth.uid();
$fn$;

-- Who is inside the last week of their window, has a confirmed address, has
-- not turned the email off, and has not been reminded about this deadline by
-- any route. The window test is on the bare column, as uptime_due_for_nudge's
-- is, so the partial index on running profiles' last_seen does the finding.
create or replace function uptime_due_for_email(p_limit int default 1000)
returns table (user_id uuid, email text, display_name text, streak_start bigint, deadline bigint)
language sql stable security definer set search_path = public, auth as $fn$
  select p.id, u.email, p.display_name, p.streak_start, p.last_seen + uptime_check_in_window()
    from profiles p
    join auth.users u on u.id = p.id
    left join nudges n on n.user_id = p.id
    left join reminder_settings r on r.user_id = p.id
   where p.streak_start is not null
     and not p.is_anonymous
     and u.email is not null
     and u.email_confirmed_at is not null
     and coalesce(r.email, true)
     and p.last_seen <= uptime_now() - uptime_check_in_window() + 7 * 86400
     and p.last_seen >  uptime_now() - uptime_check_in_window()
     and (n.user_id is null or n.deadline is distinct from p.last_seen + uptime_check_in_window())
   order by p.last_seen
   limit greatest(1, least(coalesce(p_limit, 1000), 10000));
$fn$;

-- ==========================================================================
-- Grants
-- ==========================================================================

revoke execute on function uptime_due_for_email(int) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function uptime_due_for_email(int) to service_role;
  end if;
end $$;

grant execute on function uptime_invite_code()                 to authenticated;
grant execute on function uptime_invite_preview(text)          to authenticated;
grant execute on function uptime_accept_invite(text)           to authenticated;
grant execute on function uptime_set_email_reminders(boolean)  to authenticated;
grant execute on function uptime_account()                     to authenticated;
