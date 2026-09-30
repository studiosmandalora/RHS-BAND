-- ============================================================================
-- RHS Band Attendance Manager — Migration 005
-- Security & attendance hardening
-- ============================================================================
-- Run this in Supabase Dashboard → SQL Editor (or `supabase db push`).
-- Idempotent — safe to re-run on an existing database.
--
-- What this changes:
--   1. The four analytics RPCs verify the caller is a DIRECTOR inside the
--      SECURITY DEFINER function, and EXECUTE is revoked from PUBLIC/anon.
--      Frontend gating alone is not authorization — any authenticated user
--      can call an RPC directly.
--   2. attendance_staff_notes RLS is scoped to the reader's section for
--      section leaders. Directors and secretaries keep full read access
--      (the existing permission model). Students keep no access.
--   3. record_attendance() / record_attendance_by_code() accept check-ins only
--      from 15 minutes before the event start until the event ends, and only
--      while the event's current check-in mode is QR-capable.
--   4. When an event stops being QR-enabled, its active QR sessions are
--      deleted (trigger on events) and the record RPCs re-verify the mode.
--   5. Constraint: attendance_requirement = 'none' ⟺ checkin_mode = 'none'.
--      Existing contradictory rows are normalized first (mirrors the event
--      form's own logic and migration 001 §13).
--   6. Constraint: attended = (status IN ('present','late')). Existing
--      contradictory rows are normalized first, and every attendance-writing
--      RPC keeps the pair consistent.
--   7. A staff-set 'excused' record is preserved: a QR check-in is rejected
--      with a clear message instead of silently flipping attended to true.
--   8. override_attendance(): section-leader scoping no longer applies to
--      users who also hold director or secretary (matching the attendance
--      read policy, which already gives them full access).
--
-- Follow-up migration 006 replaces start_checkin_session() to apply the same
-- 15-minute opening boundary at QR-session creation time. Migration 005 by
-- itself still permits early generation; both migrations are required for the
-- complete behavior.
--
-- Also unchanged:
--   * The 15-minute window is a constant: the schema has no configurable
--     "check-in opens at" column (late_minutes/reminder_minutes_before have
--     different meanings), so per the spec we use 15 minutes before start.

-- ---------------------------------------------------------------------------
-- 1. Analytics RPCs — director-only, enforced inside the function
-- ---------------------------------------------------------------------------
-- Each function is SECURITY DEFINER (it must read tables the caller may not
-- read directly), so the authorization check must live in the function body.
-- The UI only shows Analytics to directors; these checks make that true at
-- the database too. Secretaries/section leaders/students are denied: the
-- existing app never grants them analytics (AppShell nav and AnalyticsScreen
-- are director-only), so no intended behavior is removed.

create or replace function public.get_student_attendance_pct(p_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.user_has_role('director') then (
      select jsonb_build_object(
        'ok', true,
        'percentage', coalesce(
          round(
            (select count(*)::numeric from public.attendance_records ar
             join public.events e on e.id = ar.event_id
             where ar.student_id = p_student_id
               and ar.attended = true
               and e.archived = false
               and e.attendance_requirement = 'required'
            ) /
            nullif(
              (select count(*)::numeric from public.events e
               where e.archived = false
                 and e.attendance_requirement = 'required'
                 and e.date < now()
                 and not exists (
                   select 1 from public.attendance_records ar2
                   where ar2.event_id = e.id
                     and ar2.student_id = p_student_id
                     and ar2.status = 'excused'
                 )
              ), 0
            ) * 100, 0
          ), 0
        )
      )
    )
    else jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
  end;
$$;

create or replace function public.get_section_attendance_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.user_has_role('director') then (
      with section_stats as (
        select
          p.instrument as section,
          count(distinct p.id) as member_count,
          round(avg(
            case
              when required_events.cnt > 0 then
                (attended_count.ac::numeric / required_events.cnt) * 100
              else 0
            end
          ), 1) as avg_attendance_pct
        from public.profiles p
        left join lateral (
          select count(*)::int as ac
          from public.attendance_records ar
          join public.events e on e.id = ar.event_id
          where ar.student_id = p.id
            and ar.attended = true
            and e.archived = false
            and e.attendance_requirement = 'required'
        ) attended_count on true
        left join lateral (
          select count(*)::int as cnt
          from public.events e
          where e.archived = false
            and e.attendance_requirement = 'required'
            and e.date < now()
        ) required_events on true
        where p.instrument <> ''
          and not (p.roles @> '{director}'::public.app_role[])
          and p.deactivated = false
        group by p.instrument
        order by p.instrument
      )
      select jsonb_agg(row_to_json(s)) from section_stats s
    )
    else jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
  end;
$$;

create or replace function public.get_event_attendance_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.user_has_role('director') then (
      with stats as (
        select
          count(*) filter (where status = 'present') as present_count,
          count(*) filter (where status = 'late') as late_count,
          count(*) filter (where status = 'excused') as excused_count,
          count(*) filter (where status = 'absent' or status is null) as absent_count
        from public.attendance_records ar
        where ar.event_id = p_event_id
      ),
      roster as (
        select count(*)::int as total
        from public.profiles p
        where not (p.roles @> '{director}'::public.app_role[])
          and p.deactivated = false
      )
      select jsonb_build_object(
        'ok', true,
        'present', (select present_count from stats),
        'late', (select late_count from stats),
        'excused', (select excused_count from stats),
        'absent', (select absent_count from stats),
        'total', (select total from roster)
      )
    )
    else jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
  end;
$$;

create or replace function public.get_attendance_trend(p_limit int default 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.user_has_role('director') then (
      with recent_events as (
        select e.id, e.name, e.type, e.date, e.event_type
        from public.events e
        where e.archived = false
          and e.attendance_requirement = 'required'
          and e.date < now()
        order by e.date desc
        limit p_limit
      ),
      event_stats as (
        select
          re.id, re.name, re.type, re.date, re.event_type,
          (select count(*) from public.profiles p
           where not (p.roles @> '{director}'::public.app_role[]) and p.deactivated = false) as roster_size,
          (select count(*) from public.attendance_records ar
           where ar.event_id = re.id and ar.attended = true) as present_count,
          (select count(*) from public.attendance_records ar
           where ar.event_id = re.id and ar.status = 'excused') as excused_count,
          (select count(*) from public.attendance_records ar
           where ar.event_id = re.id and ar.status = 'late') as late_count
        from recent_events re
      )
      select jsonb_agg(row_to_json(es)) from event_stats es
    )
    else jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
  end;
$$;

-- Defense in depth on grants: Postgres grants EXECUTE to PUBLIC by default,
-- which is how anon currently reaches these functions. Directors sign in as
-- `authenticated`, so that grant must stay — the in-function role check is the
-- actual gate — but PUBLIC and anon have no business calling analytics at all.
revoke execute on function public.get_student_attendance_pct(uuid) from public;
revoke execute on function public.get_student_attendance_pct(uuid) from anon;
revoke execute on function public.get_section_attendance_stats() from public;
revoke execute on function public.get_section_attendance_stats() from anon;
revoke execute on function public.get_event_attendance_summary(uuid) from public;
revoke execute on function public.get_event_attendance_summary(uuid) from anon;
revoke execute on function public.get_attendance_trend(int) from public;
revoke execute on function public.get_attendance_trend(int) from anon;
grant execute on function public.get_student_attendance_pct(uuid) to authenticated;
grant execute on function public.get_section_attendance_stats() to authenticated;
grant execute on function public.get_event_attendance_summary(uuid) to authenticated;
grant execute on function public.get_attendance_trend(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. attendance_staff_notes — section-scoped RLS
-- ---------------------------------------------------------------------------
-- Before: ANY section leader could read ANY student's staff note (the policy
-- only required "some staff role"), while attendance_records itself was
-- already scoped per section. A violin leader could query trumpet students'
-- notes straight from the table. Notes are also excluded from the student's
-- own rows, exactly as before.
drop policy if exists "attendance_staff_notes_read_staff" on public.attendance_staff_notes;
create policy "attendance_staff_notes_read_staff"
  on public.attendance_staff_notes for select
  to authenticated
  using (
    exists (
      select 1
      from public.attendance_records ar
      join public.profiles s on s.id = ar.student_id
      where ar.id = attendance_staff_notes.attendance_record_id
        and ar.student_id <> auth.uid()
        and (
          -- Directors and secretaries see every note (unchanged: the
          -- attendance read policy already gives them all records).
          public.user_has_role('director')
          or public.user_has_role('secretary')
          -- Section leaders only see notes for students in their own
          -- section. An empty instrument (leader or student) never matches,
          -- so users without a section get no notes at all.
          or (
            public.user_has_role('section_leader')
            and coalesce(s.instrument, '') <> ''
            and s.instrument = (
              select coalesce(lp.instrument, '')
              from public.profiles lp
              where lp.id = auth.uid()
            )
          )
        )
    )
  );
grant select on public.attendance_staff_notes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. check-in mode × attendance requirement consistency
-- ---------------------------------------------------------------------------

-- 3a. Drop active QR sessions as soon as an event stops being QR-enabled.
--     This runs on the events UPDATE path (the Check-In screen and the event
--     form both update checkin_mode directly through RLS), which no RPC can
--     intercept. SECURITY DEFINER so the table owner — not the updating
--     client — performs the delete (clients have no delete rights on
--     checkin_sessions). Trigger functions cannot be invoked as ordinary
--     RPCs ("trigger functions can only be called as triggers").
create or replace function public.invalidate_checkin_sessions_on_mode_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only QR-capable modes ('qr', 'both') can back a live QR session.
  if new.checkin_mode not in ('qr', 'both') then
    delete from public.checkin_sessions where event_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists events_checkin_mode_changed on public.events;
create trigger events_checkin_mode_changed
  after update of checkin_mode on public.events
  for each row
  when (old.checkin_mode is distinct from new.checkin_mode)
  execute function public.invalidate_checkin_sessions_on_mode_change();

-- 3b. Normalize existing contradictory rows BEFORE adding the constraint.
--     Rule (mirrors what the app already does):
--       * The event form forces checkin_mode = 'none' when the requirement is
--         set to "No Attendance".
--       * Migration 001 §13 already forced requirement = 'none' for
--         checkin_mode = 'none' events.
--     Optional + a collecting mode stays allowed (attendance recorded but not
--     counted); 'none' means "not collected AND not counted".
update public.events
   set attendance_requirement = 'none'
 where checkin_mode = 'none'
   and attendance_requirement <> 'none';

update public.events
   set checkin_mode = 'none'
 where attendance_requirement = 'none'
   and checkin_mode <> 'none';

alter table public.events drop constraint if exists events_requirement_mode_check;
alter table public.events add constraint events_requirement_mode_check
  check ((attendance_requirement = 'none') = (checkin_mode = 'none'));

-- 3c. QR sessions of events that are no longer QR-capable can never be
--     redeemed (record_attendance re-checks the mode), but delete them anyway
--     so they don't linger / re-notify.
delete from public.checkin_sessions cs
 using public.events e
 where e.id = cs.event_id
   and e.checkin_mode not in ('qr', 'both');

-- ---------------------------------------------------------------------------
-- 4. status × attended consistency
-- ---------------------------------------------------------------------------
-- The expected relationship:
--   present → attended = true     late → attended = true
--   absent  → attended = false    excused → attended = false
--
-- 4a. Normalize existing rows first (spec: check for contradictory data
--     before constraining). Two known sources of contradictions:
--       * seed.sql (and pre-migration data) inserted attended = true with the
--         default status 'absent' — attended truth wins, status becomes
--         present/late (this is exactly what migration 001 §3 did).
--       * The old record_attendance() conflict clause set attended = true on
--         an 'excused' row — the excuse is a deliberate staff decision, so it
--         wins and attended goes back to false.
update public.attendance_records
   set status = case when coalesce(is_late, false) then 'late' else 'present' end
 where status = 'absent'
   and attended = true;

update public.attendance_records
   set attended = false
 where status = 'excused'
   and attended = true;

update public.attendance_records
   set attended = true
 where status in ('present', 'late')
   and attended = false;

alter table public.attendance_records drop constraint if exists attendance_records_status_attended_check;
alter table public.attendance_records add constraint attendance_records_status_attended_check
  check (attended = (status in ('present', 'late')));

-- ---------------------------------------------------------------------------
-- 5. record_attendance / record_attendance_by_code
-- ---------------------------------------------------------------------------
-- Same validation for the QR token and the manual entry code:
--   * session exists / not expired                       (unchanged)
--   * event still collects attendance via QR  (NEW — #4)
--   * event has not ended                                (unchanged)
--   * event not earlier than start - 15 minutes  (NEW — #3, clear message)
--   * existing 'excused' record preserved         (NEW — #7, clear message)
--   * upsert keeps status/attended consistent      (CHANGED — #6)
-- Late detection, rate limiting and idempotent re-scans are unchanged: the
-- first check-in's status and timestamp win.

create or replace function public.record_attendance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_session  record;
  v_record   attendance_records%rowtype;
  v_attempt  uuid;
  v_event_id uuid;
  v_is_late  boolean := false;
  v_late_mins int;
  v_status   text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  -- Directors run the band; they don't check in.
  if public.user_has_role('director') then
    return jsonb_build_object('ok', false, 'message', 'Directors don''t check in.');
  end if;

  select cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date, ev.end_date as event_end,
         ev.late_minutes, ev.checkin_mode
    into v_session
    from public.checkin_sessions cs
    join public.events ev on ev.id = cs.event_id
   where cs.token = p_token
   limit 1;

  -- Bucket this attempt by the event it resolved to (null = unknown code).
  v_event_id := v_session.event_id;

  -- Rate limit: more than 5 failed attempts for this event (or the unknown-code
  -- bucket) in the last 2 minutes → refuse.
  if (select count(*) from public.checkin_attempts
      where actor_id = v_uid
        and event_id is not distinct from v_event_id
        and success = false
        and created_at > now() - interval '2 minutes') >= 5 then
    insert into public.checkin_attempts (event_id, actor_id, success)
    values (v_event_id, v_uid, false);
    return jsonb_build_object('ok', false, 'message', 'Too many attempts — try again in a minute.');
  end if;

  insert into public.checkin_attempts (event_id, actor_id, success)
  values (v_event_id, v_uid, false)
  returning id into v_attempt;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'message', 'That code was not recognized.');
  end if;

  if v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That code has expired — ask for a fresh one.');
  end if;

  -- A QR token only works while the event still collects attendance via QR.
  -- This kills tokens whose event was switched to toggle/none even if the
  -- session row somehow survived the invalidation trigger.
  if v_session.checkin_mode not in ('qr', 'both') then
    return jsonb_build_object('ok', false, 'message', 'This event doesn''t use QR check-in.');
  end if;

  -- Attendance is only accepted while the event is happening. Once it's over,
  -- the code is dead even if it's still unexpired — no retroactive check-ins.
  if now() > coalesce(v_session.event_end, v_session.event_date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — attendance is closed.');
  end if;

  -- Check-in opens 15 minutes before the event start; earlier scans are
  -- rejected with a clear message (enforced here, not in React).
  if now() < v_session.event_date - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Check-in has not opened yet.');
  end if;

  -- A staff-set excuse is final: don't let a QR scan overwrite it with a
  -- contradictory excused/attended=true row.
  if exists (
    select 1 from public.attendance_records ar
     where ar.event_id = v_session.event_id
       and ar.student_id = v_uid
       and ar.status = 'excused'
  ) then
    return jsonb_build_object('ok', false, 'message', 'You''ve been excused for this event — no check-in needed.');
  end if;

  -- Late detection: check if check-in is after grace period
  v_late_mins := coalesce(v_session.late_minutes, 10);
  if v_session.event_date + (v_late_mins || ' minutes')::interval < now() then
    v_is_late := true;
    v_status := 'late';
  else
    v_status := 'present';
  end if;

  insert into public.attendance_records (
    event_id, student_id, attended, checked_in_at, status, is_late
  )
  values (
    v_session.event_id, v_uid, true, now(), v_status, v_is_late
  )
  on conflict (event_id, student_id)
  do update set
    -- First check-in wins: keep an existing present/late status, lateness
    -- flag and timestamp. Anything else (legacy 'absent' rows) is upgraded to
    -- this check-in's status so status and attended can never disagree.
    status = case
      when attendance_records.status in ('present', 'late') then attendance_records.status
      else excluded.status
    end,
    is_late = case
      when attendance_records.status in ('present', 'late') then attendance_records.is_late
      else excluded.is_late
    end,
    attended = true,
    checked_in_at = case
      when attendance_records.status in ('present', 'late')
        then coalesce(attendance_records.checked_in_at, now())
      else now()
    end
  returning * into v_record;

  update public.checkin_attempts set success = true where id = v_attempt;

  -- Defend the invariant even against a lost race with a concurrent excuse:
  -- the row must never be excused + attended = true.
  if v_record.status = 'excused' then
    return jsonb_build_object('ok', false, 'message', 'You''ve been excused for this event — no check-in needed.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', case when v_record.status = 'late' then 'Checked in (late)' else 'Checked in' end,
    'event_id', v_session.event_id,
    'event_name', v_session.event_name,
    'checked_in_at', v_record.checked_in_at,
    'is_late', v_record.status = 'late'
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not record attendance — are you on the roster?');
end;
$$;

create or replace function public.record_attendance_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_session  record;
  v_record   attendance_records%rowtype;
  v_attempt  uuid;
  v_event_id uuid;
  v_is_late  boolean := false;
  v_late_mins int;
  v_status   text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  -- Directors run the band; they don't check in.
  if public.user_has_role('director') then
    return jsonb_build_object('ok', false, 'message', 'Directors don''t check in.');
  end if;

  select cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date, ev.end_date as event_end,
         ev.late_minutes, ev.checkin_mode
    into v_session
    from public.checkin_sessions cs
    join public.events ev on ev.id = cs.event_id
   where cs.entry_code = upper(trim(p_code))
   limit 1;

  -- Bucket this attempt by the event it resolved to (null = unknown code).
  v_event_id := v_session.event_id;

  -- Rate limit: more than 5 failed attempts for this event (or the unknown-code
  -- bucket) in the last 2 minutes → refuse.
  if (select count(*) from public.checkin_attempts
      where actor_id = v_uid
        and event_id is not distinct from v_event_id
        and success = false
        and created_at > now() - interval '2 minutes') >= 5 then
    insert into public.checkin_attempts (event_id, actor_id, success)
    values (v_event_id, v_uid, false);
    return jsonb_build_object('ok', false, 'message', 'Too many attempts — try again in a minute.');
  end if;

  insert into public.checkin_attempts (event_id, actor_id, success)
  values (v_event_id, v_uid, false)
  returning id into v_attempt;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'message', 'That code was not recognized.');
  end if;

  if v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That code has expired — ask for a fresh one.');
  end if;

  -- A manual entry code only works while the event still collects QR/both.
  if v_session.checkin_mode not in ('qr', 'both') then
    return jsonb_build_object('ok', false, 'message', 'This event doesn''t use QR check-in.');
  end if;

  if now() > coalesce(v_session.event_end, v_session.event_date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — attendance is closed.');
  end if;

  -- Check-in opens 15 minutes before the event start.
  if now() < v_session.event_date - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Check-in has not opened yet.');
  end if;

  -- Preserve a staff-set excuse instead of overwriting it.
  if exists (
    select 1 from public.attendance_records ar
     where ar.event_id = v_session.event_id
       and ar.student_id = v_uid
       and ar.status = 'excused'
  ) then
    return jsonb_build_object('ok', false, 'message', 'You''ve been excused for this event — no check-in needed.');
  end if;

  -- Late detection
  v_late_mins := coalesce(v_session.late_minutes, 10);
  if v_session.event_date + (v_late_mins || ' minutes')::interval < now() then
    v_is_late := true;
    v_status := 'late';
  else
    v_status := 'present';
  end if;

  insert into public.attendance_records (
    event_id, student_id, attended, checked_in_at, status, is_late
  )
  values (
    v_session.event_id, v_uid, true, now(), v_status, v_is_late
  )
  on conflict (event_id, student_id)
  do update set
    status = case
      when attendance_records.status in ('present', 'late') then attendance_records.status
      else excluded.status
    end,
    is_late = case
      when attendance_records.status in ('present', 'late') then attendance_records.is_late
      else excluded.is_late
    end,
    attended = true,
    checked_in_at = case
      when attendance_records.status in ('present', 'late')
        then coalesce(attendance_records.checked_in_at, now())
      else now()
    end
  returning * into v_record;

  update public.checkin_attempts set success = true where id = v_attempt;

  if v_record.status = 'excused' then
    return jsonb_build_object('ok', false, 'message', 'You''ve been excused for this event — no check-in needed.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', case when v_record.status = 'late' then 'Checked in (late)' else 'Checked in' end,
    'event_id', v_session.event_id,
    'event_name', v_session.event_name,
    'checked_in_at', v_record.checked_in_at,
    'is_late', v_record.status = 'late'
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not record attendance — are you on the roster?');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. override_attendance — role-scope consistency
-- ---------------------------------------------------------------------------
-- The attendance READ policy gives directors and secretaries access to every
-- record, but the write path applied section-leader scoping to anyone holding
-- the section_leader role — including a director or secretary who also has it.
-- Scoping now applies only to section leaders who are not also director or
-- secretary, so multi-role users (test: student + section_leader, director +
-- section_leader) behave consistently with what they can already read.
create or replace function public.override_attendance(
  p_event_id      uuid,
  p_student_id    uuid,
  p_status        text default 'present',
  p_excuse_reason text default '',
  p_staff_note    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid                   uuid := auth.uid();
  v_attendance_record_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not (public.user_has_role('director') or public.user_has_role('section_leader') or public.user_has_role('secretary')) then
    return jsonb_build_object('ok', false, 'message', 'Only staff may override attendance.');
  end if;

  -- Section scoping applies only to section leaders — not to directors or
  -- secretaries, who are allowed to mark anyone (with or without the extra
  -- section_leader role).
  if public.user_has_role('section_leader')
     and not public.user_has_role('director')
     and not public.user_has_role('secretary') then
    if not exists (
      select 1 from public.profiles s
      where s.id = p_student_id
        and s.instrument <> ''
        and s.instrument = (select instrument from public.profiles p where p.id = v_uid)
    ) then
      return jsonb_build_object('ok', false, 'message', 'You can only mark students in your own section.');
    end if;
  end if;

  -- Directors don't have attendance records.
  if (select roles from public.profiles where id = p_student_id) @> '{director}'::public.app_role[] then
    return jsonb_build_object('ok', false, 'message', 'Directors don''t have attendance records.');
  end if;

  if not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'message', 'Unknown event.');
  end if;

  -- Validate status
  if p_status not in ('present', 'absent', 'excused', 'late') then
    return jsonb_build_object('ok', false, 'message', 'Invalid attendance status.');
  end if;

  if p_status = 'absent' then
    delete from public.attendance_records
     where event_id = p_event_id and student_id = p_student_id;
  else
    insert into public.attendance_records (
      event_id, student_id, attended, checked_in_at, status,
      excuse_reason, is_late, marked_by
    )
    values (
      p_event_id, p_student_id,
      p_status in ('present', 'late'),
      case when p_status in ('present', 'late') then now() else null end,
      p_status,
      p_excuse_reason,
      p_status = 'late',
      v_uid
    )
    on conflict (event_id, student_id)
    do update set
      attended = excluded.attended,
      checked_in_at = case
        when excluded.status in ('present', 'late') and attendance_records.checked_in_at is null
        then now()
        else attendance_records.checked_in_at
      end,
      status = excluded.status,
      excuse_reason = excluded.excuse_reason,
      is_late = excluded.is_late,
      marked_by = excluded.marked_by
    returning id into v_attendance_record_id;

    if coalesce(p_staff_note, '') = '' then
      delete from public.attendance_staff_notes
       where attendance_record_id = v_attendance_record_id;
    else
      insert into public.attendance_staff_notes (
        attendance_record_id, staff_note, created_by, updated_at
      )
      values (
        v_attendance_record_id, p_staff_note, v_uid, now()
      )
      on conflict (attendance_record_id)
      do update set
        staff_note = excluded.staff_note,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at;
    end if;
  end if;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Override failed.');
end;
$$;

-- Grants: CREATE OR REPLACE preserves existing grants, so only restate the
-- analytics ones above (where PUBLIC/anon are revoked). Everything else keeps
-- its current grant set.
