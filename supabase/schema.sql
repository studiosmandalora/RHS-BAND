-- ============================================================================
-- RHS Band Attendance Manager — Database schema, RLS & security-definer RPCs
-- ----------------------------------------------------------------------------
-- How to use: paste this entire file into Supabase Dashboard → SQL Editor and
-- run it. Then run supabase/seed.sql (also in the SQL editor).
--
-- Security model:
--   * Every table has Row Level Security enabled; roles are read from the
--     `profiles.role` column ('director' | 'section_leader' | 'student').
--   * Attendance rows can NEVER be inserted/updated/deleted directly from the
--     client — there are no INSERT/UPDATE/DELETE policies on
--     attendance_records. Every write goes through a security-definer RPC
--     (record_attendance / override_attendance) that re-validates who you are.
--   * Check-in codes can only be issued through start_checkin_session (staff
--     only) and are single-use-per-generation: issuing a new code deletes the
--     old one for that event.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Roles & profiles
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('student', 'section_leader', 'director');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text not null default '',
  display_name text not null default '',
  instrument   text not null default '',
  role         public.app_role not null default 'student',
  avatar_url   text not null default '',
  created_at   timestamptz not null default now()
);

-- Auto-create the profiles row on signup (role always starts as 'student').
-- Promotion happens only via the Roster screen (director) — there is no way
-- for a user to self-assign a staff role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, display_name, instrument)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'instrument', '')
  );
  return new;
exception
  when others then
    -- never let an auth insert die because of the profile row
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Events
-- ---------------------------------------------------------------------------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null check (type in ('rehearsal', 'game', 'concert')),
  date       timestamptz not null,
  location   text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index events_date_idx on public.events (date);

-- ---------------------------------------------------------------------------
-- 3. Check-in sessions (QR codes)
-- ---------------------------------------------------------------------------
-- `token` is generated inside start_checkin_session() with
-- encode(gen_random_bytes(24),'hex') → 48 chars, unguessable.
create table public.checkin_sessions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  token      text not null unique,
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index checkin_sessions_event_idx on public.checkin_sessions (event_id);
create index checkin_sessions_token_idx on public.checkin_sessions (token);

-- ---------------------------------------------------------------------------
-- 4. Attendance records
-- ---------------------------------------------------------------------------
create table public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  attended     boolean not null default false,
  checked_in_at timestamptz,
  unique (event_id, student_id)
);

create index attendance_records_student_idx on public.attendance_records (student_id);
create index attendance_records_event_idx on public.attendance_records (event_id);

-- ---------------------------------------------------------------------------
-- 5. Chat — one channel per instrument section + a General channel
-- ---------------------------------------------------------------------------
create table public.chat_channels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  section    text not null default '',          -- matches profiles.instrument
  is_general boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index chat_messages_channel_idx on public.chat_messages (channel_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Shared helpers (used by RLS policies and RPCs)
-- ---------------------------------------------------------------------------
-- The current signed-in user's role. security definer so policies can call it
-- without recursively tripping over the profiles RLS policies.
create or replace function public.user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Whether the current user may see/post in the given channel:
--   directors → every channel (including General)
--   students & section leaders → only their own instrument's channel
create or replace function public.can_use_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_channels c
    where c.id = p_channel_id
      and (
        (select public.user_role()) = 'director'
        or (
          c.is_general is not true
          and c.section <> ''
          and c.section = (select instrument from public.profiles where id = auth.uid())
        )
      )
  );
$$;

-- Don't let anyone change their own (or anyone's) role unless they are a director.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and (select public.user_role()) <> 'director' then
    raise exception 'Only directors can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_change on public.profiles;
create trigger profiles_guard_role_change
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------------------------------------------------------------------------
-- 7. Row Level Security policies
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.checkin_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;

-- profiles ------------------------------------------------------------------
-- Everyone signed in may read the roster (needed for chat sender names,
-- calendar et cetera), and may update their own row; directors can update any
-- row. Rows are only ever created by the signup trigger; any member may be
-- deleted by a director (removal from the roster).
create policy "profiles_read_all_authed"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_self_or_director"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or (select public.user_role()) = 'director')
  with check (id = auth.uid() or (select public.user_role()) = 'director');

