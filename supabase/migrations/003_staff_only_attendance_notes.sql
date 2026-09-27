-- Move internal notes out of the student-readable attendance row.
create table if not exists public.attendance_staff_notes (
  attendance_record_id uuid primary key
    references public.attendance_records (id) on delete cascade,
  staff_note text not null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.attendance_staff_notes enable row level security;

grant select on public.attendance_staff_notes to authenticated;

drop policy if exists "attendance_staff_notes_read_staff" on public.attendance_staff_notes;
create policy "attendance_staff_notes_read_staff"
  on public.attendance_staff_notes for select
  to authenticated
  using (
    exists (
      select 1 from public.attendance_records ar
      where ar.id = attendance_record_id
        and ar.student_id <> auth.uid()
    )
    and (
      public.user_has_role('director')
      or public.user_has_role('secretary')
      or public.user_has_role('section_leader')
    )
  );

-- Preserve existing notes when upgrading a database that still has the column.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attendance_records'
      and column_name = 'staff_note'
  ) then
    insert into public.attendance_staff_notes (
      attendance_record_id, staff_note, created_by, updated_at
    )
    select id, staff_note, marked_by, now()
    from public.attendance_records
    where staff_note <> ''
    on conflict (attendance_record_id)
    do update set
      staff_note = excluded.staff_note,
      created_by = excluded.created_by,
      updated_at = excluded.updated_at;

    alter table public.attendance_records drop column staff_note;
  end if;
end;
$$;

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

  if public.user_has_role('section_leader') then
    if not exists (
      select 1 from public.profiles s
      where s.id = p_student_id
        and s.instrument <> ''
        and s.instrument = (select instrument from public.profiles p where p.id = v_uid)
    ) then
      return jsonb_build_object('ok', false, 'message', 'You can only mark students in your own section.');
    end if;
  end if;

  if (select roles from public.profiles where id = p_student_id) @> '{director}'::public.app_role[] then
    return jsonb_build_object('ok', false, 'message', 'Directors don''t have attendance records.');
  end if;

  if not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'message', 'Unknown event.');
  end if;

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

grant execute on function public.override_attendance(uuid, uuid, text, text, text) to authenticated;
