import type { EventType, Role } from "./types";

/** Instrument sections — also used for the chat channel seeds. */
export const INSTRUMENTS = [
  "Flute",
  "Clarinet",
  "Saxophone",
  "Trumpet",
  "Trombone",
  "Baritone",
  "Percussion",
  "Color Guard",
] as const;

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  rehearsal: "Rehearsal",
  game: "Game",
  concert: "Concert",
};

export const EVENT_TYPE_CHIP: Record<
  EventType,
  string
> = {
  rehearsal:
    "bg-forest text-white dark:bg-mid",
  game: "bg-gold text-forest-deep dark:text-ink",
  concert:
    "bg-ink text-white dark:bg-zinc-100 dark:text-zinc-900",
};

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  section_leader: "Section Leader",
  director: "Director",
};

export const ROLE_CHIP: Record<Role, string> = {
  student: "bg-moss text-forest dark:bg-forest/40 dark:text-moss",
  section_leader: "bg-gold/15 text-gold-deep dark:text-gold",
  director: "bg-forest text-white",
};

/** Dotted colors used to identify chat channels by section. */
export const SECTION_DOT: Record<string, string> = {
  Flute: "bg-sky-400",
  Clarinet: "bg-amber-400",
  Saxophone: "bg-purple-400",
  Trumpet: "bg-rose-400",
  Trombone: "bg-teal-400",
  Baritone: "bg-indigo-400",
  Percussion: "bg-orange-400",
  "Color Guard": "bg-pink-400",
};

export function sectionDot(section: string): string {
  return SECTION_DOT[section] ?? "bg-zinc-400";
}

export function demoAccounts(): { email: string; note: string }[] {
  return [
    { email: "director@rhsband.org", note: "Director — full admin" },
    { email: "tyler.nguyen@rhsband.org", note: "Trumpet section leader" },
    { email: "ava.rodriguez@rhsband.org", note: "Flutes" },
    { email: "mia.chen@rhsband.org", note: "Clarinets" },
    { email: "noah.williams@rhsband.org", note: "Saxophones" },
    { email: "ethan.patel@rhsband.org", note: "Percussion" },
    { email: "lily.johnson@rhsband.org", note: "Trombones" },
    { email: "diego.silva@rhsband.org", note: "Baritones" },
    { email: "chloe.brooks@rhsband.org", note: "Color Guard" },
  ];
}