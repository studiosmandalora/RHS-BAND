export type Role = "student" | "section_leader" | "director";

export type EventType = "rehearsal" | "game" | "concert";

export interface Profile {
  id: string;
  full_name: string;
  display_name: string;
  instrument: string;
  role: Role;
  avatar_url: string;
  must_change_password: boolean;
  created_at: string;
}

export interface EventRow {
  id: string;
  name: string;
  type: EventType;
  date: string;
  location: string;
  created_by: string;
  created_at: string;
}

export interface CheckinSessionRow {
  id: string;
  event_id: string;
  token: string;
  created_by: string;
  expires_at: string;
  created_at: string;
}

export interface AttendanceRow {
  id: string;
  event_id: string;
  student_id: string;
  attended: boolean;
  checked_in_at: string | null;
}

export interface ChannelRow {
  id: string;
  name: string;
  slug: string;
  section: string;
  is_general: boolean;
  created_at: string;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  sender_id: string;
  text: string;
  created_at: string;
}

/** Shape returned by all the security-definer RPC functions. */
export interface RpcResult {
  ok: boolean;
  message?: string;
  token?: string;
  entry_code?: string;
  expires_at?: string;
  event_id?: string;
  event_name?: string;
  checked_in_at?: string | null;
  temp_password?: string;
  member_id?: string;
  enabled?: boolean;
}