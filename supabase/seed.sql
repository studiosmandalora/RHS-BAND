-- ============================================================================
-- RHS Band Attendance Manager — Seed data (run AFTER supabase/schema.sql)
-- ----------------------------------------------------------------------------
-- Creates demo auth users (email/password, bcrypt hashed), their profiles,
-- a few past + upcoming events, attendance history, chat channels and some
-- starter messages, so the app is demoable immediately.
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
      '{"full_name":"Marissa Bennett","display_name":"Ms. Bennett","instrument":""}',
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

  -- ---------- Chloe Brooks — color guard ----------
  v_id := '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'chloe.brooks@rhsband.org', crypt('band1234', gen_salt('bf', 10)), now(),
      '{}'::jsonb,
      '{"full_name":"Chloe Brooks","display_name":"Chloe","instrument":"Color Guard"}',
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
end $$;

-- ---------------------------------------------------------------------------
-- 2. Roles & display names (the signup trigger already created the rows)
-- ---------------------------------------------------------------------------
update public.profiles
   set role = 'director',
       full_name = 'Marissa Bennett',
       display_name = 'Ms. Bennett',
       instrument = ''
 where id = 'd1111111-1111-4111-8111-111111111111';

update public.profiles
   set role = 'section_leader',
       full_name = 'Tyler Nguyen',
       display_name = 'Tyler'
 where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

update public.profiles set display_name = 'Ava'  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.profiles set display_name = 'Mia'  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.profiles set display_name = 'Noah' where id = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
update public.profiles set display_name = 'Ethan' where id = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
update public.profiles set display_name = 'Lily' where id = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
update public.profiles set display_name = 'Diego' where id = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
update public.profiles set display_name = 'Chloe' where id = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';

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
   (current_date + 19)::timestamptz + interval '18 hours', 'PAC Auditorium', 'd1111111-1111-4111-8111-111111111111');

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
  ('e0000003-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true,  now() - interval '3 days' + interval '40 minutes');

-- ---------------------------------------------------------------------------
-- 5. Chat channels (one per instrument section + General) and starter messages
-- ---------------------------------------------------------------------------
insert into public.chat_channels (id, name, slug, section, is_general) values
  ('c0000001-0000-4000-8000-000000000001', 'General',        'general',   '',            true),
  ('c0000002-0000-4000-8000-000000000002', 'Flutes',         'flute',     'Flute',       false),
  ('c0000003-0000-4000-8000-000000000003', 'Clarinets',      'clarinet',  'Clarinet',    false),
  ('c0000004-0000-4000-8000-000000000004', 'Saxophones',     'saxophone', 'Saxophone',   false),
  ('c0000005-0000-4000-8000-000000000005', 'Trumpets',       'trumpet',   'Trumpet',     false),
  ('c0000006-0000-4000-8000-000000000006', 'Trombones',      'trombone',  'Trombone',    false),
  ('c0000007-0000-4000-8000-000000000007', 'Baritones',      'baritone',  'Baritone',    false),
  ('c0000008-0000-4000-8000-000000000008', 'Percussion',     'percussion','Percussion',  false),
  ('c0000009-0000-4000-8000-000000000009', 'Color Guard',    'guard',     'Color Guard', false);

insert into public.chat_messages (channel_id, sender_id, text, created_at) values
  ('c0000001-0000-4000-8000-000000000001', 'd1111111-1111-4111-8111-111111111111',
   'Welcome to the RHS Band app! Sign in on your phone, then check in at every event so we can track attendance. Go Band! 🎺', now() - interval '2 days'),
  ('c0000001-0000-4000-8000-000000000001', 'd1111111-1111-4111-8111-111111111111',
   'Reminder: after-school rehearsal is at 3:30 — be there at 3:15. Hydrate!', now() - interval '4 hours'),
  ('c0000002-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Does anyone have an extra flip folder for music? I lost mine at the parade 😅', now() - interval '3 hours'),
  ('c0000002-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '@Ava Ms. Bennett keeps spares in the band cabinet, ask at check-in!', now() - interval '2 hours'),
  ('c0000005-0000-4000-8000-000000000005', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'Trumpets — run the chorale from measure 41 twice before Friday rehearsal. Serious about intonation this week. 🎺', now() - interval '1 day'),
  ('c0000008-0000-4000-8000-000000000008', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
   'Do NOT drop the bass drum at the home opener. I repeat: do NOT.', now() - interval '6 hours'),
  ('c0000009-0000-4000-8000-000000000009', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c',
   'New flags arrive tomorrow!! Practice tosses at lunch 🪭💛', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- 6. Optional: a previously used (now expired) check-in code
-- ---------------------------------------------------------------------------
insert into public.checkin_sessions (id, event_id, token, created_by, expires_at, created_at) values (
  'c5ec0000-0000-4000-8000-0000000000c5',
  'e0000004-0000-4000-8000-000000000004',
  '000000000000000000000000000000000000000000000000',
  'd1111111-1111-4111-8111-111111111111',
  now() - interval '1 day',
  now() - interval '1 day' - interval '1 minute'
);

-- ---------------------------------------------------------------------------
-- 7. Important: give the seed a stable, documented base URL for QR codes
-- ---------------------------------------------------------------------------
-- The QR code encodes <origin>/checkin?token=TOKEN, using the URL of the
-- device that generated it — no configuration needed.