-- Prevent staff from creating QR sessions before the student check-in window.
-- The existing five-minute session lifetime is intentionally unchanged.
create or replace function public.start_checkin_session(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid := auth.uid();
  v_event     public.events%rowtype;
  v_token     text;
  v_entry     text;
  v_expires   timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to generate a code.');
  end if;
  if not (public.user_has_role('director') or public.user_has_role('section_leader') or public.user_has_role('secretary')) then
    return jsonb_build_object('ok', false, 'message', 'Only directors, secretaries and section leaders can generate codes.');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That event no longer exists.');
  end if;

  if v_event.checkin_mode = 'toggle' then
    return jsonb_build_object('ok', false, 'message', 'This event uses toggle check-in — mark attendance with the buttons on the Check-In screen.');
  end if;
  if v_event.checkin_mode = 'none' then
    return jsonb_build_object('ok', false, 'message', 'This event doesn''t collect attendance.');
  end if;
  if now() > coalesce(v_event.end_date, v_event.date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — check-in is closed.');
  end if;
  if now() < v_event.date - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Check-in opens 15 minutes before the event.');
  end if;

  delete from public.checkin_sessions where event_id = p_event_id;

  v_entry := (
    select string_agg(
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), '')
    from generate_series(1, 8)
  );

  insert into public.checkin_sessions (event_id, created_by, token, entry_code, expires_at)
  values (
    p_event_id,
    v_uid,
    encode(gen_random_bytes(24), 'hex'),
    v_entry,
    now() + interval '5 minutes'
  )
  returning token, entry_code, expires_at into v_token, v_entry, v_expires;

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'entry_code', v_entry,
    'expires_at', v_expires
  );
end;
$$;
