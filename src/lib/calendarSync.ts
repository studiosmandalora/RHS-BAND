import { supabase } from "./supabase";

// Bumped when the source calendar changes so all clients re-sync on next load.
const SYNC_CACHE_KEY = "rhs-band-google-calendar-sync-at-v2";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Best-effort refresh from the public Google Calendar ICS feed. The Edge
 * Function uses the service role to replace/upsert band events safely.
 */
export async function syncGoogleCalendarEvents(force = false): Promise<void> {
  if (!force) {
    const last = Number(window.localStorage.getItem(SYNC_CACHE_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < SYNC_INTERVAL_MS) return;
  }

  const { error } = await supabase.functions.invoke("sync_google_calendar", {
    body: {},
  });
  if (error) {
    console.warn("Google Calendar sync failed", error.message);
    return;
  }
  window.localStorage.setItem(SYNC_CACHE_KEY, String(Date.now()));
}