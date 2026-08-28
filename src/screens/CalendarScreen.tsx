import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Archive,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  MailCheck,
  MapPin,
  Music,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { syncGoogleCalendarEvents } from "../lib/calendarSync";
import {
  getCachedEvents,
  setCachedEvents,
  isEventsStale,
  getCachedPersonalEvents,
  setCachedPersonalEvents,
  isPersonalStale,
  invalidateEventsCache,
  invalidatePersonalCache,
} from "../lib/eventCache";
import type {
  AttendanceRequirement,
  CheckinMode,
  EventRow,
  PersonalEventRow,
  Profile,
} from "../lib/types";
import {
  addMonths,
  fmtDateTime,
  fmtMonthYear,
  googleCalendarUrl,
  isSameDay,
  monthMatrix,
  relativeDay,
  startOfDay,
} from "../lib/date";
import {
  ATTENDANCE_REQUIREMENT_CHIP,
  ATTENDANCE_REQUIREMENT_LABEL,
  EVENT_TYPES,
  getEventTypeChip,
  getEventTypeLabel,
} from "../lib/constants";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  cn,
} from "../components/ui";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Default check-in mode for an event type. */
function defaultCheckinMode(type: string): CheckinMode {
  const t = type.toLowerCase();
  if (["rehearsal", "game", "concert", "competition", "performance"].includes(t))
    return "qr";
  if (["section meeting", "band meeting", "general meeting"].includes(t))
    return "toggle";
  return "toggle";
}

/** Surface the real error message a Supabase Edge Function returns. */
async function functionsErrorMessage(e: unknown): Promise<string> {
  if (e instanceof FunctionsHttpError) {
    try {
      const body = (await e.context.json()) as { message?: string } | null;
      if (body?.message) return body.message;
    } catch {
      // Not a JSON body — fall through to the generic message below.
    }
  }
  return e instanceof Error ? e.message : "Couldn't send the reminder.";
}

function PersonalEventCard({
  event,
  onDelete,
  deleting,
}: {
  event: PersonalEventRow;
  onDelete: (event: PersonalEventRow) => void;
  deleting?: boolean;
}) {
  return (
    <Card className="p-4 ring-1 ring-sky-200 dark:ring-sky-900">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
          <CalendarDays className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-ink dark:text-zinc-100">
              {event.name}
            </p>
            <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
              Personal
            </Badge>
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Clock className="size-3.5" /> {fmtDateTime(event.date)}
          </p>
          {event.location && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <MapPin className="size-3.5" /> {event.location}
            </p>
          )}
        </div>
      </div>
      <a
        href={googleCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3 text-xs font-semibold text-sky-600 transition-colors hover:bg-sky-50 dark:border-white/15 dark:text-sky-400 dark:hover:bg-sky-950/40"
      >
        <CalendarPlus className="size-4" /> Add to Google Calendar
      </a>
      <Button
        size="sm"
        variant="outline"
        className="mt-2 w-full text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        loading={deleting}
        onClick={() => onDelete(event)}
      >
        <Trash2 className="size-4" /> Remove
      </Button>
    </Card>
  );
}

