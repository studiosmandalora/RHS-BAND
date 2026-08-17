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
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('student', 'section_leader', 'director');
  end if;
end $$;

create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  full_name            text not null default '',
  display_name         text not null default '',
  instrument           text not null default '',
  role                 public.app_role not null default 'student',
  avatar_url           text not null default '',
  must_change_password boolean not null default false,
  created_at           timestamptz not null default now()
);

-- Auto-create the profiles row on signup (role always starts as 'student').
-- Promotion happens only via the Roster screen (director) — there is no way
-- for a user to self-assign a staff role.
--
-- Self-signup is gated by the band join code: if the director has set one
-- (app_settings.band_join_code), a profile is only created when the signup's
-- raw_user_meta_data.band_join_code matches. A wrong/missing code means the
-- account exists but has no profile → the app shows "not on the roster".
-- Director-invited members (invite_member sets raw_app_meta_data
-- .invited_by_director, which the client cannot forge) always get a profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_join_code text;
  v_provided  text;
begin
  if coalesce(new.raw_app_meta_data ->> 'invited_by_director', 'false') = 'true' then
    insert into public.profiles (id, full_name, display_name, instrument)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', ''),
      coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
      coalesce(new.raw_user_meta_data ->> 'instrument', '')
    );
    return new;
  end if;

  v_join_code := coalesce(
    (select value from public.app_settings where key = 'band_join_code'),
    ''
  );
  if v_join_code <> '' then
    v_provided := coalesce(new.raw_user_meta_data ->> 'band_join_code', '');
    if upper(v_provided) <> upper(v_join_code) then
      return new; -- no profile → not on the roster
    end if;
  end if;

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
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null check (type in ('rehearsal', 'game', 'concert')),
  date       timestamptz not null,
  location   text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx on public.events (date);

-- ---------------------------------------------------------------------------
-- 3. Check-in sessions (QR codes)
-- ---------------------------------------------------------------------------
-- `token` is generated inside start_checkin_session() with
-- encode(gen_random_bytes(24),'hex') → 48 chars, unguessable. `entry_code` is
-- a short human-readable code (6-8 chars) shown next to the QR so students
-- whose camera fails can still check in by typing it. It's nullable so older
-- rows (e.g. the demo seed) don't need one.
create table if not exists public.checkin_sessions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  token      text not null unique,
  entry_code text unique,
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists checkin_sessions_event_idx on public.checkin_sessions (event_id);
create index if not exists checkin_sessions_token_idx on public.checkin_sessions (token);
create index if not exists checkin_sessions_entry_code_idx on public.checkin_sessions (entry_code);

-- ---------------------------------------------------------------------------
-- 4. Attendance records
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  attended     boolean not null default false,
  checked_in_at timestamptz,
  unique (event_id, student_id)
);

create index if not exists attendance_records_student_idx on public.attendance_records (student_id);
create index if not exists attendance_records_event_idx on public.attendance_records (event_id);

-- ---------------------------------------------------------------------------
-- 5. Chat — one channel per instrument section + a General channel
-- ---------------------------------------------------------------------------
create table if not exists public.chat_channels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  section    text not null default '',          -- matches profiles.instrument
  is_general boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_channel_idx on public.chat_messages (channel_id, created_at desc);

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
  if new.role is distinct from old.role then
    if (select public.user_role()) <> 'director' then
      raise exception 'Only directors can change roles';
    end if;
    -- Directors may change students and section leaders, but never another
    -- director's role.
    if old.role = 'director' then
      raise exception 'Directors cannot change another director''s role';
    end if;
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
drop policy if exists "profiles_read_all_authed" on public.profiles;
create policy "profiles_read_all_authed"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_self_or_director" on public.profiles;
create policy "profiles_update_self_or_director"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or (select public.user_role()) = 'director')
  with check (id = auth.uid() or (select public.user_role()) = 'director');

