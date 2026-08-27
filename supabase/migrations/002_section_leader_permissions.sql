-- ============================================================================
-- Migration 002: Restrict section leader instrument permissions
-- ============================================================================
-- Section leaders can no longer change anyone's instrument via the RPC.
-- Only directors can change instruments. Students change their own instrument
-- through the Profile screen (direct profiles table update).

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
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.user_has_role('director') then
    return jsonb_build_object('ok', false, 'message', 'Only directors can change instruments.');
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;
  if (select roles from public.profiles where id = p_member_id) @> '{director}'::public.app_role[] then
    return jsonb_build_object('ok', false, 'message', 'Directors cannot change another director''s instrument.');
  end if;

  update public.profiles set instrument = p_instrument where id = p_member_id;
  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not update instrument.');
end;
$$;