create policy "profiles_delete_director"
  on public.profiles for delete
  to authenticated
  using ((select public.user_role()) = 'director');

-- events -------------------------------------------------------------------
create policy "events_read_all_authed"
  on public.events for select
  to authenticated
  using (true);

create policy "events_insert_staff"
  on public.events for insert
  to authenticated
  with check (
    (select public.user_role()) in ('director', 'section_leader')
    and created_by = auth.uid()
  );

create policy "events_update_director"
  on public.events for update
  to authenticated
  using ((select public.user_role()) = 'director');

create policy "events_delete_director"
  on public.events for delete
  to authenticated
  using ((select public.user_role()) = 'director');

-- checkin_sessions ----------------------------------------------------------
-- Issuers (staff) can read their own sessions; directors can read all (e.g.
-- to re-display a code). Students have NO read access: the only interaction
-- they have with tokens is by scanning and hitting record_attendance().
create policy "checkin_sessions_read_owner_or_director"
  on public.checkin_sessions for select
  to authenticated
  using (
    created_by = auth.uid()
    or (select public.user_role()) = 'director'
  );
-- intentionally NO insert/update/delete policies → the only writer is the
-- security-definer RPC start_checkin_session().

-- attendance_records ----------------------------------------------------------------
-- No INSERT / UPDATE / DELETE policies at all: the client can never write
-- attendance directly. Everything goes through record_attendance() (QR scan)
-- or override_attendance() (staff manual toggle).
create policy "attendance_read_self_staff"
  on public.attendance_records for select
  to authenticated
  using (
    student_id = auth.uid()
    or (select public.user_role()) = 'director'
    or (
      (select public.user_role()) = 'section_leader'
      and exists (
        select 1 from public.profiles p
        where p.id = attendance_records.student_id
          and p.instrument <> ''
          and p.instrument = (select instrument from public.profiles where id = auth.uid())
      )
    )
  );

-- chat_channels ----------------------------------------------------------------
create policy "chat_channels_visible_to_members"
  on public.chat_channels for select
  to authenticated
  using (public.can_use_channel(id)); -- director → everything; others → own section

create policy "chat_channels_insert_director"
  on public.chat_channels for insert
  to authenticated
  with check ((select public.user_role()) = 'director');

-- chat_messages -------------------------------------------------------------------
-- Read/posting is scoped by the same rule as channels. General is effectively
-- director-only messaging; members can read/post only in their own section.
create policy "chat_messages_read_scoped"
  on public.chat_messages for select
  to authenticated
  using (public.can_use_channel(channel_id));

create policy "chat_messages_insert_scoped"
  on public.chat_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_use_channel(channel_id)
  );

-- ---------------------------------------------------------------------------
-- 8. Security-definer RPCs (the ONLY path to write attendance/codes)
-- ---------------------------------------------------------------------------

-- Staff start a 60-second live code for an event. Issuing a new code for the
-- same event deletes the previous one → old codes are instantly invalid.
create or replace function public.start_checkin_session(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.app_role := public.user_role();
  v_token   text;
  v_expires timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to generate a code.');
  end if;
  if v_role not in ('director', 'section_leader') then
    return jsonb_build_object('ok', false, 'message', 'Only directors and section leaders can generate codes.');
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'message', 'That event no longer exists.');
  end if;

  delete from public.checkin_sessions where event_id = p_event_id;

  insert into public.checkin_sessions (event_id, created_by, token, expires_at)
  values (
    p_event_id,
    v_uid,
    encode(gen_random_bytes(24), 'hex'),
    now() + interval '60 seconds'
  )
  returning token, expires_at into v_token, v_expires;

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires
  );
end;
$$;

