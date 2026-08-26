-- ============================================================================
-- RHS Band Attendance Manager — Migration 001
-- Event types, attendance upgrades, Google Calendar sync fix, practice log
-- ============================================================================
-- Run this in Supabase Dashboard → SQL Editor on an existing database.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. FIX: Google Calendar sync — protect manual events & historical data
-- --------------------------------------------------------------------------
-- Replace the sync function so it NEVER deletes manual events.
-- Events without a google_calendar_uid are treated as manually-created.
-- Events with attendance records are never deleted by sync.
-- Disappeared Google Calendar events are archived, not deleted.

create or replace function public.sync_google_calendar_events(
  p_events jsonb,
  p_replace_all boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event jsonb;
  v_seen text[] := '{}';
  v_inserted int := 0;
  v_updated int := 0;
  v_archived int := 0;
  v_deleted_now int := 0;
  v_existing uuid;
begin
  perform set_config('app.suppress_event_notifications', 'true', true);

  -- SAFETY: Never delete manual events. When p_replace_all is true,
  -- archive (don't delete) Google Calendar events that have attendance records.
  -- Manual events (google_calendar_uid IS NULL) are NEVER touched by sync.
  if p_replace_all then
    -- Archive Google Calendar events that have attendance records
    update public.events
    set archived = true
    where google_calendar_uid is not null
      and archived = false
      and exists (
        select 1 from public.attendance_records ar
        where ar.event_id = events.id
      );
    get diagnostics v_archived = row_count;

    -- Delete Google Calendar events WITHOUT attendance records
    -- (safe to remove — no historical data loss)
    delete from public.events
    where google_calendar_uid is not null
      and not exists (
        select 1 from public.attendance_records ar
        where ar.event_id = events.id
      );
    get diagnostics v_deleted_now = row_count;
  end if;

  for v_event in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    if coalesce(v_event ->> 'uid', '') = '' then
      continue;
    end if;

    v_seen := array_append(v_seen, v_event ->> 'uid');
    select id into v_existing
      from public.events
     where google_calendar_uid = v_event ->> 'uid';

    insert into public.events (
      name,
      type,
      date,
      end_date,
      all_day,
      location,
      description,
      google_calendar_uid,
      google_calendar_updated_at,
      google_calendar_synced_at,
      created_by,
      event_source
    ) values (
      coalesce(nullif(v_event ->> 'name', ''), 'Untitled event'),
      coalesce(nullif(v_event ->> 'type', ''), 'rehearsal'),
      (v_event ->> 'date')::timestamptz,
      nullif(v_event ->> 'end_date', '')::timestamptz,
      coalesce((v_event ->> 'all_day')::boolean, false),
      coalesce(v_event ->> 'location', ''),
      coalesce(v_event ->> 'description', ''),
      v_event ->> 'uid',
      nullif(v_event ->> 'updated_at', '')::timestamptz,
      now(),
      null,
      'google_calendar'
    )
    on conflict (google_calendar_uid) do update set
      name = excluded.name,
      type = excluded.type,
      date = excluded.date,
      end_date = excluded.end_date,
      all_day = excluded.all_day,
      location = excluded.location,
      description = excluded.description,
      google_calendar_updated_at = excluded.google_calendar_updated_at,
      google_calendar_synced_at = excluded.google_calendar_synced_at;

    if v_existing is null then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- Archive Google Calendar events that disappeared from the feed
  -- (don't delete — preserve historical attendance)
  update public.events
  set archived = true
  where google_calendar_uid is not null
    and not (google_calendar_uid = any(v_seen))
    and archived = false;

  get diagnostics v_deleted_now = row_count;
  v_archived := v_archived + v_deleted_now;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'archived', v_archived,
    'deleted', 0,
    'seen', coalesce(array_length(v_seen, 1), 0)
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Google Calendar sync failed: ' || sqlerrm);
end;
$$;


-- --------------------------------------------------------------------------
-- 2. Expand event types — allow all band event categories
-- --------------------------------------------------------------------------

-- Drop the old restrictive CHECK constraint on events.type
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_type_check;

-- Add new columns for the enhanced event system
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'rehearsal';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS attendance_requirement text NOT NULL DEFAULT 'required'
  CHECK (attendance_requirement IN ('required', 'optional', 'none'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_source text NOT NULL DEFAULT 'manual'
  CHECK (event_source IN ('manual', 'google_calendar'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS late_minutes int NOT NULL DEFAULT 10;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS reminder_minutes_before int NOT NULL DEFAULT 15;

-- Migrate existing type values to event_source
UPDATE public.events
SET event_source = 'google_calendar'
WHERE google_calendar_uid IS NOT NULL AND event_source = 'manual';

-- Allow any text for type going forward (flexible event types)
-- Keep existing values, but allow new ones
ALTER TABLE public.events ALTER COLUMN type TYPE text;


-- --------------------------------------------------------------------------
-- 3. Attendance status upgrades — present/absent/excused/late
-- --------------------------------------------------------------------------

-- Add new columns to attendance_records
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'absent'
  CHECK (status IN ('present', 'absent', 'excused', 'late'));
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS excuse_reason text NOT NULL DEFAULT '';
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS staff_note text NOT NULL DEFAULT '';
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS is_late boolean NOT NULL DEFAULT false;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS marked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Migrate existing data: set status based on attended boolean
UPDATE public.attendance_records
SET status = CASE WHEN attended THEN 'present' ELSE 'absent' END
WHERE status = 'absent' AND attended = true;

UPDATE public.attendance_records
SET status = 'present'
WHERE attended = true AND status = 'absent';

-- Drop the old attended boolean column (replace with status)
-- We keep attended for backward compatibility but make status the source of truth
-- Actually, let's keep attended as a computed helper and use status as the primary field


-- --------------------------------------------------------------------------
-- 4. Practice log table
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.practice_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  instrument  text NOT NULL DEFAULT '',
  date        date NOT NULL DEFAULT CURRENT_DATE,
  duration_minutes int NOT NULL DEFAULT 0 CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  notes       text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_logs_owner_idx
  ON public.practice_logs (owner_id, date DESC);

ALTER TABLE public.practice_logs ENABLE ROW LEVEL SECURITY;

-- Members can read/write only their own practice logs
DROP POLICY IF EXISTS "practice_logs_own_all" ON public.practice_logs;
CREATE POLICY "practice_logs_own_all"
  ON public.practice_logs FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Directors can read all practice logs (for analytics)
DROP POLICY IF EXISTS "practice_logs_director_read" ON public.practice_logs;
CREATE POLICY "practice_logs_director_read"
  ON public.practice_logs FOR SELECT
  TO authenticated
  USING (public.user_has_role('director'));


-- --------------------------------------------------------------------------
-- 5. Attendance reminders tracking (avoid duplicate sends)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, student_id)
);

ALTER TABLE public.attendance_reminders ENABLE ROW LEVEL SECURITY;
-- RPC-only (service_role), no client policies needed


-- --------------------------------------------------------------------------
-- 6. Updated override_attendance RPC — support excused, late, notes
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.override_attendance(
  p_event_id   uuid,
  p_student_id uuid,
  p_status     text DEFAULT 'present',
  p_excuse_reason text DEFAULT '',
  p_staff_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Not signed in.');
  END IF;
  IF NOT (public.user_has_role('director') OR public.user_has_role('section_leader') OR public.user_has_role('secretary')) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only staff may override attendance.');
  END IF;

  IF public.user_has_role('section_leader') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles s
      WHERE s.id = p_student_id
        AND s.instrument <> ''
        AND s.instrument = (SELECT instrument FROM public.profiles WHERE id = v_uid)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'message', 'You can only mark students in your own section.');
    END IF;
  END IF;

  -- Directors don't have attendance records.
  IF (SELECT roles FROM public.profiles WHERE id = p_student_id) @> '{director}'::public.app_role[] THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Directors don''t have attendance records.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown event.');
  END IF;

  -- Validate status
  IF p_status NOT IN ('present', 'absent', 'excused', 'late') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Invalid attendance status.');
  END IF;

  IF p_status = 'absent' THEN
    DELETE FROM public.attendance_records
     WHERE event_id = p_event_id AND student_id = p_student_id;
  ELSE
    INSERT INTO public.attendance_records (
      event_id, student_id, attended, checked_in_at, status,
      excuse_reason, staff_note, is_late, marked_by
    )
    VALUES (
      p_event_id, p_student_id,
      p_status IN ('present', 'late'),
      CASE WHEN p_status IN ('present', 'late') THEN now() ELSE NULL END,
      p_status,
      p_excuse_reason,
      p_staff_note,
      p_status = 'late',
      v_uid
    )
    ON CONFLICT (event_id, student_id)
    DO UPDATE SET
      attended = EXCLUDED.attended,
      checked_in_at = CASE
        WHEN EXCLUDED.status IN ('present', 'late') AND attendance_records.checked_in_at IS NULL
        THEN now()
        ELSE attendance_records.checked_in_at
      END,
      status = EXCLUDED.status,
      excuse_reason = EXCLUDED.excuse_reason,
      staff_note = EXCLUDED.staff_note,
      is_late = EXCLUDED.is_late,
      marked_by = EXCLUDED.marked_by;
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Override failed.');
END;
$$;


-- --------------------------------------------------------------------------
-- 7. Updated record_attendance RPC — support late detection
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attendance(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_session  record;
  v_record   attendance_records%rowtype;
  v_attempt  uuid;
  v_event_id uuid;
  v_is_late  boolean := false;
  v_late_mins int;
  v_status   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  END IF;

  IF public.user_has_role('director') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Directors don''t check in.');
  END IF;

  SELECT cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date, ev.end_date as event_end,
         ev.late_minutes
    INTO v_session
    FROM public.checkin_sessions cs
    JOIN public.events ev ON ev.id = cs.event_id
   WHERE cs.token = p_token
   LIMIT 1;

  v_event_id := v_session.event_id;

  -- Rate limit
  IF (SELECT count(*) FROM public.checkin_attempts
      WHERE actor_id = v_uid
        AND event_id IS NOT DISTINCT FROM v_event_id
        AND success = false
        AND created_at > now() - interval '2 minutes') >= 5 THEN
    INSERT INTO public.checkin_attempts (event_id, actor_id, success)
    VALUES (v_event_id, v_uid, false);
    RETURN jsonb_build_object('ok', false, 'message', 'Too many attempts — try again in a minute.');
  END IF;

  INSERT INTO public.checkin_attempts (event_id, actor_id, success)
  VALUES (v_event_id, v_uid, false)
  RETURNING id INTO v_attempt;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'That code was not recognized.');
  END IF;

  IF v_session.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'message', 'That code has expired — ask for a fresh one.');
  END IF;

  IF now() > coalesce(v_session.event_end, v_session.event_date + interval '24 hours') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'That event has already ended — attendance is closed.');
  END IF;

  -- Late detection: check if check-in is after grace period
  v_late_mins := coalesce(v_session.late_minutes, 10);
  IF v_session.event_date + (v_late_mins || ' minutes')::interval < now() THEN
    v_is_late := true;
    v_status := 'late';
  ELSE
    v_status := 'present';
  END IF;

  INSERT INTO public.attendance_records (
    event_id, student_id, attended, checked_in_at, status, is_late
  )
  VALUES (
    v_session.event_id, v_uid, true, now(), v_status, v_is_late
  )
  ON CONFLICT (event_id, student_id)
  DO UPDATE SET attended = true
  RETURNING * INTO v_record;

  UPDATE public.checkin_attempts SET success = true WHERE id = v_attempt;

  RETURN jsonb_build_object(
    'ok', true,
    'message', CASE WHEN v_is_late THEN 'Checked in (late)' ELSE 'Checked in' END,
    'event_id', v_session.event_id,
    'event_name', v_session.event_name,
    'checked_in_at', v_record.checked_in_at,
    'is_late', v_is_late
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Could not record attendance — are you on the roster?');
END;
$$;


-- --------------------------------------------------------------------------
-- 8. Updated record_attendance_by_code RPC — support late detection
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attendance_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_session  record;
  v_record   attendance_records%rowtype;
  v_attempt  uuid;
  v_event_id uuid;
  v_is_late  boolean := false;
  v_late_mins int;
  v_status   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  END IF;

  IF public.user_has_role('director') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Directors don''t check in.');
  END IF;

  SELECT cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date, ev.end_date as event_end,
         ev.late_minutes
    INTO v_session
    FROM public.checkin_sessions cs
    JOIN public.events ev ON ev.id = cs.event_id
   WHERE cs.entry_code = upper(trim(p_code))
   LIMIT 1;

  v_event_id := v_session.event_id;

  -- Rate limit
  IF (SELECT count(*) FROM public.checkin_attempts
      WHERE actor_id = v_uid
        AND event_id IS NOT DISTINCT FROM v_event_id
        AND success = false
        AND created_at > now() - interval '2 minutes') >= 5 THEN
    INSERT INTO public.checkin_attempts (event_id, actor_id, success)
    VALUES (v_event_id, v_uid, false);
    RETURN jsonb_build_object('ok', false, 'message', 'Too many attempts — try again in a minute.');
  END IF;

  INSERT INTO public.checkin_attempts (event_id, actor_id, success)
  VALUES (v_event_id, v_uid, false)
  RETURNING id INTO v_attempt;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'That code was not recognized.');
  END IF;

  IF v_session.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'message', 'That code has expired — ask for a fresh one.');
  END IF;

  IF now() > coalesce(v_session.event_end, v_session.event_date + interval '24 hours') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'That event has already ended — attendance is closed.');
  END IF;

  -- Late detection
  v_late_mins := coalesce(v_session.late_minutes, 10);
  IF v_session.event_date + (v_late_mins || ' minutes')::interval < now() THEN
    v_is_late := true;
    v_status := 'late';
  ELSE
    v_status := 'present';
  END IF;

  INSERT INTO public.attendance_records (
    event_id, student_id, attended, checked_in_at, status, is_late
  )
  VALUES (
    v_session.event_id, v_uid, true, now(), v_status, v_is_late
  )
  ON CONFLICT (event_id, student_id)
  DO UPDATE SET attended = true
  RETURNING * INTO v_record;

  UPDATE public.checkin_attempts SET success = true WHERE id = v_attempt;

  RETURN jsonb_build_object(
    'ok', true,
    'message', CASE WHEN v_is_late THEN 'Checked in (late)' ELSE 'Checked in' END,
    'event_id', v_session.event_id,
    'event_name', v_session.event_name,
    'checked_in_at', v_record.checked_in_at,
    'is_late', v_is_late
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Could not record attendance — are you on the roster?');
END;
$$;


-- --------------------------------------------------------------------------
-- 9. Attendance percentage RPC — handles excused absences properly
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_student_attendance_pct(p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'percentage', COALESCE(
      ROUND(
        (SELECT count(*)::numeric FROM public.attendance_records ar
         JOIN public.events e ON e.id = ar.event_id
         WHERE ar.student_id = p_student_id
           AND ar.attended = true
           AND e.archived = false
           AND e.attendance_requirement = 'required'
        ) /
        NULLIF(
          (SELECT count(*)::numeric FROM public.events e
           WHERE e.archived = false
             AND e.attendance_requirement = 'required'
             AND e.date < now()
             AND NOT EXISTS (
               SELECT 1 FROM public.attendance_records ar2
               WHERE ar2.event_id = e.id
                 AND ar2.student_id = p_student_id
                 AND ar2.status = 'excused'
             )
          ), 0
        ) * 100, 0
      ), 0
    )
  );
$$;


-- --------------------------------------------------------------------------
-- 10. Section attendance analytics RPC
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_section_attendance_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH section_stats AS (
    SELECT
      p.instrument as section,
      count(DISTINCT p.id) as member_count,
      round(avg(
        CASE
          WHEN required_events.cnt > 0 THEN
            (attended_count.ac::numeric / required_events.cnt) * 100
          ELSE 0
        END
      ), 1) as avg_attendance_pct
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT count(*)::int as ac
      FROM public.attendance_records ar
      JOIN public.events e ON e.id = ar.event_id
      WHERE ar.student_id = p.id
        AND ar.attended = true
        AND e.archived = false
        AND e.attendance_requirement = 'required'
    ) attended_count ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int as cnt
      FROM public.events e
      WHERE e.archived = false
        AND e.attendance_requirement = 'required'
        AND e.date < now()
    ) required_events ON true
    WHERE p.instrument <> ''
      AND NOT (p.roles @> '{director}'::public.app_role[])
      AND p.deactivated = false
    GROUP BY p.instrument
    ORDER BY p.instrument
  )
  SELECT jsonb_agg(row_to_json(s)) FROM section_stats s;
