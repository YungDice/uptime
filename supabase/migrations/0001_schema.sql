-- Uptime: core schema.
--
-- Time is stored as bigint epoch seconds rather than timestamptz throughout.
-- The whole model is "elapsed = now - streak_start", and keeping both sides of
-- that subtraction in the same unit as the client removes a class of interval
-- and timezone mismatches between the SQL and the TypeScript that mirrors it.

create extension if not exists pgcrypto;

-- --- tunables -------------------------------------------------------------
-- Mirrors src/core/constants.ts. Kept as immutable functions rather than a
-- settings table so the planner can inline them and so changing a rule is a
-- migration with a reviewable diff.

create or replace function uptime_now() returns bigint
  language sql stable as $$ select extract(epoch from now())::bigint $$;

create or replace function uptime_check_in_window() returns bigint
  language sql immutable as $$ select (60 * 24 * 60 * 60)::bigint $$;   -- 60 days

create or replace function uptime_accrual_rate() returns numeric
  language sql immutable as $$ select 0.1::numeric $$;

create or replace function uptime_revive_restore_fraction() returns numeric
  language sql immutable as $$ select 0.5::numeric $$;

create or replace function uptime_max_sent_per_day() returns bigint
  language sql immutable as $$ select (7 * 24 * 60 * 60)::bigint $$;    -- 7 days

create or replace function uptime_min_account_age() returns bigint
  language sql immutable as $$ select (14 * 24 * 60 * 60)::bigint $$;   -- 14 days

-- --- tables ---------------------------------------------------------------

create table if not exists profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  handle            text unique not null check (handle ~ '^[a-z0-9_]{2,24}$'),
  display_name      text not null,
  created_at        bigint not null default uptime_now(),

  -- The two fields the whole app derives from. Null start means no run.
  streak_start      bigint,
  last_seen         bigint not null default uptime_now(),

  -- Sum of closed runs only. The run in progress is never folded in here.
  lifetime_seconds  bigint not null default 0 check (lifetime_seconds >= 0),

  constraint streak_start_sane check (streak_start is null or streak_start <= last_seen + uptime_check_in_window())
);

create table if not exists streak_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  started_at      bigint not null,
  ended_at        bigint not null,
  length_seconds  bigint not null check (length_seconds >= 0),
  reason          text not null check (reason in ('lapsed', 'voluntary', 'reset')),
  -- Set when a friend bought this run back. The row stays: a reset never
  -- erases the record, and deleting it would also null the gift's pointer to
  -- it, which is what the rescues leaderboard counts.
  revived_at      bigint
);

create index if not exists streak_runs_user_idx on streak_runs (user_id, length_seconds desc);

-- Directed follows. A donation needs the pair in both directions; see
-- uptime_connected below. Storing one row per direction keeps "follow" usable
-- on its own later without reshaping the table.
create table if not exists follows (
  follower_id  uuid not null references profiles (id) on delete cascade,
  followee_id  uuid not null references profiles (id) on delete cascade,
  created_at   bigint not null default uptime_now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on follows (followee_id);

-- The donation ledger. Balances are sums over these rows, never a column.
create table if not exists gifts (
  id              uuid primary key default gen_random_uuid(),
  from_user_id    uuid not null references profiles (id) on delete cascade,
  to_user_id      uuid not null references profiles (id) on delete cascade,
  amount_seconds  bigint not null check (amount_seconds > 0),
  created_at      bigint not null default uptime_now(),
  -- Set when the gift was spent reviving rather than given outright.
  revived_run_id  uuid references streak_runs (id) on delete set null,
  constraint no_self_gift check (from_user_id <> to_user_id)
);

create index if not exists gifts_from_idx on gifts (from_user_id, created_at desc);
create index if not exists gifts_to_idx on gifts (to_user_id, created_at desc);
