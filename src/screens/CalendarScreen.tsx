import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  MailCheck,
  MapPin,
  Music,
  Plus,
  Trash2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type {
  EventRow,
  EventType,
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
import { EVENT_TYPE_CHIP, EVENT_TYPE_LABEL } from "../lib/constants";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  cn,
} from "../components/ui";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

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
  onRemind,
  reminding,
}: {
  event: EventRow;
  onRemind?: (event: EventRow) => void;
  reminding?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl",
            EVENT_TYPE_CHIP[event.type]
          )}
        >
          <Music className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-ink dark:text-zinc-100">
              {event.name}
            </p>
            <Badge className={EVENT_TYPE_CHIP[event.type]}>
              {EVENT_TYPE_LABEL[event.type]}
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
        className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3 text-xs font-semibold text-forest transition-colors hover:bg-moss dark:border-white/15 dark:text-moss dark:hover:bg-forest/40"
      >
        <CalendarPlus className="size-4" /> Add to Google Calendar
      </a>
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
  // Only directors and secretaries add band events; everyone adds personal ones.
  const canAdd =
    profile.role === "director" || profile.role === "secretary";
  const isDirector = profile.role === "director";

  const now = new Date();
  const [cursor, setCursor] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [selected, setSelected] = useState<Date>(startOfDay(now));
  const [events, setEvents] = useState<EventRow[]>([]);
  const [personalEvents, setPersonalEvents] = useState<PersonalEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // add-event form (band events)
  const [name, setName] = useState("");
  const [type, setType] = useState<EventType>("rehearsal");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
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

  // director: email reminders for absent members
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function loadEvents() {
    setLoading(true);
    const [band, personal] = await Promise.all([
      supabase.from("events").select("*").order("date", { ascending: true }),
      supabase
        .from("personal_events")
        .select("*")
        .eq("owner_id", profile.id)
        .order("date", { ascending: true }),
    ]);
    setEvents((band.data as EventRow[]) ?? []);
    setPersonalEvents((personal.data as PersonalEventRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadEvents();
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
    const { error } = await supabase.from("events").insert({
      name: name.trim(),
      type,
      date: new Date(date).toISOString(),
      location: location.trim(),
      created_by: profile.id,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setShowAdd(false);
    setName("");
    setType("rehearsal");
    setDate("");
    setLocation("");
    void loadEvents();
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
        text: e instanceof Error ? e.message : "Couldn't send the reminder.",
      });
    } finally {
      setRemindingId(null);
    }
  }

  function openAdd() {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    setDate(
      `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(
        tomorrow.getDate()
      )}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`
    );
    setShowAdd(true);
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
    void loadEvents();
  }

  async function deletePersonal(ev: PersonalEventRow) {
    if (
      !window.confirm(
        `Remove “${ev.name}” from your calendar? This only deletes your personal event.`
      )
    )
      return;
    setDeletingPersonalId(ev.id);
    const { error } = await supabase
      .from("personal_events")
      .delete()
      .eq("id", ev.id);
    setDeletingPersonalId(null);
    if (!error) void loadEvents();
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
                ? "Tap “Add event” to schedule a band event, or add a personal one."
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
                  onRemind={isDirector ? remind : undefined}
                  reminding={remindingId === ev.id}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* add event modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add event"
      >
        <form onSubmit={submitEvent} className="space-y-4">
          <Field label="Event name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Homecoming Game"
            />
          </Field>
          <Field label="Type">
            <div className="grid grid-cols-3 gap-2">
              {(["rehearsal", "game", "concert"] as EventType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    "min-h-10 rounded-xl text-xs font-semibold transition-colors",
                    type === t
                      ? EVENT_TYPE_CHIP[t]
                      : "bg-cream text-zinc-500 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10"
                  )}
                >
                  {EVENT_TYPE_LABEL[t]}
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
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="RHS Stadium"
            />
          </Field>
          {formError && <Alert tone="error">{formError}</Alert>}
          <Button type="submit" size="lg" loading={saving} className="w-full">
            Save event
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