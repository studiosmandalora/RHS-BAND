/**
 * In-memory event cache.
 *
 * Stores band events and per-user personal events so that switching between
 * screens (Calendar → Check-In → Attendance, etc.) doesn't trigger a full
 * refetch. Data loads instantly from cache; a background refresh keeps it
 * fresh.
 */

import type { EventRow, PersonalEventRow } from "./types";

// ---------------------------------------------------------------------------
// Band events (shared across all users)
// ---------------------------------------------------------------------------
let _events: EventRow[] = [];
let _eventsFetchedAt = 0;

const STALE_MS = 60_000; // 1 minute — short enough to stay fresh

export function getCachedEvents(): EventRow[] {
  return _events;
}

export function setCachedEvents(events: EventRow[]): void {
  _events = events;
  _eventsFetchedAt = Date.now();
}

export function isEventsStale(): boolean {
  return Date.now() - _eventsFetchedAt > STALE_MS;
}

// ---------------------------------------------------------------------------
// Personal events (per-user)
// ---------------------------------------------------------------------------
const _personalByUser = new Map<string, PersonalEventRow[]>();
const _personalFetchedAt = new Map<string, number>();

export function getCachedPersonalEvents(ownerId: string): PersonalEventRow[] {
  return _personalByUser.get(ownerId) ?? [];
}

export function setCachedPersonalEvents(
  ownerId: string,
  events: PersonalEventRow[],
): void {
  _personalByUser.set(ownerId, events);
  _personalFetchedAt.set(ownerId, Date.now());
}

export function isPersonalStale(ownerId: string): boolean {
  const t = _personalFetchedAt.get(ownerId) ?? 0;
  return Date.now() - t > STALE_MS;
}

// ---------------------------------------------------------------------------
// Clear cache (e.g. on sign-out)
// ---------------------------------------------------------------------------
export function clearEventCache(): void {
  _events = [];
  _eventsFetchedAt = 0;
  _personalByUser.clear();
  _personalFetchedAt.clear();
}

// ---------------------------------------------------------------------------
// Force invalidation (after mutations)
// ---------------------------------------------------------------------------
export function invalidateEventsCache(): void {
  _eventsFetchedAt = 0;
}

export function invalidatePersonalCache(ownerId: string): void {
  _personalFetchedAt.set(ownerId, 0);
}