function EventCard({
  event,
  onEdit,
  onDelete,
  onArchive,
  onRemind,
  reminding,
}: {
  event: EventRow;
  onEdit?: (event: EventRow) => void;
  onDelete?: (event: EventRow) => void;
  onArchive?: (event: EventRow) => void;
  onRemind?: (event: EventRow) => void;
  reminding?: boolean;
}) {
  const typeLabel = getEventTypeLabel(event.event_type || event.type);
  const typeChip = getEventTypeChip(event.event_type || event.type);
  const isGoogle = event.event_source === "google_calendar" || !!event.google_calendar_uid;

  return (
    <Card className={cn("p-4", event.archived && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl",
            typeChip
          )}
        >
          <Music className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-ink dark:text-zinc-100">
              {event.name}
            </p>
            <Badge className={typeChip}>{typeLabel}</Badge>
            {event.archived && (
              <Badge className="bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                <Archive className="size-3" /> Archived
              </Badge>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Clock className="size-3.5" /> {fmtDateTime(event.date)}
          </p>
          {event.location && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <MapPin className="size-3.5" /> {event.location}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {event.attendance_requirement && (
              <Badge className={ATTENDANCE_REQUIREMENT_CHIP[event.attendance_requirement]}>
                {ATTENDANCE_REQUIREMENT_LABEL[event.attendance_requirement]}
              </Badge>
            )}
            {isGoogle && (
              <Badge className="bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
                <Cloud className="size-3" /> Google Calendar
              </Badge>
            )}
            {!isGoogle && event.event_source === "manual" && (
              <Badge className="bg-green-50 text-green-600 dark:bg-green-950/60 dark:text-green-300">
                Created in Band App
              </Badge>
            )}
          </div>
        </div>
      </div>
      <a
        href={googleCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3 text-xs font-semibold text-forest transition-colors hover:bg-moss dark:border-white/15 dark:text-moss dark:hover:bg-forest/40"
      >
        <CalendarPlus className="size-4" /> Add to Google Calendar
      </a>
      {onEdit && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={() => onEdit(event)}
        >
          <Pencil className="size-4" /> Edit
        </Button>
      )}
      {onDelete && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          onClick={() => onDelete(event)}
        >
          <Trash2 className="size-4" /> Delete
        </Button>
      )}
      {onArchive && !event.archived && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={() => onArchive(event)}
        >
          <Archive className="size-4" /> Archive
        </Button>
      )}
      {onRemind && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          loading={reminding}
          onClick={() => onRemind(event)}
        >
          <MailCheck className="size-4" /> Remind absent members
        </Button>
      )}
    </Card>
  );
}