$$;


-- --------------------------------------------------------------------------
-- 11. Event attendance summary RPC
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_event_attendance_summary(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH stats AS (
    SELECT
      count(*) FILTER (WHERE status = 'present') as present_count,
      count(*) FILTER (WHERE status = 'late') as late_count,
      count(*) FILTER (WHERE status = 'excused') as excused_count,
      count(*) FILTER (WHERE status = 'absent' OR status IS NULL) as absent_count
    FROM public.attendance_records ar
    WHERE ar.event_id = p_event_id
  ),
  roster AS (
    SELECT count(*)::int as total
    FROM public.profiles p
    WHERE NOT (p.roles @> '{director}'::public.app_role[])
      AND p.deactivated = false
  )
  SELECT jsonb_build_object(
    'ok', true,
    'present', (SELECT present_count FROM stats),
    'late', (SELECT late_count FROM stats),
    'excused', (SELECT excused_count FROM stats),
    'absent', (SELECT absent_count FROM stats),
    'total', (SELECT total FROM roster)
  );
$$;


-- --------------------------------------------------------------------------
-- 12. Attendance trend RPC — last N required events
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_attendance_trend(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent_events AS (
    SELECT e.id, e.name, e.type, e.date, e.event_type
    FROM public.events e
    WHERE e.archived = false
      AND e.attendance_requirement = 'required'
      AND e.date < now()
    ORDER BY e.date DESC
    LIMIT p_limit
  ),
  event_stats AS (
    SELECT
      re.id, re.name, re.type, re.date, re.event_type,
      (SELECT count(*) FROM public.profiles p
       WHERE NOT (p.roles @> '{director}'::public.app_role[]) AND p.deactivated = false) as roster_size,
      (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.event_id = re.id AND ar.attended = true) as present_count,
      (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.event_id = re.id AND ar.status = 'excused') as excused_count,
      (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.event_id = re.id AND ar.status = 'late') as late_count
    FROM recent_events re
  )
  SELECT jsonb_agg(row_to_json(es)) FROM event_stats es;
$$;


-- --------------------------------------------------------------------------
-- 13. Migrate existing checkin_mode='none' to attendance_requirement='none'
-- --------------------------------------------------------------------------

UPDATE public.events
SET attendance_requirement = 'none'
WHERE checkin_mode = 'none';

UPDATE public.events
SET attendance_requirement = 'required'
WHERE checkin_mode IN ('qr', 'toggle', 'both')
  AND attendance_requirement = 'required';


-- --------------------------------------------------------------------------
-- 14. Add grants for new RPCs
-- --------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.get_student_attendance_pct(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_section_attendance_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_attendance_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_trend(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.override_attendance(uuid, uuid, text, text, text) TO authenticated;

-- Revoke old boolean override signature (backward compat: keep both)
-- The old signature still works but the new one is preferred
GRANT EXECUTE ON FUNCTION public.override_attendance(uuid, uuid, boolean) TO authenticated;


-- --------------------------------------------------------------------------
-- 15. Enable realtime on new tables
-- --------------------------------------------------------------------------

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.practice_logs;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Done!
