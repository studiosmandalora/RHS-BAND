// ============================================================================
// sync_google_calendar - import the public RHS Band Google Calendar ICS feed
// ----------------------------------------------------------------------------
// Deploy:
//   supabase functions deploy sync_google_calendar
// Optional secrets:
//   GOOGLE_CALENDAR_ICS_URL=https://calendar.google.com/calendar/ical/.../public/basic.ics
//   CALENDAR_SYNC_SECRET=some-long-random-value  (for scheduled cron calls)
// ============================================================================

/// <reference path="../deno-types.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const calendarIcsUrl =
  Deno.env.get("GOOGLE_CALENDAR_ICS_URL") ??
  "https://calendar.google.com/calendar/ical/9f3763f58e6882a95ca8064b93de88d329622698cfcaa9e2450b58c594b2c48e%40group.calendar.google.com/public/basic.ics";
const syncSecret = Deno.env.get("CALENDAR_SYNC_SECRET") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-calendar-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ImportedEvent = {
  uid: string;
  name: string;
  type: "rehearsal" | "game" | "concert";
  date: string;
  end_date: string | null;
  all_day: boolean;
  location: string;
  description: string;
  updated_at: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isSyncResult(value: unknown): value is Record<string, unknown> & { ok: boolean } {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}

function unfoldIcs(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = left.split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: rawName.toUpperCase(), params, value };
}

function unescapeText(value = ""): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function tzOffsetMs(utcDate: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcDate);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcDate.getTime();
}

function zonedTimeToUtcIso(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
  timeZone: string,
): string {
  const localAsUtc = Date.UTC(y, m - 1, d, hh, mm, ss);
  let utc = localAsUtc - tzOffsetMs(new Date(localAsUtc), timeZone);
  utc = localAsUtc - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

function parseIcsDate(line: { params: Record<string, string>; value: string }, defaultTimeZone: string): { iso: string; allDay: boolean } | null {
  const v = line.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (line.params.VALUE === "DATE" || dateOnly) {
    const m = dateOnly;
    if (!m) return null;
    return {
      iso: zonedTimeToUtcIso(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, line.params.TZID ?? defaultTimeZone),
      allDay: true,
    };
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dt) return null;
  const [, y, mo, da, h, mi, s, z] = dt;
  if (z === "Z") {
    return {
      iso: new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(s))).toISOString(),
      allDay: false,
    };
  }
  return {
    iso: zonedTimeToUtcIso(
      Number(y),
      Number(mo),
      Number(da),
      Number(h),
      Number(mi),
      Number(s),
      line.params.TZID ?? defaultTimeZone,
    ),
    allDay: false,
  };
}

function inferType(summary: string): ImportedEvent["type"] {
  const s = summary.toLowerCase();
  if (/concert|festival|performance|show|winterfest|ensemble/.test(s)) return "concert";
  if (/game|football|basketball|pep band|mustang band jam/.test(s)) return "game";
  return "rehearsal";
}

function parseEvents(icsText: string): ImportedEvent[] {
  const lines = unfoldIcs(icsText);
  const timeZone = lines
    .map(parseLine)
    .find((line) => line?.name === "X-WR-TIMEZONE")?.value ?? "America/Los_Angeles";
  const events: ImportedEvent[] = [];
  let current: Record<string, ReturnType<typeof parseLine>[]> | null = null;

  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (raw === "END:VEVENT") {
      if (current) {
        const first = (name: string) => current?.[name]?.[0] ?? null;
        const uid = first("UID")?.value ?? "";
        const status = first("STATUS")?.value ?? "CONFIRMED";
        const startLine = first("DTSTART");
        const parsedStart = startLine ? parseIcsDate(startLine, timeZone) : null;
        if (uid && parsedStart && status !== "CANCELLED") {
          const endLine = first("DTEND");
          const parsedEnd = endLine ? parseIcsDate(endLine, timeZone) : null;
          const name = unescapeText(first("SUMMARY")?.value ?? "Untitled event");
          events.push({
            uid,
            name,
            type: inferType(name),
            date: parsedStart.iso,
            end_date: parsedEnd?.iso ?? null,
            all_day: parsedStart.allDay,
            location: unescapeText(first("LOCATION")?.value ?? ""),
            description: unescapeText(first("DESCRIPTION")?.value ?? ""),
            updated_at: first("LAST-MODIFIED") ? parseIcsDate(first("LAST-MODIFIED")!, timeZone)?.iso ?? null : null,
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const line = parseLine(raw);
    if (!line) continue;
    current[line.name] = [...(current[line.name] ?? []), line];
  }

  events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return events;
}

async function isAllowed(req: Request): Promise<boolean> {
  if (syncSecret && req.headers.get("x-calendar-sync-secret") === syncSecret) return true;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const { data, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  return !error && Boolean(data.user);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST." }, 405);

  try {
    if (!(await isAllowed(req))) return json({ ok: false, message: "Not allowed." }, 401);

    const icsRes = await fetch(calendarIcsUrl, { headers: { "User-Agent": "rhs-band-attendance/1.0" } });
    if (!icsRes.ok) {
      return json({ ok: false, message: `Google Calendar fetch failed (${icsRes.status}).` }, 502);
    }

    const events = parseEvents(await icsRes.text());
    // p_replace_all = false: Google events are upserted by UID and events
    // removed from the feed are deleted, but manually-added band events
    // (google_calendar_uid IS NULL) are preserved. Only the one-off migration
    // sync would pass true.
    const { data, error } = await supabase.rpc("sync_google_calendar_events", {
      p_events: events,
      p_replace_all: false,
    });
    if (error) throw error;
    if (isSyncResult(data) && !data.ok) {
      throw new Error(typeof data.message === "string" ? data.message : "Calendar sync RPC failed.");
    }

    return json({ ...(data ?? {}), fetched: events.length });
  } catch (e) {
    return json({ ok: false, message: e instanceof Error ? e.message : "Calendar sync failed." }, 500);
  }
});
