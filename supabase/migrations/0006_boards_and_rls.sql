-- Uptime: leaderboards and row-level security.

-- Every board is a subtraction or a sum over rows that already exist. None of
-- them maintains a total, so a board can never disagree with a profile.
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

-- --- row-level security ---------------------------------------------------
-- Reads are open across profiles because the leaderboards are public by
-- design. Writes go through the security-definer functions above only: no
-- client can insert a gift, edit a streak, or move its own last_seen directly.

alter table profiles     enable row level security;
alter table streak_runs  enable row level security;
alter table follows      enable row level security;
alter table gifts        enable row level security;

drop policy if exists profiles_readable on profiles;
create policy profiles_readable on profiles for select using (true);

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists runs_readable on streak_runs;
create policy runs_readable on streak_runs for select using (true);

drop policy if exists gifts_readable on gifts;
create policy gifts_readable on gifts for select using (true);

drop policy if exists follows_readable on follows;
create policy follows_readable on follows for select using (true);

-- Following is the one thing a client may write directly, and only as itself.
drop policy if exists follows_self_insert on follows;
create policy follows_self_insert on follows
  for insert with check (follower_id = auth.uid());

drop policy if exists follows_self_delete on follows;
create policy follows_self_delete on follows
  for delete using (follower_id = auth.uid());

-- A profile may update itself, but not its own clock or its own balance
-- inputs. Those move only through the functions above.
create or replace function uptime_guard_profile_writes()
returns trigger language plpgsql as $$
begin
  -- Only client-facing roles are guarded. PostgREST reaches the database as
  -- `authenticator` and then SET ROLEs to `authenticated`, so comparing
  -- current_user against session_user would never fire; naming the roles is
  -- what actually distinguishes a client write from the server's own.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.streak_start is distinct from old.streak_start
     or new.last_seen is distinct from old.last_seen
     or new.lifetime_seconds is distinct from old.lifetime_seconds
     or new.created_at is distinct from old.created_at then
    raise exception 'Streak fields are managed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_writes on profiles;
create trigger guard_profile_writes
  before update on profiles
  for each row execute function uptime_guard_profile_writes();

-- Supabase grants the client roles broad table privileges by default, so the
-- policies above are not on their own enough. Take the write privileges back
-- explicitly and hand out only what a client legitimately does directly:
-- reading, and following someone. Everything else goes through the functions.
revoke all on profiles, streak_runs, gifts, follows from anon, authenticated;

grant select on profiles, streak_runs, gifts, follows to anon, authenticated;
grant insert, delete on follows to authenticated;

grant execute on function uptime_snapshot()                     to authenticated;
grant execute on function uptime_ensure_profile(text)           to authenticated;
grant execute on function uptime_check_in()                     to authenticated;
grant execute on function uptime_start_streak()                 to authenticated;
grant execute on function uptime_stop_streak()                  to authenticated;
grant execute on function uptime_send_time(uuid, bigint)        to authenticated;
grant execute on function uptime_revive(uuid)                   to authenticated;
grant execute on function uptime_board(text, int)               to authenticated, anon;
