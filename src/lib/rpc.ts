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