export default function CalendarScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const canAdd =
    profile.roles.includes("director") || profile.roles.includes("secretary");
  const isDirector = profile.roles.includes("director");

  const now = new Date();
  const [cursor, setCursor] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [selected, setSelected] = useState<Date>(startOfDay(now));
  const [events, setEvents] = useState<EventRow[]>(() => getCachedEvents());
  const [personalEvents, setPersonalEvents] = useState<PersonalEventRow[]>(
    () => getCachedPersonalEvents(profile.id)
  );
  const [loading, setLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);

  // add/edit-event form (band events)
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("Rehearsal");
  const [checkinMode, setCheckinMode] = useState<CheckinMode>("qr");
  const [attendanceReq, setAttendanceReq] = useState<AttendanceRequirement>("required");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [lateMinutes, setLateMinutes] = useState(10);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // personal-event form
  const [showAddPersonal, setShowAddPersonal] = useState(false);
  const [pName, setPName] = useState("");
  const [pDate, setPDate] = useState("");
  const [pLocation, setPLocation] = useState("");
  const [pSaving, setPSaving] = useState(false);
  const [pFormError, setPFormError] = useState<string | null>(null);
  const [deletingPersonalId, setDeletingPersonalId] = useState<string | null>(
    null
  );

  // director: email reminders
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function loadEvents(showSpinner = false) {
    if (showSpinner) setLoading(true);
    const needBand = isEventsStale();
    const needPersonal = isPersonalStale(profile.id);

    // Only sync Google Calendar when band events are stale
    if (needBand) await syncGoogleCalendarEvents();

    const [band, personal] = await Promise.all([
      needBand
        ? supabase.from("events").select("*").order("date", { ascending: true })
        : Promise.resolve({ data: null }),
      needPersonal
        ? supabase
            .from("personal_events")
            .select("*")
            .eq("owner_id", profile.id)
            .order("date", { ascending: true })
        : Promise.resolve({ data: null }),
    ]);

    if (band.data) {
      setEvents(band.data);
      setCachedEvents(band.data);
    }
    if (personal.data) {
      setPersonalEvents(personal.data);
      setCachedPersonalEvents(profile.id, personal.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    // Load immediately from cache (instant); refresh in background if stale.
    void loadEvents(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const matrix = useMemo(
    () => monthMatrix(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const ev of events) {
      const key = startOfDay(new Date(ev.date)).toDateString();
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const personalByDay = useMemo(() => {
    const map = new Map<string, PersonalEventRow[]>();
    for (const ev of personalEvents) {
      const key = startOfDay(new Date(ev.date)).toDateString();
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [personalEvents]);

  const dayEvents = useMemo(
    () =>
      (byDay.get(selected.toDateString()) ?? []).sort(
        (a, b) => +new Date(a.date) - +new Date(b.date)
      ),
    [byDay, selected]
  );

  const dayPersonal = useMemo(
    () =>
      (personalByDay.get(selected.toDateString()) ?? []).sort(
        (a, b) => +new Date(a.date) - +new Date(b.date)
      ),
    [personalByDay, selected]
  );

  async function submitEvent(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !date) {
      setFormError("Give the event a name and a date.");
      return;
    }
    setSaving(true);
    const typeKey = eventType.toLowerCase();
    const payload = {
      name: name.trim(),
      type: typeKey,
      event_type: eventType,
      checkin_mode: checkinMode,
      attendance_requirement: attendanceReq,
      date: new Date(date).toISOString(),
      end_date: endDate ? new Date(endDate).toISOString() : null,
      location: location.trim(),
      description: description.trim(),
      late_minutes: lateMinutes,
      event_source: editingEvent?.event_source ?? "manual",
    };
    const { error } = editingEvent
      ? await supabase
          .from("events")
          .update(payload)
          .eq("id", editingEvent.id)
      : await supabase
          .from("events")
          .insert({ ...payload, created_by: profile.id });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setShowEventForm(false);
    setEditingEvent(null);
    resetForm();
    // Force refresh after mutation
    invalidateEventsCache();
    invalidatePersonalCache(profile.id);
    void loadEvents(false);
  }

  function resetForm() {
    setName("");
    setEventType("Rehearsal");
    setCheckinMode("qr");
    setAttendanceReq("required");
    setDate("");
    setEndDate("");
    setLocation("");
    setDescription("");
    setLateMinutes(10);
  }

  async function remind(event: EventRow) {
    setRemindMsg(null);
    setRemindingId(event.id);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send_signup_reminder",
        { body: { event_id: event.id } }
      );
      if (error) throw error;
      const res = data as {
        ok?: boolean;
        message?: string;
      } | null;
      setRemindMsg({
        tone: res?.ok ? "success" : "error",
        text:
          res?.message ??
          (res?.ok ? "Reminder sent." : "Couldn't send the reminder."),
      });
    } catch (e) {
      setRemindMsg({
        tone: "error",
        text: await functionsErrorMessage(e),
      });
    } finally {
      setRemindingId(null);
    }
  }

  /** Director-only: delete a band event (with safety checks). */
  async function deleteEvent(event: EventRow) {
    const message = event.google_calendar_uid
      ? `Delete "${event.name}"? It syncs from Google Calendar, so it will come back on the next sync — remove it in Google Calendar if you want it gone permanently.`
      : `Delete "${event.name}" from the calendar? This can't be undone.`;
    if (!window.confirm(message)) return;
    setActionError(null);
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", event.id);
    if (error) {
      setActionError(error.message);
      return;
    }
    invalidateEventsCache();
    void loadEvents(false);
  }

  /** Director: archive an event instead of deleting it. */
  async function archiveEvent(event: EventRow) {
    if (!window.confirm(`Archive "${event.name}"? It will be hidden from active views but attendance history is preserved.`)) return;
    setActionError(null);
    const { error } = await supabase
      .from("events")
      .update({ archived: true })
      .eq("id", event.id);
    if (error) {
      setActionError(error.message);
      return;
    }
    invalidateEventsCache();
    void loadEvents(false);
  }

  function openAdd() {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    setDate(
      `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(
        tomorrow.getDate()
      )}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`
    );
    setCheckinMode(defaultCheckinMode("Rehearsal"));
    setFormError(null);
    setEditingEvent(null);
    resetForm();
    setShowEventForm(true);
  }

  /** Staff: populate the form from an existing event. */
  function openEdit(event: EventRow) {
    const d = new Date(event.date);
    const pad = (n: number) => String(n).padStart(2, "0");
    setName(event.name);
    setEventType(event.event_type || event.type || "Rehearsal");
    setCheckinMode(event.checkin_mode);
    setAttendanceReq(event.attendance_requirement || "required");
    setDate(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`
    );
    if (event.end_date) {
      const ed = new Date(event.end_date);
      setEndDate(
        `${ed.getFullYear()}-${pad(ed.getMonth() + 1)}-${pad(ed.getDate())}T${pad(
          ed.getHours()
        )}:${pad(ed.getMinutes())}`
      );
    } else {
      setEndDate("");
    }
    setLocation(event.location);
    setDescription(event.description);
    setLateMinutes(event.late_minutes ?? 10);
    setFormError(null);
    setEditingEvent(event);
    setShowEventForm(true);
  }

  function openAddPersonal() {
    const pad = (n: number) => String(n).padStart(2, "0");
    setPDate(
      `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(
        selected.getDate()
      )}T18:00`
    );
    setPFormError(null);
    setShowAddPersonal(true);
  }

  async function submitPersonal(e: React.FormEvent) {
    e.preventDefault();
    setPFormError(null);
    if (!pName.trim() || !pDate) {
      setPFormError("Give your event a name and a date.");
      return;
    }
    setPSaving(true);
    const { error } = await supabase.from("personal_events").insert({
      owner_id: profile.id,
      name: pName.trim(),
      date: new Date(pDate).toISOString(),
      location: pLocation.trim(),
    });
    setPSaving(false);
    if (error) {
      setPFormError(error.message);
      return;
    }
    setShowAddPersonal(false);
    setPName("");
    setPDate("");
    setPLocation("");
    invalidatePersonalCache(profile.id);
    void loadEvents(false);
  }

  async function deletePersonal(ev: PersonalEventRow) {
    if (
      !window.confirm(
        `Remove "${ev.name}" from your calendar? This only deletes your personal event.`
      )
    )
      return;
    setDeletingPersonalId(ev.id);
    const { error } = await supabase
      .from("personal_events")
      .delete()
      .eq("id", ev.id);
    setDeletingPersonalId(null);
    if (!error) {
      invalidatePersonalCache(profile.id);
      void loadEvents(false);
    }
  }

  return (
    <div className="px-4 pb-6 pt-5">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-ink dark:text-zinc-100">
            Calendar
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {profile.display_name || profile.full_name} ·{" "}
            {profile.instrument || "Staff"}
          </p>
        </div>
        {canAdd && (
          <Button size="sm" onClick={openAdd}>
            <Plus className="size-4" /> Add event
          </Button>
        )}
      </div>

      {/* month card */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink dark:text-zinc-100">
            {fmtMonthYear(cursor.getFullYear(), cursor.getMonth())}
          </h2>
          <div className="flex gap-1">
            <button
              onClick={() => setCursor(addMonths(cursor, -1))}
              className="rounded-full p-2 text-zinc-500 hover:bg-moss dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setCursor(addMonths(cursor, 1))}
              className="rounded-full p-2 text-zinc-500 hover:bg-moss dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-center">
          {WEEKDAYS.map((w, i) => (
            <div
              key={i}
              className="py-1 text-[11px] font-bold uppercase text-zinc-400"
            >
              {w}
            </div>
          ))}
          {matrix.flat().map((day, i) => {
            if (!day) return <div key={i} />;
            const has =
              (byDay.get(day.toDateString())?.length ?? 0) > 0 ||
              (personalByDay.get(day.toDateString())?.length ?? 0) > 0;
            const isSelected = isSameDay(day, selected);
            const isToday = isSameDay(day, now);
            return (
              <button
                key={i}
                onClick={() => setSelected(startOfDay(day))}
                className="flex flex-col items-center gap-1 py-1.5"
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                    isSelected
                      ? "bg-forest text-white dark:bg-mid"
                      : isToday
                        ? "text-forest ring-1 ring-forest dark:text-gold dark:ring-gold"
                        : "text-ink dark:text-zinc-200"
                  )}
                >
                  {day.getDate()}
                </span>
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    has
                      ? isSelected
                        ? "bg-gold"
                        : "bg-gold"
                      : "bg-transparent"
                  )}
                />
              </button>
            );
          })}
        </div>
      </Card>

      {/* selected day events */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">
            {relativeDay(selected.toISOString())}
          </p>
          <button
            onClick={openAddPersonal}
            className="text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
          >
            + Add personal event
          </button>
        </div>
        {loading ? (
          <div className="space-y-2">
            <div className="h-20 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-20 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ) : dayEvents.length === 0 && dayPersonal.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-6" />}
            title="No events this day"
            subtitle={
              canAdd
                ? "Band events sync from Google Calendar. Add a personal one here if you need it."
                : "Add a personal event to keep this day on your calendar."
            }
          />
        ) : (
          <>
            {remindMsg && (
              <Alert tone={remindMsg.tone} className="mb-3">
                {remindMsg.text}
              </Alert>
            )}
            {actionError && (
              <Alert tone="error" className="mb-3">
                {actionError}
              </Alert>
            )}
            <div className="space-y-2">
              {dayPersonal.map((ev) => (
                <PersonalEventCard
                  key={ev.id}
                  event={ev}
                  onDelete={deletePersonal}
                  deleting={deletingPersonalId === ev.id}
                />
              ))}
              {dayEvents.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  onEdit={canAdd ? (e) => openEdit(e) : undefined}
                  onDelete={isDirector ? (e) => void deleteEvent(e) : undefined}
                  onArchive={isDirector ? (e) => void archiveEvent(e) : undefined}
                  onRemind={isDirector ? remind : undefined}
                  reminding={remindingId === ev.id}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* add / edit event modal */}
      <Modal
        open={showEventForm}
        onClose={() => {
          setShowEventForm(false);
          setEditingEvent(null);
        }}
        title={editingEvent ? "Edit event" : "Add event"}
      >
        <form onSubmit={submitEvent} className="space-y-4">
          {editingEvent?.google_calendar_uid && (
            <Alert tone="info">
              This event syncs from Google Calendar — name, type, date and
              location changes will be overwritten by the next sync. Check-in
              method and attendance settings stick.
            </Alert>
          )}
          <Field label="Event name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Homecoming Game"
            />
          </Field>
          <Field label="Event type">
            <Select
              value={eventType}
              onChange={(e) => {
                setEventType(e.target.value);
                setCheckinMode(defaultCheckinMode(e.target.value));
              }}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Attendance"
            hint="Whether students are expected to check in."
          >
            <div className="grid grid-cols-3 gap-2">
              {(["required", "optional", "none"] as AttendanceRequirement[]).map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => {
                    setAttendanceReq(r);
                    if (r === "none") setCheckinMode("none");
                  }}
                  className={cn(
                    "min-h-10 rounded-xl text-xs font-semibold transition-colors",
                    attendanceReq === r
                      ? ATTENDANCE_REQUIREMENT_CHIP[r]
                      : "bg-cream text-zinc-500 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10"
                  )}
                >
                  {ATTENDANCE_REQUIREMENT_LABEL[r]}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label="Check-in method"
            hint="How attendance is collected."
          >
            <div className="grid grid-cols-2 gap-2">
              {(["qr", "toggle", "both", "none"] as CheckinMode[]).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setCheckinMode(m)}
                  className={cn(
                    "min-h-10 rounded-xl text-xs font-semibold transition-colors",
                    checkinMode === m
                      ? m === "qr"
                        ? "bg-forest text-white dark:bg-mid"
                        : "bg-gold text-ink dark:bg-gold/80"
                      : "bg-cream text-zinc-500 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10"
                  )}
                >
                  {m === "qr"
                    ? "QR code"
                    : m === "toggle"
                      ? "Toggle"
                      : m === "both"
                        ? "Both"
                        : "None"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Date & time">
            <Input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="End time (optional)">
            <Input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="RHS Stadium"
            />
          </Field>
          <Field label="Description (optional)">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional details..."
            />
          </Field>
          <Field label="Late after (minutes)" hint="Grace period before a check-in is marked late.">
            <Input
              type="number"
              min={0}
              max={60}
              value={lateMinutes}
              onChange={(e) => setLateMinutes(Number(e.target.value))}
            />
          </Field>
          {formError && <Alert tone="error">{formError}</Alert>}
          <Button type="submit" size="lg" loading={saving} className="w-full">
            {editingEvent ? "Save changes" : "Save event"}
          </Button>
        </form>
      </Modal>

      {/* add personal event modal */}
      <Modal
        open={showAddPersonal}
        onClose={() => setShowAddPersonal(false)}
        title="Add personal event"
      >
        <form onSubmit={submitPersonal} className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Personal events are private — only you can see them on the
            calendar.
          </p>
          <Field label="Event name">
            <Input
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              placeholder="e.g. Section practice, study session"
              autoFocus
            />
          </Field>
          <Field label="Date & time">
            <Input
              type="datetime-local"
              value={pDate}
              onChange={(e) => setPDate(e.target.value)}
            />
          </Field>
          <Field label="Location (optional)">
            <Input
              value={pLocation}
              onChange={(e) => setPLocation(e.target.value)}
              placeholder="e.g. Band Room"
            />
          </Field>
          {pFormError && <Alert tone="error">{pFormError}</Alert>}
          <Button type="submit" size="lg" loading={pSaving} className="w-full">
            Save personal event
          </Button>
        </form>
      </Modal>
    </div>
  );
}
