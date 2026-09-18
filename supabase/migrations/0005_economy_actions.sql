-- Uptime: sending and reviving. The only place time changes hands.

create or replace function uptime_send_time(p_to uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  recipient profiles;
  bal bigint;
  today bigint;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_to);

  if p_amount is null or p_amount <= 0 or p_amount <> floor(p_amount) then
    return jsonb_build_object('ok', false, 'message', 'Pick an amount of time to send.');
  end if;
  if p_to = me_id then
    return jsonb_build_object('ok', false, 'message', 'You cannot send time to yourself.');
  end if;

  -- Lock the sender row first so two concurrent sends cannot both read the
  -- same balance and jointly overdraw it.
  perform 1 from profiles where id = me_id for update;

  select * into recipient from profiles where id = p_to;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;

  if not uptime_connected(me_id, p_to) then
    return jsonb_build_object('ok', false, 'message', 'You can only send time to people you both follow.');
  end if;

  bal := uptime_balance(me_id);
  if p_amount > bal then
    return jsonb_build_object('ok', false, 'message', 'That is more than you have banked.');
  end if;

  today := uptime_sent_in_last_day(me_id);
  if today + p_amount > uptime_max_sent_per_day() then
    return jsonb_build_object('ok', false, 'message',
      'You have hit today''s sending limit. It resets on a rolling 24 hours.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds)
  values (me_id, p_to, p_amount);

  -- Receiving is a sign of life for the recipient, as is sending for you.
  perform uptime_touch(me_id);
  perform uptime_touch(p_to);

  return jsonb_build_object(
    'ok', true,
    'message', 'Sent to ' || recipient.display_name || '.',
    'snapshot', uptime_snapshot());
end;
$$;

-- Spend banked time to bring a friend's lapsed streak back, halved.
--
-- The restored streak is backdated rather than credited: the run resumes as
-- though it had begun `restores` seconds ago, and last_seen resets so the
-- rescued streak is not swept again on the next pass.
create or replace function uptime_revive(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me_id uuid := auth.uid();
  friend profiles;
  last_run streak_runs;
  cost bigint;
  restores bigint;
begin
  if me_id is null then return jsonb_build_object('ok', false, 'message', 'Not signed in'); end if;
  -- Both sides, because the revive target's lapse is the whole precondition.
  perform uptime_sweep_user(me_id);
  perform uptime_sweep_user(p_user);

  perform 1 from profiles where id = me_id for update;
  select * into friend from profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That account no longer exists.');
  end if;
  if not uptime_connected(me_id, p_user) then
    return jsonb_build_object('ok', false, 'message', 'You can only revive people you both follow.');
  end if;
  if friend.streak_start is not null then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has a streak running.');
  end if;

  -- Already-revived runs are excluded, or the same run could be bought back
  -- again and again.
  select * into last_run from streak_runs
   where user_id = p_user and reason = 'lapsed' and revived_at is null
   order by ended_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'message', friend.display_name || ' has no broken streak to revive.');
  end if;

  cost := uptime_revive_cost(last_run.length_seconds);
  restores := uptime_revived_length(last_run.length_seconds);

  if cost > uptime_balance(me_id) then
    return jsonb_build_object('ok', false, 'message', 'Not enough banked time for this rescue.');
  end if;

  insert into gifts (from_user_id, to_user_id, amount_seconds, revived_run_id)
  values (me_id, p_user, cost, last_run.id);

  -- The revived stretch is running again, so it stops counting toward the
  -- lifetime total - but the run itself stays on the record, marked.
  update streak_runs set revived_at = uptime_now() where id = last_run.id;

  update profiles
     set streak_start = uptime_now() - restores,
         last_seen = uptime_now(),
         lifetime_seconds = greatest(0, lifetime_seconds - last_run.length_seconds)
   where id = p_user;

  perform uptime_touch(me_id);

  return jsonb_build_object(
    'ok', true,
    'message', 'You brought ' || friend.display_name || ' back at ' || (restores / 86400)::int || ' days.',
    'snapshot', uptime_snapshot());
end;
$$;
