-- ============================================================================
-- Migration 004: Bulk roster import (CSV upload)
-- ============================================================================
-- Adds invite_members_bulk(p_members jsonb): accepts an array of
-- {email, full_name, instrument} objects and runs every row through the
-- shared single-row implementation of invite_member, returning a per-row
-- result array ({email, ok, message, temp_password}) so one bad row never
-- blocks the rest of the batch. Batch size is capped at 200 rows.
--
-- invite_member's body moves into public.invite_member_one() unchanged —
-- the role checks, section-leader scoping and auth-user creation live there
-- exactly once. invite_member keeps its exact signature, behaviour and
-- grants, and just delegates, so the single-add flow is untouched.
--
-- The helper is internal: EXECUTE is revoked from PUBLIC and from client
-- roles — only the two RPCs (which run as the function owner) can call it.
--
-- Idempotent — safe to re-run in the Supabase SQL Editor.

create or replace function public.invite_member_one(
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
  v_user_id  uuid;
  v_email    text := lower(trim(p_email));
  v_pw       text := null;
  v_existing boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not (public.user_has_role('director') or public.user_has_role('section_leader')) then
    return jsonb_build_object('ok', false, 'message', 'Only directors and section leaders can add members.');
  end if;
  if public.user_has_role('section_leader') and not public.user_has_role('director') then
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
  -- adds them to the roster. Roles are intentionally left untouched on
  -- conflict so adding someone never silently demotes a section leader.
  insert into public.profiles (id, full_name, display_name, instrument, roles, must_change_password)
  values (
    v_user_id,
    p_full_name,
    p_full_name,
    p_instrument,
    '{student}'::public.app_role[],
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

-- Thin wrapper kept for backward compatibility: same signature, same
-- behaviour, same permission rules — it just delegates to the shared
-- single-row implementation above so the single-add flow can never drift
-- away from the bulk one.
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
begin
  return public.invite_member_one(p_email, p_full_name, p_instrument);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not add member: ' || sqlerrm);
end;
$$;

-- Bulk roster import: accepts an array of {email, full_name, instrument}
-- objects and runs every row through invite_member_one(), so the permission
-- rules are identical to the single-member flow (director: any section;
-- section leader: their own section, always as students — including the
-- forced-instrument scoping, which lives only in the shared implementation).
--
-- Each row is reported individually — one bad row (invalid email, existing
-- account, …) never blocks the rest of the batch — and the batch is capped at
-- 200 rows to avoid a runaway request.
create or replace function public.invite_members_bulk(p_members jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_total   int;
  v_ok      int := 0;
  v_failed  int := 0;
  v_row     jsonb;
  v_result  jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  -- Fail fast on permissions so an unauthorized caller gets one clear error
  -- instead of N identical per-row ones. invite_member_one re-checks this
  -- same rule for every row — the logic itself lives only there.
  if not (public.user_has_role('director') or public.user_has_role('section_leader')) then
    return jsonb_build_object('ok', false, 'message', 'Only directors and section leaders can add members.');
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    return jsonb_build_object('ok', false, 'message', 'Expected an array of members.');
  end if;

  v_total := jsonb_array_length(p_members);
  if v_total = 0 then
    return jsonb_build_object('ok', false, 'message', 'No rows to import.');
  end if;
  if v_total > 200 then
    return jsonb_build_object('ok', false, 'message', 'Too many rows — import at most 200 at a time.');
  end if;

  for v_row in select * from jsonb_array_elements(p_members) loop
    begin
      v_result := public.invite_member_one(
        coalesce(v_row ->> 'email', ''),
        coalesce(v_row ->> 'full_name', ''),
        coalesce(v_row ->> 'instrument', '')
      );
    exception
      when others then
        -- A single failing row must never abort the whole batch.
        v_result := jsonb_build_object('ok', false, 'message', 'Could not add member: ' || sqlerrm);
    end;

    if coalesce(v_result ->> 'ok', 'false') = 'true' then
      v_ok := v_ok + 1;
    else
      v_failed := v_failed + 1;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'email', coalesce(v_row ->> 'email', ''),
      'ok', coalesce(v_result ->> 'ok', 'false') = 'true',
      'message', coalesce(v_result ->> 'message', ''),
      -- Only present for brand-new accounts — the director must relay it.
      'temp_password', v_result -> 'temp_password'
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'succeeded', v_ok,
    'failed', v_failed,
    'results', v_results
  );
end;
$$;

-- invite_member_one is an internal helper shared by the two RPCs above.
-- Postgres grants EXECUTE to PUBLIC by default, so revoke from PUBLIC first —
-- revoking only from roles would leave PUBLIC (and with it every client) able
-- to call it directly. The RPCs run as the function owner, so they keep working.
revoke execute on function public.invite_member_one(text, text, text) from public;
revoke execute on function public.invite_member_one(text, text, text) from anon, authenticated;
grant execute on function public.invite_member(text, text, text) to authenticated;
grant execute on function public.invite_members_bulk(jsonb) to authenticated;
