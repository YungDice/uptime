-- Uptime: device registration for the check-in prompt.
--
-- The prompt is a convenience, never the mechanism. The window is measured
-- server-side from last_seen, so a user who denies notifications keeps their
-- streak exactly as long as one who allows them. Nothing in this file can
-- extend or end a streak.

create table if not exists device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  platform      text not null check (platform in ('apns', 'fcm', 'wns')),
  token         text not null,
  created_at    bigint not null default uptime_now(),
  last_used_at  bigint,
  unique (platform, token)
);

create index if not exists device_tokens_user_idx on device_tokens (user_id);

-- When a user was last nudged, so a single closing window does not produce a
-- prompt a day for a week.
create table if not exists nudges (
  user_id    uuid primary key references profiles (id) on delete cascade,
  sent_at    bigint not null,
  -- The deadline this nudge was about. A new streak means a new deadline,
  -- which is what makes one nudge per window rather than one per user.
  deadline   bigint not null
);

-- Who is close enough to the end of their window to be worth a prompt.
create or replace function uptime_due_for_nudge(p_limit int default 1000)
returns table (user_id uuid, handle text, deadline bigint, platform text, token text)
language sql stable security definer set search_path = public as $$
  select p.id, p.handle, p.last_seen + uptime_check_in_window(), d.platform, d.token
    from profiles p
    join device_tokens d on d.user_id = p.id
    left join nudges n on n.user_id = p.id
   where p.streak_start is not null
     -- Inside the lead, but not yet lapsed.
     and uptime_now() >= p.last_seen + uptime_check_in_window() - (7 * 86400)
     and uptime_now() < p.last_seen + uptime_check_in_window()
     -- Not already nudged about this same deadline.
     and (n.user_id is null or n.deadline is distinct from p.last_seen + uptime_check_in_window())
   order by p.last_seen
   limit p_limit;
$$;

create or replace function uptime_record_nudge(p_user uuid, p_deadline bigint)
returns void language sql security definer set search_path = public as $$
  insert into nudges (user_id, sent_at, deadline)
  values (p_user, uptime_now(), p_deadline)
  on conflict (user_id) do update set sent_at = uptime_now(), deadline = excluded.deadline;
$$;

-- A device registers itself; that is the only write a client makes here.
create or replace function uptime_register_device(p_platform text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in');
  end if;

  insert into device_tokens (user_id, platform, token)
  values (auth.uid(), p_platform, p_token)
  on conflict (platform, token) do update
    set user_id = auth.uid(), last_used_at = uptime_now();

  return jsonb_build_object('ok', true);
end;
$$;

alter table device_tokens enable row level security;
alter table nudges enable row level security;

drop policy if exists device_tokens_self on device_tokens;
create policy device_tokens_self on device_tokens for select using (user_id = auth.uid());

revoke all on device_tokens, nudges from anon, authenticated;
grant select on device_tokens to authenticated;
grant execute on function uptime_register_device(text, text) to authenticated;
