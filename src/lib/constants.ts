import type { AttendanceRequirement, AttendanceStatus, Role } from "./types";

/** Instrument sections. */
export const INSTRUMENTS = [
  "Flute",
  "Clarinet",
  "Saxophone",
  "Trumpet",
  "Trombone",
  "Baritone",
  "Percussion",
] as const;

/** All supported event types with display labels. */
export const EVENT_TYPES = [
  "Rehearsal",
  "Concert",
  "Game",
  "Competition",
  "Performance",
  "Section Meeting",
  "Band Meeting",
  "General Meeting",
  "Parent Meeting",
  "Fundraiser",
  "Event/Activity",
  "Audition",
  "Workshop",
  "Trip",
  "Other",
] as const;

export type EventTypeLabel = (typeof EVENT_TYPES)[number];

/** Map lowercase event type keys to display labels. */
export const EVENT_TYPE_LABEL: Record<string, string> = {
  rehearsal: "Rehearsal",
  concert: "Concert",
  game: "Game",
  competition: "Competition",
  performance: "Performance",
  "section meeting": "Section Meeting",
  "band meeting": "Band Meeting",
  "general meeting": "General Meeting",
  "parent meeting": "Parent Meeting",
  fundraiser: "Fundraiser",
  "event/activity": "Event/Activity",
  audition: "Audition",
  workshop: "Workshop",
  trip: "Trip",
  other: "Other",
};

/** Map event type to chip colors. */
export const EVENT_TYPE_CHIP: Record<string, string> = {
  rehearsal: "bg-forest text-white dark:bg-mid",
  game: "bg-gold text-forest-deep dark:text-ink",
  concert: "bg-ink text-white dark:bg-zinc-100 dark:text-zinc-900",
  competition: "bg-red-600 text-white dark:bg-red-700",
  performance: "bg-purple-600 text-white dark:bg-purple-700",
  "section meeting": "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "band meeting": "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  "general meeting": "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
  "parent meeting": "bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300",
  fundraiser: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  "event/activity": "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
  audition: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  workshop: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  trip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  other: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

/** Attendance requirement display. */
export const ATTENDANCE_REQUIREMENT_LABEL: Record<AttendanceRequirement, string> = {
  required: "Required",
  optional: "Optional",
  none: "No Attendance",
};

export const ATTENDANCE_REQUIREMENT_CHIP: Record<AttendanceRequirement, string> = {
  required: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300",
  optional: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300",
  none: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/** Attendance status display. */
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
  late: "Late",
};

export const ATTENDANCE_STATUS_CHIP: Record<AttendanceStatus, string> = {
  present: "bg-moss text-forest dark:bg-forest/40 dark:text-moss",
  absent: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300",
  excused: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  late: "bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300",
};

/** Excuse reasons. */
export const EXCUSE_REASONS = [
  "Sick",
  "Family emergency",
  "School activity",
  "Approved absence",
  "Other",
] as const;

/** Practice categories. */
export const PRACTICE_CATEGORIES = [
  "Scales & warm-ups",
  "Concert music",
  "Solo preparation",
  "Sight reading",
  "Etudes",
  "Section music",
  "Improvisation",
  "Other",
] as const;

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  section_leader: "Section Leader",
  secretary: "Secretary",
  director: "Director",
};

export const ROLE_CHIP: Record<Role, string> = {
  student: "bg-moss text-forest dark:bg-forest/40 dark:text-moss",
  section_leader: "bg-gold/15 text-gold-deep dark:text-gold",
  secretary: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  director: "bg-forest text-white",
};

/** Look up a display label for an event type (handles custom types). */
export function getEventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type.toLowerCase()] || type || "Event";
}

/** Look up chip colors for an event type (handles custom types). */
export function getEventTypeChip(type: string): string {
  return EVENT_TYPE_CHIP[type.toLowerCase()] || "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
}

export function demoAccounts(): { email: string; note: string; password: string }[] {
  return [
    { email: "guest@checkin.com", note: "Guest — staff view", password: "Guest123" },
    { email: "director@rhsband.org", note: "Director — full admin", password: "band1234" },
    { email: "secretary@rhsband.org", note: "Secretary — events & check-in", password: "band1234" },
    { email: "tyler.nguyen@rhsband.org", note: "Trumpet section leader", password: "band1234" },
    { email: "ava.rodriguez@rhsband.org", note: "Flutes", password: "band1234" },
    { email: "mia.chen@rhsband.org", note: "Clarinets", password: "band1234" },
    { email: "noah.williams@rhsband.org", note: "Saxophones", password: "band1234" },
    { email: "ethan.patel@rhsband.org", note: "Percussion", password: "band1234" },
    { email: "lily.johnson@rhsband.org", note: "Trombones", password: "band1234" },
    { email: "diego.silva@rhsband.org", note: "Baritones", password: "band1234" },
    { email: "chloe.brooks@rhsband.org", note: "Flutes", password: "band1234" },
  ];
}
