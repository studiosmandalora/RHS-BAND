-- ============================================================================
-- RHS Band Attendance Manager — Seed data (run AFTER supabase/schema.sql)
-- ----------------------------------------------------------------------------
-- Creates demo auth users (email/password, bcrypt hashed), their profiles,
-- a few past + upcoming events and attendance history, so the app is
-- demoable immediately.
--
-- All demo accounts use the password:  band1234
--   director@rhsband.org     → Marissa Bennett (director)
--   tyler.nguyen@rhsband.org → Tyler Nguyen    (trumpet, section leader)
--   ava.rodriguez@...        etc. (students across sections)
--
-- Dates are generated relative to CURRENT_DATE so the demo always has a
-- believable mix of past and upcoming events.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisite check — the schema must have been applied (and committed)
-- ---------------------------------------------------------------------------
-- The seed inserts a 'secretary' demo profile, so the app_role enum must
-- already contain that value. schema.sql adds it, but only becomes visible
-- after that script's transaction commits. Fail with a clear message instead
-- of a cryptic enum error if the schema hasn't been re-run.
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role'
      and e.enumlabel = 'secretary'
  ) then
    raise exception
      'Run supabase/schema.sql first (and let it finish) — the app_role enum is missing the “secretary” value.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Auth users (needs pgcrypto — pre-installed on Supabase)
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  -- ---------- Marissa Bennett — director ----------
  v_id := 'd1111111-1111-4111-8111-111111111111';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'director@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Marissa Bennett","display_name":"Ms. Bennett","instrument":"Conductor"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'director@rhsband.org',
                         'email_verified', true),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Tyler Nguyen — trumpet section leader ----------
  v_id := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'tyler.nguyen@rhsband.org',
      crypt('band1234', gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Tyler Nguyen","display_name":"Tyler","instrument":"Trumpet"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'tyler.nguyen@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Ava Rodriguez — flute ----------
  v_id := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ava.rodriguez@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Ava Rodriguez","display_name":"Ava","instrument":"Flute"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'ava.rodriguez@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Mia Chen — clarinet ----------
  v_id := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mia.chen@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Mia Chen","display_name":"Mia","instrument":"Clarinet"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'mia.chen@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Noah Williams — saxophone ----------
  v_id := 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'noah.williams@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{}'::jsonb,
      '{"full_name":"Noah Williams","display_name":"Noah","instrument":"Saxophone"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'noah.williams@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Ethan Patel — percussion ----------
  v_id := 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ethan.patel@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{}'::jsonb,
      '{"full_name":"Ethan Patel","display_name":"Ethan","instrument":"Percussion"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'ethan.patel@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Lily Johnson — trombone ----------
  v_id := '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'lily.johnson@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{}'::jsonb,
      '{"full_name":"Lily Johnson","display_name":"Lily","instrument":"Trombone"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'lily.johnson@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Diego Silva — baritone ----------
  v_id := '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'diego.silva@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{}'::jsonb,
      '{"full_name":"Diego Silva","display_name":"Diego","instrument":"Baritone"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'diego.silva@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Chloe Brooks — flute ----------
  v_id := '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'chloe.brooks@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{}'::jsonb,
      '{"full_name":"Chloe Brooks","display_name":"Chloe","instrument":"Flute"}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'chloe.brooks@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- ---------- Sam Rivera — secretary ----------
  v_id := '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'secretary@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{}'::jsonb,
      '{"full_name":"Sam Rivera","display_name":"Sam","instrument":""}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'secretary@rhsband.org'),
      'email', v_id::text, now(), now(), now()
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Roles & display names — UPSERTED so demo profiles always exist, even when
--    the auth users already existed (so the signup trigger never fired, e.g.
--    after reset.sql) or a band join code is set. Runs as the SQL-editor admin
--    (no auth.uid()), so the role-change guard doesn't apply.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, full_name, display_name, instrument, role, must_change_password)
values
  ('d1111111-1111-4111-8111-111111111111', 'Marissa Bennett', 'Ms. Bennett', 'Conductor',   'director',       false),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Tyler Nguyen',    'Tyler',       'Trumpet',     'section_leader', false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ava Rodriguez',   'Ava',         'Flute',       'student',        false),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Mia Chen',        'Mia',         'Clarinet',    'student',        false),
  ('e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'Noah Williams',   'Noah',        'Saxophone',   'student',        false),
  ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'Ethan Patel',     'Ethan',       'Percussion',  'student',        false),
  ('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', 'Lily Johnson',    'Lily',        'Trombone',    'student',        false),
  ('2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', 'Diego Silva',     'Diego',       'Baritone',    'student',        false),
  ('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', 'Chloe Brooks',    'Chloe',       'Flute',       'student',        false),
  ('4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d', 'Sam Rivera',      'Sam',         '',            'secretary',      false)
on conflict (id) do update
  set full_name = excluded.full_name,
      display_name = excluded.display_name,
      instrument = excluded.instrument,
      role = excluded.role,
      must_change_password = false;

-- ---------------------------------------------------------------------------
-- 2b. GoTrue token columns
-- ---------------------------------------------------------------------------
-- GoTrue fails to authenticate users whose token/change columns are NULL
-- ("Database error querying schema" on sign-in). Direct inserts into
-- auth.users leave them NULL, so force them to '' for all demo accounts.
update auth.users
   set confirmation_token = '',
       recovery_token = '',
       email_change = '',
       email_change_token_new = '',
       email_change_token_current = '',
       phone_change = '',
       phone_change_token = '',
       reauthentication_token = ''
 where email in (
   'director@rhsband.org',
   'secretary@rhsband.org',
   'tyler.nguyen@rhsband.org',
   'ava.rodriguez@rhsband.org',
   'mia.chen@rhsband.org',
   'noah.williams@rhsband.org',
   'ethan.patel@rhsband.org',
   'lily.johnson@rhsband.org',
   'diego.silva@rhsband.org',
   'chloe.brooks@rhsband.org'
 );

