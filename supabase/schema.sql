-- ============================================================================
-- RHS Band Attendance Manager — Database schema, RLS & security-definer RPCs
-- ----------------------------------------------------------------------------
-- How to use: paste this entire file into Supabase Dashboard → SQL Editor and
-- run it. Then run supabase/seed.sql (also in the SQL editor).
--
-- Security model:
--   * Every table has Row Level Security enabled; roles are read from the
--     `profiles.role` column ('director' | 'section_leader' | 'secretary' |
--     'student').
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
    create type public.app_role as enum ('student', 'section_leader', 'secretary', 'director');
  end if;
end $$;

-- Add the secretary role on databases created before it existed (idempotent).
-- Note: a newly-added enum value can't be USED in the same transaction, and the
-- SQL editor runs this whole script as one transaction. So everywhere below
-- that compares against 'secretary' casts the role to text first (::text),
-- which avoids comparing the enum value directly.
alter type public.app_role add value if not exists 'secretary';

create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  full_name            text not null default '',
  display_name         text not null default '',
  instrument           text not null default '',
  role                 public.app_role not null default 'student',
  avatar_url           text not null default '',
  must_change_password boolean not null default false,
  -- Soft-deactivation: the director can disable a member's sign-in without
  -- deleting their profile or attendance history (see deactivate_member /
  -- reactivate_member). Kept in sync with auth.users.banned_until by the RPCs.
  deactivated          boolean not null default false,
  created_at           timestamptz not null default now()
);

-- Idempotent migration for databases created before `deactivated` existed.
alter table public.profiles add column if not exists deactivated boolean not null default false;

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
  end_date   timestamptz,
  all_day    boolean not null default false,
  location   text not null default '',
  description text not null default '',
  google_calendar_uid text unique,
  google_calendar_updated_at timestamptz,
  google_calendar_synced_at timestamptz,
  -- Informational only (the RLS insert policy just requires it to be the
  -- current user). Nullable so an event survives if its creator is later
  -- removed from the roster.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Idempotent migration for databases created before Google Calendar sync.
alter table public.events add column if not exists end_date timestamptz;
alter table public.events add column if not exists all_day boolean not null default false;
alter table public.events add column if not exists description text not null default '';
alter table public.events add column if not exists google_calendar_uid text unique;
alter table public.events add column if not exists google_calendar_updated_at timestamptz;
alter table public.events add column if not exists google_calendar_synced_at timestamptz;

create index if not exists events_date_idx on public.events (date);
create index if not exists events_google_calendar_uid_idx
  on public.events (google_calendar_uid);

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
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists checkin_sessions_event_idx on public.checkin_sessions (event_id);
create index if not exists checkin_sessions_token_idx on public.checkin_sessions (token);
create index if not exists checkin_sessions_entry_code_idx on public.checkin_sessions (entry_code);

-- ---------------------------------------------------------------------------
-- 3b. Referential actions when a member is removed from the roster
-- ---------------------------------------------------------------------------
-- Directors remove a member by deleting their profiles row (Roster screen).
-- That delete would fail on the FK constraints below whenever the member ever
-- created events or check-in sessions, so:
--   * events           → SET NULL: the event stays on the calendar, its
--                        created_by simply becomes null
--   * checkin_sessions → CASCADE: ephemeral 5-minute codes die with creator
-- These statements are idempotent: re-running schema.sql on an existing
-- database applies the same behavior without erroring.
alter table public.events
  drop constraint if exists events_created_by_fkey,
  add constraint events_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;
alter table public.events
  alter column created_by drop not null;