drop policy if exists "profiles_delete_director" on public.profiles;
create policy "profiles_delete_director"
  on public.profiles for delete
  to authenticated
  using ((select public.user_role()) = 'director');

-- events -------------------------------------------------------------------
drop policy if exists "events_read_all_authed" on public.events;
create policy "events_read_all_authed"
  on public.events for select
  to authenticated
  using (true);

drop policy if exists "events_insert_staff" on public.events;
create policy "events_insert_staff"
  on public.events for insert
  to authenticated
  with check (
    (select public.user_role()) in ('director', 'section_leader')
    and created_by = auth.uid()
  );

drop policy if exists "events_update_director" on public.events;
create policy "events_update_director"
  on public.events for update
  to authenticated
  using ((select public.user_role()) = 'director');

drop policy if exists "events_delete_director" on public.events;
create policy "events_delete_director"
  on public.events for delete
  to authenticated
  using ((select public.user_role()) = 'director');

-- checkin_sessions ----------------------------------------------------------
-- Issuers (staff) can read their own sessions; directors can read all (e.g.
-- to re-display a code). Students have NO read access: the only interaction
-- they have with tokens is by scanning and hitting record_attendance().
drop policy if exists "checkin_sessions_read_owner_or_director" on public.checkin_sessions;
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
drop policy if exists "attendance_read_self_staff" on public.attendance_records;
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
drop policy if exists "chat_channels_visible_to_members" on public.chat_channels;
create policy "chat_channels_visible_to_members"
  on public.chat_channels for select
  to authenticated
  using (public.can_use_channel(id)); -- director → everything; others → own section

drop policy if exists "chat_channels_insert_director" on public.chat_channels;
create policy "chat_channels_insert_director"
  on public.chat_channels for insert
  to authenticated
  with check ((select public.user_role()) = 'director');

-- chat_messages -------------------------------------------------------------------
-- Read/posting is scoped by the same rule as channels. General is effectively
-- director-only messaging; members can read/post only in their own section.
drop policy if exists "chat_messages_read_scoped" on public.chat_messages;
create policy "chat_messages_read_scoped"
  on public.chat_messages for select
  to authenticated
  using (public.can_use_channel(channel_id));

drop policy if exists "chat_messages_insert_scoped" on public.chat_messages;
create policy "chat_messages_insert_scoped"
  on public.chat_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_use_channel(channel_id)
  );

-- ---------------------------------------------------------------------------
-- 8. App settings — band join code
-- ---------------------------------------------------------------------------
-- The join code is a shared secret the director sets/rotates from the Roster
-- screen. RLS is enabled with NO client policies: the only code paths that can
-- touch this table are the security-definer RPCs below, so the code itself is
-- never exposed to the client. The client only ever sees a boolean
-- (get_band_join_code_status) and a match check (validate_band_join_code).
create table if not exists public.app_settings (
  key   text primary key,
  value text not null default ''
);

alter table public.app_settings enable row level security;
-- intentionally NO policies: security-definer RPCs only.

-- Director sets/rotates (or clears with '') the join code.
create or replace function public.set_band_join_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := trim(p_code);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if (select public.user_role()) <> 'director' then
    return jsonb_build_object('ok', false, 'message', 'Only directors can change the join code.');
  end if;
  insert into public.app_settings (key, value)
  values ('band_join_code', v_code)
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'message', 'Join code updated.');
end;
$$;

-- Whether a join code is currently required (boolean only — never the code).
create or replace function public.get_band_join_code_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'enabled', coalesce(
      (select value from public.app_settings where key = 'band_join_code'), ''
    ) <> ''
  );
$$;

