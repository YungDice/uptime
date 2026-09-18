-- Uptime: the derived quantities.
--
-- Nothing in this file stores a running total. Every function here is either a
-- subtraction against uptime_now() or a sum over the ledger, which is what
-- makes the leaderboards a GROUP BY rather than a synchronisation problem.

-- Elapsed on the run in progress. Zero when nothing is running or it lapsed.
create or replace function uptime_elapsed(p_start bigint, p_last_seen bigint, p_now bigint default null)
returns bigint language sql stable as $$
  select case
    when p_start is null then 0
    when coalesce(p_now, uptime_now()) >= p_last_seen + uptime_check_in_window() then 0
    else greatest(0, coalesce(p_now, uptime_now()) - p_start)
  end;
$$;

-- True once the check-in window has run out. The lapse dates to the deadline,
-- not to whenever the sweeper noticed.
create or replace function uptime_has_lapsed(p_start bigint, p_last_seen bigint, p_now bigint default null)
returns boolean language sql stable as $$
  select p_start is not null
     and coalesce(p_now, uptime_now()) >= p_last_seen + uptime_check_in_window();
$$;

-- Credit a run up to last_seen, not through the grace window: a user is
-- credited for time they were demonstrably around for.
create or replace function uptime_run_length(p_start bigint, p_last_seen bigint)
returns bigint language sql immutable as $$
  select greatest(0, p_last_seen - p_start);
$$;

create or replace function uptime_total_sent(p_user uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount_seconds), 0)::bigint from gifts where from_user_id = p_user;
$$;

create or replace function uptime_total_received(p_user uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount_seconds), 0)::bigint from gifts where to_user_id = p_user;
$$;

create or replace function uptime_sent_in_last_day(p_user uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount_seconds), 0)::bigint
    from gifts
   where from_user_id = p_user
     and created_at > uptime_now() - 86400;
$$;

-- Spendable balance: a fraction of all time kept, plus gifts in, minus gifts
-- out. Floored at zero defensively; the send path makes an overdraft
-- impossible, but a balance must never render negative.
create or replace function uptime_balance(p_user uuid)
returns bigint language sql stable as $$
  select greatest(0,
           floor((p.lifetime_seconds + uptime_elapsed(p.streak_start, p.last_seen))
                 * uptime_accrual_rate())::bigint
           + uptime_total_received(p_user)
           - uptime_total_sent(p_user))
    from profiles p
   where p.id = p_user;
$$;

create or replace function uptime_revived_length(p_lost bigint)
returns bigint language sql immutable as $$
  select floor(greatest(0, p_lost) * uptime_revive_restore_fraction())::bigint;
$$;

create or replace function uptime_revive_cost(p_lost bigint)
returns bigint language sql immutable as $$
  select ceil(uptime_revived_length(p_lost) * uptime_accrual_rate())::bigint;
$$;

-- Mutual follow. The gate on every gift: this alone kills the two-throwaway-
-- accounts-donating-in-a-circle attack.
create or replace function uptime_connected(p_a uuid, p_b uuid)
returns boolean language sql stable as $$
  select exists (select 1 from follows where follower_id = p_a and followee_id = p_b)
     and exists (select 1 from follows where follower_id = p_b and followee_id = p_a);
$$;

-- A fresh signup can play; it just cannot move the public rankings yet.
create or replace function uptime_counts_toward_boards(p_user uuid)
returns boolean language sql stable as $$
  select uptime_now() - created_at >= uptime_min_account_age() from profiles where id = p_user;
$$;