alter table public.checkin_sessions
  drop constraint if exists checkin_sessions_created_by_fkey,
  add constraint checkin_sessions_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete cascade;

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
-- 4b. Check-in attempt log (rate limiting)
-- ---------------------------------------------------------------------------
-- One row per attempt to check in (QR scan or manual code). Written ONLY by the
-- security-definer RPCs below — the client has no access. `event_id` is null
-- when the code didn't resolve to a known event (e.g. a wrong manual code), so
-- those attempts still count toward a lockout bucket. record_attendance* reject
-- a user who has more than 5 failed attempts in the last 2 minutes for the
-- same event (null event = the "unknown code" bucket).
create table if not exists public.checkin_attempts (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references public.events (id) on delete cascade,
  actor_id   uuid not null references public.profiles (id) on delete cascade,
  success    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists checkin_attempts_actor_event_idx
  on public.checkin_attempts (actor_id, event_id, created_at desc);

-- No client policies: the only writers are the security-definer RPCs.
alter table public.checkin_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- 4c. Personal events — each member's own private calendar entries
-- ---------------------------------------------------------------------------
create table if not exists public.personal_events (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  date       timestamptz not null,
  location   text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists personal_events_owner_idx
  on public.personal_events (owner_id, date);

alter table public.personal_events enable row level security;

-- Members may read/write only their own personal events.
drop policy if exists "personal_events_own_all" on public.personal_events;
create policy "personal_events_own_all"
  on public.personal_events for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. Shared helpers (used by RLS policies and RPCs)
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

-- Best-effort client IP for rate limiting anonymous calls (e.g. join-code
-- validation before signup). PostgREST exposes the request headers as a GUC;
-- the client IP is the first entry of X-Forwarded-For (see Supabase docs,
-- "Securing your API"). This is a throttle, not a security boundary — a
-- determined attacker can spoof the header — but it stops casual brute-forcing.
create or replace function public.client_ip()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(
      split_part(
        coalesce(
          current_setting('request.headers', true)::json ->> 'x-forwarded-for',
          ''
        ),
        ',',
        1
      ),
      ''
    ),
    'unknown'
  );
$$;

grant execute on function public.client_ip() to anon, authenticated;

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
    -- Directors may change students, section leaders and secretaries, but
    -- never another director's role.
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
-- 6. Row Level Security policies
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.checkin_sessions enable row level security;
alter table public.attendance_records enable row level security;

-- profiles ------------------------------------------------------------------
-- Everyone signed in may read the roster (needed for member names, avatars,
-- attendance, et cetera), and may update their own row; directors can update
-- any row. Rows are only ever created by the signup trigger; any member may be
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
  using (
    -- Only directors may delete profiles (and with it the auth account).
    -- Directors manage students, section leaders & secretaries — never another
    -- director (or themselves).
    (select public.user_role()) = 'director' and role <> 'director' and id <> auth.uid()
  );

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
    (select public.user_role())::text in ('director', 'secretary')
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
-- Read: yourself, or any staff member (director/secretary see everyone;
-- section leaders are scoped to their own section) — this mirrors
-- override_attendance() so staff can view what they may edit.
drop policy if exists "attendance_read_self_staff" on public.attendance_records;
create policy "attendance_read_self_staff"
  on public.attendance_records for select
  to authenticated
  using (
    student_id = auth.uid()
    or (select public.user_role()) in ('director', 'secretary')
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

-- ---------------------------------------------------------------------------
-- 7. App settings — band join code
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

-- Join-code brute-force protection: one row per validation attempt, keyed by
-- the caller's best-effort IP. Written only by validate_band_join_code.
create table if not exists public.join_code_attempts (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null default '',
  success    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists join_code_attempts_ip_idx
  on public.join_code_attempts (ip, created_at desc);

-- intentionally NO policies: RPC-only.
alter table public.join_code_attempts enable row level security;

-- Pre-signup check so the sign-in screen can reject a bad code before creating
-- an account. Callable by anon (no session needed). Logs every attempt keyed
-- by client IP and refuses (with a friendly message) once a single IP has more
-- than 5 failed attempts in the last 2 minutes.
create or replace function public.validate_band_join_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip       text := public.client_ip();
  v_required text := coalesce(
    (select value from public.app_settings where key = 'band_join_code'), ''
  );
  v_ok       boolean;
begin
  v_ok := v_required = '' or upper(coalesce(p_code, '')) = upper(v_required);

  -- Lockout: too many recent failures from this IP → refuse, even if the code
  -- happens to be right now, so the throttled client can't trivially bypass.
  if (select count(*) from public.join_code_attempts
      where ip = v_ip
        and success = false
        and created_at > now() - interval '2 minutes') >= 5 then
    insert into public.join_code_attempts (ip, success) values (v_ip, false);
    return jsonb_build_object(
      'ok', false,
      'message', 'Too many attempts — try again in a minute.'
    );
  end if;

  insert into public.join_code_attempts (ip, success) values (v_ip, v_ok);

  if v_ok then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object(
    'ok', false,
    'message', 'That band join code isn''t right — ask your director for the current one.'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Security-definer RPCs (the ONLY path to write attendance/codes)
-- ---------------------------------------------------------------------------

-- Staff start a 5-minute live code for an event. Issuing a new code for the
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
  if v_role::text not in ('director', 'section_leader', 'secretary') then
    return jsonb_build_object('ok', false, 'message', 'Only directors, secretaries and section leaders can generate codes.');
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'message', 'That event no longer exists.');
  end if;

  -- Never open check-in for an event that has already ended.
  if now() > coalesce(
    (select end_date from public.events where id = p_event_id),
    (select date from public.events where id = p_event_id) + interval '24 hours'
  ) then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — check-in is closed.');
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
  v_attempt  uuid;
  v_event_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  select cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date, ev.end_date as event_end
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

  -- Attendance is only accepted while the event is happening (or hasn't
  -- started yet). Once it's over, the code is dead even if it's still
  -- unexpired — no retroactive check-ins.
  if now() > coalesce(v_session.event_end, v_session.event_date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — attendance is closed.');
  end if;

  insert into public.attendance_records (event_id, student_id, attended, checked_in_at)
  values (v_session.event_id, v_uid, true, now())
  on conflict (event_id, student_id)
  do update set attended = true
  returning * into v_record;

  update public.checkin_attempts set success = true where id = v_attempt;

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
  v_attempt  uuid;
  v_event_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  select cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date, ev.end_date as event_end
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

  -- Attendance is only accepted while the event is happening (or hasn't
  -- started yet). Once it's over, the code is dead even if it's still
  -- unexpired — no retroactive check-ins.
  if now() > coalesce(v_session.event_end, v_session.event_date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — attendance is closed.');
  end if;

  insert into public.attendance_records (event_id, student_id, attended, checked_in_at)
  values (v_session.event_id, v_uid, true, now())
  on conflict (event_id, student_id)
  do update set attended = true
  returning * into v_record;

  update public.checkin_attempts set success = true where id = v_attempt;

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
  if v_role::text not in ('director', 'section_leader', 'secretary') then
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

-- Adds a member to the roster: creates the auth.user (confirmed email, a
-- unique random temporary password) and the identities link; the signup
-- trigger then creates the profiles row with role 'student'. The new member is
-- flagged must_change_password = true so they're forced to set their own
-- password on first sign-in. The temporary password is returned to the caller
-- so they can hand it to the student directly — it is never stored anywhere
-- else or logged.
--
-- Directors may add anyone to any section. Section leaders may only add
-- members to their OWN section (always as students).
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
  if v_role not in ('director', 'section_leader') then
    return jsonb_build_object('ok', false, 'message', 'Only directors and section leaders can add members.');
  end if;
  if v_role = 'section_leader' then
    -- Section leaders may only add members to their own section, always as
    -- students — they can never create staff or move members between sections.
    p_instrument := (select instrument from public.profiles where id = v_uid);
    if coalesce(p_instrument, '') = '' then
      return jsonb_build_object('ok', false, 'message', 'Your section isn''t set — ask the director to assign your instrument first.');
    end if;
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

-- ---------------------------------------------------------------------------
-- 8b. In-app notifications (bell) + realtime
-- ---------------------------------------------------------------------------
-- One row per notification per recipient. Rows are created ONLY by the
-- security-definer triggers below (which run as the table owner and therefore
-- bypass RLS), so there are no INSERT policies. Members can read and update
-- (mark read) only their own rows.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in ('new_event', 'checkin_open')),
  title      text not null,
  body       text not null default '',
  payload    jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- New event → notify every roster member except the creator.
create or replace function public.notify_new_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.suppress_event_notifications', true) = 'true' then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, payload)
  select p.id, 'new_event', 'New event added', new.name,
         jsonb_build_object('event_id', new.id, 'event_name', new.name)
    from public.profiles p
   where p.id <> new.created_by;
  return new;
end;
$$;

drop trigger if exists on_event_inserted on public.events;
create trigger on_event_inserted
  after insert on public.events
  for each row execute function public.notify_new_event();

-- Check-in window opened → notify every roster member except the issuer.
create or replace function public.notify_checkin_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from public.events where id = new.event_id;
  insert into public.notifications (user_id, type, title, body, payload)
  select p.id, 'checkin_open', 'Check-in is open', coalesce(v_name, 'Check-in is live'),
         jsonb_build_object('event_id', new.event_id, 'event_name', v_name)
    from public.profiles p
   where p.id <> new.created_by;
  return new;
end;
$$;

drop trigger if exists on_checkin_session_inserted on public.checkin_sessions;
create trigger on_checkin_session_inserted
  after insert on public.checkin_sessions
  for each row execute function public.notify_checkin_open();

-- ---------------------------------------------------------------------------
-- 8c. Admin tools (director-only, security definer)
-- ---------------------------------------------------------------------------

-- Director resets a member's password (e.g. a student who can't use the email
-- reset flow). Generates a fresh random temp password, forces a change on next
-- sign-in, and returns the password so the director can relay it directly.
-- Also clears any ban so the reset works for a deactivated member too.
create or replace function public.reset_member_password(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_pw  text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if (select public.user_role()) <> 'director' then
    return jsonb_build_object('ok', false, 'message', 'Only directors can reset passwords.');
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;

  v_pw := (
    select string_agg(
      substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
             (random() * 62)::int + 1, 1), '')
    from generate_series(1, 12)
  );

  update auth.users
     set encrypted_password = crypt(v_pw, gen_salt('bf', 10)),
         banned_until = null
   where id = p_member_id;

  update public.profiles
     set must_change_password = true
   where id = p_member_id;

  return jsonb_build_object(
    'ok', true,
    'temp_password', v_pw,
    'message', 'Temporary password set — the member must change it on next sign-in.'
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not reset password: ' || sqlerrm);
end;
$$;

-- Soft-deactivate: blocks sign-in (GoTrue bans the user via banned_until) and
-- flags the profile, but keeps the member's profile and attendance history
-- intact. Directors manage students & section leaders, never other directors.
create or replace function public.deactivate_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if (select public.user_role()) <> 'director' then
    return jsonb_build_object('ok', false, 'message', 'Only directors can deactivate members.');
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;
  if (select role from public.profiles where id = p_member_id) = 'director' then
    return jsonb_build_object('ok', false, 'message', 'Directors cannot deactivate another director.');
  end if;

  update public.profiles set deactivated = true where id = p_member_id;
  update auth.users set banned_until = now() + interval '100 years' where id = p_member_id;

  return jsonb_build_object('ok', true, 'message', 'Member deactivated — they can no longer sign in.');
end;
$$;

create or replace function public.reactivate_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if (select public.user_role()) <> 'director' then
    return jsonb_build_object('ok', false, 'message', 'Only directors can reactivate members.');
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;
  if (select role from public.profiles where id = p_member_id) = 'director' then
    return jsonb_build_object('ok', false, 'message', 'Directors cannot reactivate another director.');
  end if;

  update public.profiles set deactivated = false where id = p_member_id;
  update auth.users set banned_until = null where id = p_member_id;

  return jsonb_build_object('ok', true, 'message', 'Member reactivated — they can sign in again.');
end;
$$;

-- Change a member's instrument/section. Directors may change anyone's
-- (except other directors); section leaders may only change members whose
-- instrument already matches their own (i.e. their own section) — they cannot
-- move members between sections or touch other sections.
create or replace function public.update_member_instrument(
  p_member_id uuid,
  p_instrument text
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
  if v_role = 'director' then
    if not exists (select 1 from public.profiles where id = p_member_id) then
      return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
    end if;
    if (select role from public.profiles where id = p_member_id) = 'director' then
      return jsonb_build_object('ok', false, 'message', 'Directors cannot change another director''s instrument.');
    end if;
  elsif v_role = 'section_leader' then
    -- Section leaders: the member must already be in their own section
    -- (same instrument), and must not be themselves or another staff member.
    if not exists (
      select 1 from public.profiles s
      where s.id = p_member_id
        and s.role = 'student'
        and s.instrument <> ''
        and s.instrument = (select instrument from public.profiles where id = v_uid)
    ) then
      return jsonb_build_object('ok', false, 'message', 'You can only change instruments of students in your own section.');
    end if;
  else
    return jsonb_build_object('ok', false, 'message', 'Only staff may change instruments.');
  end if;

  update public.profiles set instrument = p_instrument where id = p_member_id;
  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not update instrument.');
end;
$$;

-- Director-only getter for the current join code (so the Roster screen can
-- display it). The code is a shared secret, so this is gated on role — the
-- boolean-only get_band_join_code_status() remains the public-facing check.
create or replace function public.get_band_join_code()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when (select public.user_role()) = 'director'
    then jsonb_build_object(
      'ok', true,
      'code', coalesce((select value from public.app_settings where key = 'band_join_code'), '')
    )
    else jsonb_build_object('ok', false, 'message', 'Only directors can view the join code.')
  end;
$$;

grant execute on function public.user_role() to authenticated;
grant execute on function public.start_checkin_session(uuid) to authenticated;
grant execute on function public.record_attendance(text) to authenticated;
grant execute on function public.record_attendance_by_code(text) to authenticated;
grant execute on function public.override_attendance(uuid, uuid, boolean) to authenticated;
grant execute on function public.invite_member(text, text, text) to authenticated;
grant execute on function public.set_band_join_code(text) to authenticated;
grant execute on function public.get_band_join_code_status() to authenticated;
grant execute on function public.get_band_join_code() to authenticated;
grant execute on function public.reset_member_password(uuid) to authenticated;
grant execute on function public.deactivate_member(uuid) to authenticated;
grant execute on function public.reactivate_member(uuid) to authenticated;
grant execute on function public.update_member_instrument(uuid, text) to authenticated;
grant execute on function public.validate_band_join_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 8d. Google Calendar sync
-- ---------------------------------------------------------------------------
-- Called by the sync_google_calendar Edge Function with service-role rights.
-- The Google Calendar feed becomes the source of truth for band events: the
-- first sync removes old in-app events, then future syncs upsert by Google UID
-- and delete synced events that disappeared from the feed.
create or replace function public.sync_google_calendar_events(
  p_events jsonb,
  p_replace_all boolean default true
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
  v_deleted int := 0;
  v_deleted_now int := 0;
  v_existing uuid;
begin
  perform set_config('app.suppress_event_notifications', 'true', true);

  if p_replace_all then
    delete from public.events where google_calendar_uid is null;
    get diagnostics v_deleted = row_count;
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
      created_by
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
      null
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

  delete from public.events
   where google_calendar_uid is not null
     and not (google_calendar_uid = any(v_seen));
  get diagnostics v_deleted_now = row_count;
  v_deleted := v_deleted + v_deleted_now;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'deleted', v_deleted,
    'seen', coalesce(array_length(v_seen, 1), 0)
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Google Calendar sync failed: ' || sqlerrm);
end;
$$;

revoke execute on function public.sync_google_calendar_events(jsonb, boolean) from anon, authenticated;
grant execute on function public.sync_google_calendar_events(jsonb, boolean) to service_role;
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
-- 10. Realtime
-- ---------------------------------------------------------------------------
-- A staff member watching the Check-In screen sees check-ins arrive live.
-- Best-effort: if the project's publication differs (e.g. some newer projects),
-- enable Realtime per table from Dashboard → Table editor → Realtime instead.
do $$
begin
  alter publication supabase_realtime add table public.attendance_records;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null;
end $$;