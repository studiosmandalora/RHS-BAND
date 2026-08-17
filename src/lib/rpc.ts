import { supabase } from "./supabase";
import type { RpcResult } from "./types";

async function callRpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  return { result: (data ?? null) as RpcResult | null, error };
}

export const startCheckinSession = (eventId: string) =>
  callRpc("start_checkin_session", { p_event_id: eventId });

export const recordAttendance = (token: string) =>
  callRpc("record_attendance", { p_token: token });

export const recordAttendanceByCode = (code: string) =>
  callRpc("record_attendance_by_code", { p_code: code });

export const overrideAttendance = (
  eventId: string,
  studentId: string,
  attended: boolean
) =>
  callRpc("override_attendance", {
    p_event_id: eventId,
    p_student_id: studentId,
    p_attended: attended,
  });

export const inviteMember = (
  email: string,
  fullName: string,
  instrument: string
) =>
  callRpc("invite_member", {
    p_email: email,
    p_full_name: fullName,
    p_instrument: instrument,
  });

export const setBandJoinCode = (code: string) =>
  callRpc("set_band_join_code", { p_code: code });

export const getBandJoinCodeStatus = () =>
  callRpc("get_band_join_code_status", {});

/** Director-only: returns the actual join code so it can be displayed/rotated. */
export const getBandJoinCode = () => callRpc("get_band_join_code", {});

export const validateBandJoinCode = (code: string) =>
  callRpc("validate_band_join_code", { p_code: code });

export const resetMemberPassword = (memberId: string) =>
  callRpc("reset_member_password", { p_member_id: memberId });

export const deactivateMember = (memberId: string) =>
  callRpc("deactivate_member", { p_member_id: memberId });

export const reactivateMember = (memberId: string) =>
  callRpc("reactivate_member", { p_member_id: memberId });