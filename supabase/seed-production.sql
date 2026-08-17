-- ============================================================================
-- RHS Band Attendance Manager — Production seed (run AFTER supabase/schema.sql)
-- ----------------------------------------------------------------------------
-- The clean starting point for the real database: creates ONLY the director
-- account. No demo students, no fake events, no chat channels, no attendance.
--
-- IMPORTANT — before running against production:
--   1. Change the email below to the real director's email.
--   2. The password below is a temporary bootstrap credential. The account is
--      created with must_change_password = true, so the director is forced to
--      set a real password on their first sign-in.
--   3. Once signed in, set a band join code from Roster → Band join code so
--      random people can't self-register.
-- ============================================================================

do $$
declare
  v_id uuid := 'd1111111-1111-4111-8111-111111111111';
begin
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'director@rhsband.org', crypt('CHANGE-ME-temp-2026', gen_salt('bf', 10)), now(),
      -- invited_by_director lets handle_new_user() create the profile regardless
      -- of any band join code.
      '{"provider":"email","providers":["email"],"invited_by_director":true}',
      '{"full_name":"Band Director","display_name":"Director","instrument":""}',
      now(), now()
    );
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'director@rhsband.org', 'email_verified', true),
      'email', v_id::text, now(), now(), now()
    );
  end if;
end $$;

-- Promote to director and force a real password on first sign-in. (Runs as the
-- SQL-editor admin role, so the role-change guard doesn't apply.)
update public.profiles
   set role = 'director',
       full_name = 'Band Director',
       display_name = 'Director',
       instrument = '',
       must_change_password = true
 where id = 'd1111111-1111-4111-8111-111111111111';

-- GoTrue fails to authenticate users whose token/change columns are NULL
-- ("Database error querying schema" on sign-in). Direct inserts into
-- auth.users leave them NULL, so force them to '' for both fresh and
-- pre-existing seed accounts.
update auth.users
   set confirmation_token = '',
       recovery_token = '',
       email_change = '',
       email_change_token_new = '',
       email_change_token_current = '',
       phone_change = '',
       phone_change_token = '',
       reauthentication_token = ''
 where id = 'd1111111-1111-4111-8111-111111111111';