-- The ONLY way a student can be marked present: validates that the token
-- exists, belongs to a real event, is unexpired and that the event matches
-- the currently scheduled one (i.e. an upcoming event, not a past one), then
-- upserts the attendance row for the signed-in student. Idempotent: scanning
-- twice keeps the first check-in time.
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
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  select cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date
    into v_session
    from public.checkin_sessions cs
    join public.events ev on ev.id = cs.event_id
   where cs.token = p_token
   limit 1;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'message', 'That code was not recognized.');
  end if;

  if v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That code has expired — ask for a fresh one.');
  end if;

  if v_session.event_date <= now() - interval '12 hours' then
    return jsonb_build_object('ok', false, 'message', 'That code belongs to a past event.');
  end if;

  insert into public.attendance_records (event_id, student_id, attended, checked_in_at)
  values (v_session.event_id, v_uid, true, now())
  on conflict (event_id, student_id)
  do update set attended = true
  returning * into v_record;

  return jsonb_build_object(
    'ok', true,
    'message', 'Checked in',
    'event_id', v_session.event_id,
    'event_name', v_session.event_name,
    'checked_in_at', v_record.checked_in_at
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not record attendance — are you on the roster?');
end;
$$;

-- Manual override (staff). Directors may mark anyone; section leaders only
-- students whose instrument matches their own section.
create or replace function public.override_attendance(
  p_event_id   uuid,
  p_student_id uuid,
  p_attended   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.app_role := public.user_role();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if v_role not in ('director', 'section_leader') then
    return jsonb_build_object('ok', false, 'message', 'Only staff may override attendance.');
  end if;

  if v_role = 'section_leader' then
    if not exists (
      select 1 from public.profiles s
      where s.id = p_student_id
        and s.instrument <> ''
        and s.instrument = (select instrument from public.profiles p where p.id = v_uid)
    ) then
      return jsonb_build_object('ok', false, 'message', 'You can only mark students in your own section.');
    end if;
  end if;

  if not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'message', 'Unknown event.');
  end if;

  if p_attended then
    insert into public.attendance_records (event_id, student_id, attended, checked_in_at)
    values (p_event_id, p_student_id, true, now())
    on conflict (event_id, student_id)
    do update set attended = true, checked_in_at = now();
  else
    delete from public.attendance_records
     where event_id = p_event_id and student_id = p_student_id;
  end if;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Override failed.');
end;
$$;

-- Director adds a member to the roster: creates the auth.user (confirmed email,
-- temporary password) and the identities link; the signup trigger then creates
-- the profiles row with role 'student'.
create or replace function public.invite_member(
  p_email      text,
  p_full_name  text,
  p_instrument text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.app_role := public.user_role();
  v_user_id uuid := gen_random_uuid();
  v_email   text := lower(trim(p_email));
  v_pw      text := 'band1234';
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if v_role <> 'director' then
    return jsonb_build_object('ok', false, 'message', 'Only directors can add members.');
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'message', 'Enter a valid email address.');
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    return jsonb_build_object('ok', false, 'message', 'An account already exists for that email.');
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_pw, gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name, 'display_name', p_full_name, 'instrument', p_instrument),
    now(),
    now()
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  )
  values (
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'member_id', v_user_id,
    'temp_password', v_pw,
    'message', 'Member added — temporary password: ' || v_pw
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not add member: ' || sqlerrm);
end;
$$;

grant execute on function public.user_role() to authenticated;
grant execute on function public.can_use_channel(uuid) to authenticated;
grant execute on function public.start_checkin_session(uuid) to authenticated;
grant execute on function public.record_attendance(text) to authenticated;
grant execute on function public.override_attendance(uuid, uuid, boolean) to authenticated;
grant execute on function public.invite_member(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Storage — avatar photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do nothing;

create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 10. Realtime
-- ---------------------------------------------------------------------------
-- Chat messages stream to subscribed clients and a staff member watching the
-- Check-In screen sees check-ins arrive live.
-- Best-effort: if the project's publication differs (e.g. some newer projects),
-- enable Realtime per table from Dashboard → Table editor → Realtime instead.
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attendance_records;
exception when others then null;
end $$;