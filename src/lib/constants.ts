import type { EventType, Role } from "./types";

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
  secretary: "Secretary",
  director: "Director",
};

export const ROLE_CHIP: Record<Role, string> = {
  student: "bg-moss text-forest dark:bg-forest/40 dark:text-moss",
  section_leader: "bg-gold/15 text-gold-deep dark:text-gold",
  secretary: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  director: "bg-forest text-white",
};

export function demoAccounts(): { email: string; note: string }[] {
  return [
    { email: "director@rhsband.org", note: "Director — full admin" },
    { email: "secretary@rhsband.org", note: "Secretary — events & check-in" },
    { email: "tyler.nguyen@rhsband.org", note: "Trumpet section leader" },
    { email: "ava.rodriguez@rhsband.org", note: "Flutes" },
    { email: "mia.chen@rhsband.org", note: "Clarinets" },
    { email: "noah.williams@rhsband.org", note: "Saxophones" },
    { email: "ethan.patel@rhsband.org", note: "Percussion" },
    { email: "lily.johnson@rhsband.org", note: "Trombones" },
    { email: "diego.silva@rhsband.org", note: "Baritones" },
    { email: "chloe.brooks@rhsband.org", note: "Flutes" },
  ];
}