-- ---------------------------------------------------------------------------
-- 3. Events (relative to today so the demo always shows a live calendar)
-- ---------------------------------------------------------------------------
insert into public.events (id, name, type, date, location, created_by) values
  ('e0000001-0000-4000-8000-000000000001', 'Field Show Block — Week 3', 'rehearsal',
   (current_date - 9)::timestamptz + interval '17 hours', 'RHS Stadium', 'd1111111-1111-4111-8111-111111111111'),
  ('e0000002-0000-4000-8000-000000000002', 'Home Exhibition vs. Northside', 'game',
   (current_date - 7)::timestamptz + interval '19 hours', 'RHS Stadium', 'd1111111-1111-4111-8111-111111111111'),
  ('e0000003-0000-4000-8000-000000000003', 'Preview Concert — Band Shell', 'concert',
   (current_date - 3)::timestamptz + interval '18 hours 30 minutes', 'Downtown Band Shell', 'd1111111-1111-4111-8111-111111111111'),
  ('e0000004-0000-4000-8000-000000000004', 'After-School Rehearsal', 'rehearsal',
   (current_date + 2)::timestamptz + interval '15 hours 30 minutes', 'Band Room', 'd1111111-1111-4111-8111-111111111111'),
  ('e0000005-0000-4000-8000-000000000005', 'Home Opener vs. Springfield', 'game',
   (current_date + 6)::timestamptz + interval '19 hours', 'RHS Stadium', 'd1111111-1111-4111-8111-111111111111'),
  ('e0000006-0000-4000-8000-000000000006', 'Away @ Central High', 'game',
   (current_date + 13)::timestamptz + interval '18 hours 30 minutes', 'Central High Stadium', 'd1111111-1111-4111-8111-111111111111'),
  ('e0000007-0000-4000-8000-000000000007', 'Fall Concert — Bring a Friend', 'concert',
   (current_date + 19)::timestamptz + interval '18 hours', 'PAC Auditorium', 'd1111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Past attendance (present/absent across the 3 past events)
-- ---------------------------------------------------------------------------
insert into public.attendance_records (event_id, student_id, attended, checked_in_at) values
  ('e0000001-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true,  now() - interval '9 days' + interval '1 hour'),
  ('e0000001-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true,  now() - interval '9 days' + interval '2 hour'),
  ('e0000001-0000-4000-8000-000000000001', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', false, null),
  ('e0000001-0000-4000-8000-000000000001', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', true,  now() - interval '9 days' + interval '40 minutes'),
  ('e0000001-0000-4000-8000-000000000001', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', true,  now() - interval '9 days' + interval '90 minutes'),
  ('e0000001-0000-4000-8000-000000000001', '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', true,  now() - interval '9 days' + interval '1 hour'),
  ('e0000001-0000-4000-8000-000000000001', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', false, null),
  ('e0000001-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true,  now() - interval '9 days' + interval '45 minutes'),
  ('e0000002-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true,  now() - interval '7 days' + interval '30 minutes'),
  ('e0000002-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false, null),
  ('e0000002-0000-4000-8000-000000000002', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', true,  now() - interval '7 days' + interval '1 hour'),
  ('e0000002-0000-4000-8000-000000000002', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', false, null),
  ('e0000002-0000-4000-8000-000000000002', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', true,  now() - interval '7 days' + interval '2 hours'),
  ('e0000002-0000-4000-8000-000000000002', '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', true,  now() - interval '7 days' + interval '55 minutes'),
  ('e0000002-0000-4000-8000-000000000002', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', true,  now() - interval '7 days' + interval '3 hours'),
  ('e0000002-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true,  now() - interval '7 days' + interval '1 hour'),
  ('e0000003-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true,  now() - interval '3 days' + interval '45 minutes'),
  ('e0000003-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true,  now() - interval '3 days' + interval '30 minutes'),
  ('e0000003-0000-4000-8000-000000000003', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', true,  now() - interval '3 days' + interval '1 hour'),
  ('e0000003-0000-4000-8000-000000000003', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', true,  now() - interval '3 days' + interval '15 minutes'),
  ('e0000003-0000-4000-8000-000000000003', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', true,  now() - interval '3 days' + interval '2 hours'),
  ('e0000003-0000-4000-8000-000000000003', '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', false, null),
  ('e0000003-0000-4000-8000-000000000003', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', true,  now() - interval '3 days' + interval '25 minutes'),
  ('e0000003-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true,  now() - interval '3 days' + interval '40 minutes')
on conflict (event_id, student_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Optional: a previously used (now expired) check-in code
-- ---------------------------------------------------------------------------
insert into public.checkin_sessions (id, event_id, token, created_by, expires_at, created_at) values (
  'c5ec0000-0000-4000-8000-0000000000c5',
  'e0000004-0000-4000-8000-000000000004',
  '000000000000000000000000000000000000000000000000',
  'd1111111-1111-4111-8111-111111111111',
  now() - interval '1 day',
  now() - interval '1 day' - interval '1 minute'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Important: give the seed a stable, documented base URL for QR codes
-- ---------------------------------------------------------------------------
-- The QR code encodes <origin>/checkin?token=TOKEN, using the URL of the
-- device that generated it — no configuration needed.