-- Pre-signup check so the sign-in screen can reject a bad code before creating
-- an account. Callable by anon (no session needed). Returns ok=true when no
-- code is required or when the code matches.
create or replace function public.validate_band_join_code(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok',
    coalesce((select value from public.app_settings where key = 'band_join_code'), '') = ''
    or upper(coalesce(p_code, '')) = upper(
      coalesce((select value from public.app_settings where key = 'band_join_code'), '')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. Security-definer RPCs (the ONLY path to write attendance/codes)
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
  v_uid       uuid := auth.uid();
  v_role      public.app_role := public.user_role();
  v_token     text;
  v_entry     text;
  v_expires   timestamptz;
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

  -- 8-char code from an unambiguous alphabet (no 0/O, 1/I/L) for manual entry.
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
    now() + interval '60 seconds'
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

-- Manual fallback for students whose camera won't start: same validation as
-- record_attendance (same checkin_sessions token/expiry rules) but keyed off
-- the short entry_code the staff member reads aloud / displays on screen.
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
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  select cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date
    into v_session
    from public.checkin_sessions cs
    join public.events ev on ev.id = cs.event_id
   where cs.entry_code = upper(trim(p_code))
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
-- a unique random temporary password) and the identities link; the signup
-- trigger then creates the profiles row with role 'student'. The new member is
-- flagged must_change_password = true so they're forced to set their own
-- password on first sign-in. The temporary password is returned to the caller
-- (the director) so they can hand it to the student directly — it is never
-- stored anywhere else or logged.
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
  v_uid      uuid := auth.uid();
  v_role     public.app_role := public.user_role();
  v_user_id  uuid;
  v_email    text := lower(trim(p_email));
  v_pw       text := null;
  v_existing boolean;
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

  -- If the email already has an account (self-registered or previously
  -- invited), don't create a new one — just add them to the roster below.
  select id into v_user_id from auth.users where email = v_email limit 1;
  v_existing := v_user_id is not null;

  if not v_existing then
    v_user_id := gen_random_uuid();

    -- Per-user random temporary password: 12+ alphanumeric characters.
    v_pw := (
      select string_agg(
        substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
               (random() * 62)::int + 1, 1), '')
      from generate_series(1, 12)
    );

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      -- GoTrue fails to authenticate users whose token/change columns are NULL
      -- ("Database error querying schema" on sign-in), so default them to ''.
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    )
    values (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_pw, gen_salt('bf', 10)),
      now(),
      -- invited_by_director lets handle_new_user() bypass the self-signup join
      -- code and always create a profile for director-added members.
      '{"provider":"email","providers":["email"],"invited_by_director":true}',
      jsonb_build_object('full_name', p_full_name, 'display_name', p_full_name, 'instrument', p_instrument),
      now(),
      now(),
      '', '', '', '', '', '', '', ''
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
  end if;

  -- Add the member to the roster. For a brand-new user the signup trigger
  -- already created a profile; for an existing user this is what actually
  -- adds them to the roster. Role is intentionally left untouched on conflict
  -- so adding someone never silently demotes a section leader.
  insert into public.profiles (id, full_name, display_name, instrument, role, must_change_password)
  values (
    v_user_id,
    p_full_name,
    p_full_name,
    p_instrument,
    'student',
    v_pw is not null  -- force a change only when we issued a temp password
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        -- keep the member's own display name if they've set one
        display_name = case
          when public.profiles.display_name = '' then excluded.display_name
          else public.profiles.display_name
        end,
        instrument = excluded.instrument,
        must_change_password = public.profiles.must_change_password or excluded.must_change_password;

  if v_existing then
    return jsonb_build_object(
      'ok', true,
      'member_id', v_user_id,
      'message', 'That email already has an account — added them to the roster. They sign in with their existing password.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_user_id,
    'temp_password', v_pw,
    'message', 'Member added — share the temporary password with them directly.'
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
grant execute on function public.record_attendance_by_code(text) to authenticated;
grant execute on function public.override_attendance(uuid, uuid, boolean) to authenticated;
grant execute on function public.invite_member(text, text, text) to authenticated;
grant execute on function public.set_band_join_code(text) to authenticated;
grant execute on function public.get_band_join_code_status() to authenticated;
grant execute on function public.validate_band_join_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Storage — avatar photos
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

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 11. Realtime
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