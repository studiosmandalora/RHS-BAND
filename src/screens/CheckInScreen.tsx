import { useEffect, useMemo, useRef, useState } from "react";
import {
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router-dom";
import type { Html5Qrcode } from "html5-qrcode";
import { QRCodeSVG } from "qrcode.react";
import {
  Ban,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Keyboard,
  Layers,
  ListChecks,
  MapPin,
  Music,
  QrCode,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { syncGoogleCalendarEvents } from "../lib/calendarSync";
import {
  getCachedEvents,
  setCachedEvents,
  isEventsStale,
} from "../lib/eventCache";
import {
  overrideAttendance,
  recordAttendance,
  recordAttendanceByCode,
  startCheckinSession,
} from "../lib/rpc";
import type {
  AttendanceRow,
  CheckinMode,
  EventRow,
  Profile,
} from "../lib/types";
import { fmtTime, parseTokenFromString } from "../lib/date";
import {
  EXCUSE_REASONS,
  getEventTypeChip,
  getEventTypeLabel,
} from "../lib/constants";
import { Alert, Badge, Button, Card, Modal, Select, cn } from "../components/ui";
import { Avatar } from "../components/Avatar";

interface ActiveSession {
  token: string;
  entry_code?: string;
  expires_at: string;
  event_id: string;
}

export default function CheckInScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const navigate = useNavigate();
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (navTimer.current) clearTimeout(navTimer.current);
    };
  }, []);

  const isStaff =
    profile.roles.includes("director") ||
    profile.roles.includes("secretary") ||
    profile.roles.includes("section_leader");
  const isCheckinManager =
    profile.roles.includes("director") || profile.roles.includes("secretary");

  const [upcomingEvents, setUpcomingEvents] = useState<EventRow[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [myRecord, setMyRecord] = useState<AttendanceRow | null>(null);

  // staff: QR generation
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [generating, setGenerating] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [liveCheckins, setLiveCheckins] = useState<AttendanceRow[]>([]);
  const [roster, setRoster] = useState<Record<string, Profile>>({});

  // student: scanner
  const [scanOpen, setScanOpen] = useState(false);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [scanState, setScanState] = useState<
    "scanning" | "processing" | "success" | "error"
  >("scanning");
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  // student: manual code fallback
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualState, setManualState] = useState<
    "idle" | "processing" | "success" | "error"
  >("idle");
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  // staff: excused modal
  const [excusedModal, setExcusedModal] = useState<{
    studentId: string;
    studentName: string;
  } | null>(null);
  const [excuseReason, setExcuseReason] = useState("Sick");
  const [excuseNote, setExcuseNote] = useState("");
  const [excusing, setExcusing] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlToken = searchParams.get("token");

  /* ------------------------- upcoming events ----------------------------- */
  useEffect(() => {
    let cancelled = false;

    function filterUpcoming(allEvents: EventRow[]): EventRow[] {
      return allEvents
        .filter((e) => {
          if (e.archived) return false;
          const end = e.end_date
            ? new Date(e.end_date).getTime()
            : new Date(e.date).getTime() + 24 * 60 * 60 * 1000;
          return end > Date.now();
        })
        .sort((a, b) => +new Date(a.date) - +new Date(b.date))
        .slice(0, 20);
    }

    // Show cached data immediately
    const cached = getCachedEvents();
    if (cached.length > 0) {
      const rows = filterUpcoming(cached);
      setUpcomingEvents(rows);
      setSelectedEvent((prev) => {
        if (prev && rows.some((e) => e.id === prev.id)) return prev;
        return rows[0] ?? null;
      });
    }

    // Refresh in background if stale
    if (isEventsStale()) {
      void syncGoogleCalendarEvents().finally(() => {
        supabase
          .from("events")
          .select("*")
          .order("date", { ascending: true })
          .then(({ data }) => {
            if (cancelled) return;
            const allRows = (data as EventRow[]) ?? [];
            setCachedEvents(allRows);
            const rows = filterUpcoming(allRows);
            setUpcomingEvents(rows);
            setSelectedEvent((prev) => {
              if (prev && rows.some((e) => e.id === prev.id)) return prev;
              return rows[0] ?? null;
            });
          });
      });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------------------- my attendance ----------------------------- */
  async function refreshMyRecord(eventId?: string) {
    const evId = eventId ?? selectedEvent?.id;
    if (!evId) return;
    const { data } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("event_id", evId)
      .eq("student_id", profile.id)
      .maybeSingle<AttendanceRow>();
    setMyRecord((data as AttendanceRow) ?? null);
  }

  useEffect(() => {
    if (selectedEvent) void refreshMyRecord(selectedEvent.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id]);

  function selectEvent(ev: EventRow) {
    setSelectedEvent(ev);
    setStaffError(null);
    setSession((s) => (s && s.event_id !== ev.id ? null : s));
    if (!isStaff) void refreshMyRecord(ev.id);
  }

  /* ------------------------ staff: live check-ins ------------------------ */
  useEffect(() => {
    if (!isStaff || !selectedEvent) return;
    let cancelled = false;
    supabase
      .from("attendance_records")
      .select("*")
      .eq("event_id", selectedEvent.id)
      .then(({ data }) => {
        if (!cancelled) setLiveCheckins((data as AttendanceRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [isStaff, selectedEvent?.id]);

  useEffect(() => {
    if (!isStaff || !selectedEvent) return;
    const channel = supabase
      .channel(`checkins-${selectedEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance_records",
          filter: `event_id=eq.${selectedEvent.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setLiveCheckins((prev) => [
              ...prev.filter((r) => r.student_id !== (payload.new as AttendanceRow).student_id),
              payload.new as AttendanceRow,
            ]);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as AttendanceRow;
            setLiveCheckins((prev) =>
              prev.some((r) => r.id === updated.id)
                ? prev.map((r) => (r.id === updated.id ? updated : r))
                : [...prev, updated]
            );
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as AttendanceRow;
            setLiveCheckins((prev) => prev.filter((r) => r.id !== old.id));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isStaff, selectedEvent?.id]);

  /* --------------------- staff: roster for names ------------------------- */
  useEffect(() => {
    if (!isStaff) return;
    supabase.from("profiles").select("*").then(({ data }) => {
      const map: Record<string, Profile> = {};
      for (const p of (data as Profile[]) ?? []) map[p.id] = p;
      setRoster(map);
    });
  }, [isStaff]);

  const relevantMembers = useMemo(() => {
    const list = Object.values(roster).filter(
      (p) => p.roles.includes("student") || p.roles.includes("section_leader")
    );
    if (profile.roles.includes("section_leader")) {
      return list.filter((p) => p.instrument === profile.instrument);
    }
    return list;
  }, [roster, profile.roles, profile.instrument]);

  const checkedInIds = useMemo(
    () => new Set(liveCheckins.map((r) => r.student_id)),
    [liveCheckins]
  );

  /* --------------------------- countdown clock --------------------------- */
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [session]);

  const secondsLeft = session
    ? Math.max(0, Math.ceil((new Date(session.expires_at).getTime() - nowMs) / 1000))
    : 0;
  const expired = session !== null && secondsLeft <= 0;

  /* ------------------------------ generate ------------------------------- */
  async function generate() {
    if (!selectedEvent) return;
    setGenerating(true);
    setStaffError(null);
    const { result, error } = await startCheckinSession(selectedEvent.id);
    setGenerating(false);
    if (error || !result?.ok) {
      setStaffError(error?.message ?? result?.message ?? "Could not generate a code.");
      return;
    }
    setNowMs(Date.now());
    setSession({
      token: result.token!,
      entry_code: result.entry_code,
      expires_at: result.expires_at!,
      event_id: selectedEvent.id,
    });
  }

  async function setCheckinMode(mode: CheckinMode) {
    if (!selectedEvent || selectedEvent.checkin_mode === mode) return;
    if (mode === "toggle") setSession(null);
    setSelectedEvent({ ...selectedEvent, checkin_mode: mode });
    setStaffError(null);
    const { error } = await supabase
      .from("events")
      .update({ checkin_mode: mode })
      .eq("id", selectedEvent.id);
    if (error) setStaffError(error.message);
  }

  /** Mark a student as excused. */
  async function markExcused() {
    if (!excusedModal || !selectedEvent) return;
    setExcusing(true);
    const { result, error } = await overrideAttendance(
      selectedEvent.id,
      excusedModal.studentId,
      "excused",
      excuseReason,
      excuseNote
    );
    setExcusing(false);
    if (error || !result?.ok) {
      setStaffError(error?.message ?? result?.message ?? "Could not mark excused.");
      return;
    }
    // Refresh check-in list
    const { data } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("event_id", selectedEvent.id);
    setLiveCheckins((data as AttendanceRow[]) ?? []);
    setExcusedModal(null);
    setExcuseReason("Sick");
    setExcuseNote("");
  }

  /** Toggle mode: staff mark a member present/absent on the spot. */
  async function toggleAttendance(memberId: string, currentlyAttended: boolean) {
    if (!selectedEvent) return;
    const next = !currentlyAttended;
    setStaffError(null);
    setLiveCheckins((prev) =>
      next
        ? [
            ...prev.filter((r) => r.student_id !== memberId),
            {
              id: `tmp-${memberId}`,
              event_id: selectedEvent.id,
              student_id: memberId,
              attended: true,
              checked_in_at: new Date().toISOString(),
              status: "present" as const,
              excuse_reason: "",
              staff_note: "",
              is_late: false,
              marked_by: null,
            } as AttendanceRow,
          ]
        : prev.filter((r) => r.student_id !== memberId)
    );
    const { result, error } = await overrideAttendance(
      selectedEvent.id,
      memberId,
      next
    );
    if (error || !result?.ok) {
      setStaffError(
        error?.message ?? result?.message ?? "Could not update attendance."
      );
      const { data } = await supabase
        .from("attendance_records")
        .select("*")
        .eq("event_id", selectedEvent.id);
      setLiveCheckins((data as AttendanceRow[]) ?? []);
    }
  }

  const qrUrl = session
    ? `${window.location.origin}/checkin?token=${encodeURIComponent(session.token)}`
    : "";

  /* ------------------------- deep-link token ----------------------------- */
  async function handleToken(token: string) {
    setScanMessage(null);
    setScanState("processing");
    const { result, error } = await recordAttendance(token);
    setSearchParams({}, { replace: true });
    if (error || !result?.ok) {
      setScanState("error");
      setScanMessage(error?.message ?? result?.message ?? "That code didn't work.");
      return;
    }
    setScanState("success");
    const lateMsg = result.is_late ? " (late)" : "";
    setScanMessage(
      `${result.event_name} · checked in${lateMsg} at ${result.checked_in_at ? fmtTime(result.checked_in_at) : ""}`
    );
    const ev = upcomingEvents.find((e) => e.id === result.event_id);
    if (ev) setSelectedEvent(ev);
    void refreshMyRecord(result.event_id);
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => navigate("/attendance"), 1200);
  }

  /* ---------------------- manual code entry ------------------------------ */
  async function submitManualCode(e: React.FormEvent) {
    e.preventDefault();
    const code = manualCode.trim().toUpperCase();
    if (code.length < 6 || code.length > 8) {
      setManualState("error");
      setManualMessage("Codes are 6–8 characters — check it and try again.");
      return;
    }
    setManualState("processing");
    setManualMessage(null);
    const { result, error } = await recordAttendanceByCode(code);
    if (error || !result?.ok) {
      setManualState("error");
      setManualMessage(
        error?.message ?? result?.message ?? "That code didn't work."
      );
      return;
    }
    setManualState("success");
    const lateMsg = result.is_late ? " (late)" : "";
    setManualMessage(
      `${result.event_name} · checked in${lateMsg} at ${result.checked_in_at ? fmtTime(result.checked_in_at) : ""}`
    );
    const ev = upcomingEvents.find((e) => e.id === result.event_id);
    if (ev) setSelectedEvent(ev);
    void refreshMyRecord(result.event_id);
  }

  useEffect(() => {
    if (urlToken && profile) {
      void handleToken(urlToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlToken, profile?.id]);

  /* ------------------------- camera scanner ------------------------------ */
  useEffect(() => {
    if (!scanOpen) return;
    let cancelled = false;
    let scanner: Html5Qrcode | null = null;
    void import("html5-qrcode").then(({ Html5Qrcode: H }) => {
      if (cancelled) return;
      scanner = new H("qr-reader");
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          async (decodedText) => {
            if (cancelled) return;
            const token = parseTokenFromString(decodedText);
            if (!token) {
              setScanState("error");
              setScanMessage("That doesn't look like a check-in code.");
              return;
            }
            try {
              await scanner!.stop();
            } catch {
              /* ignore */
            }
            await handleToken(token);
          },
          () => {
            /* per-frame miss — keep scanning */
          }
        )
        .catch((err) => {
          if (cancelled) return;
          setScanState("error");
          setScanMessage(
            "Couldn't start the camera. Make sure you've allowed camera access."
          );
          console.error("html5-qrcode start failed", err);
        });
    });
    return () => {
      cancelled = true;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner!.clear())
          .catch(() => {
            /* already stopped */
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOpen, scanAttempt]);

  /* ------------------------------- render -------------------------------- */
  return (
    <div className="px-4 pb-6 pt-5">
      <div className="mb-4">
        <h1 className="text-xl font-black text-ink dark:text-zinc-100">Check-In</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {isStaff
            ? selectedEvent?.checkin_mode === "toggle"
              ? "Tap who's present as they arrive."
              : selectedEvent?.checkin_mode === "both"
                ? "Generate a code and tap who's present as they arrive."
                : selectedEvent?.checkin_mode === "none"
                  ? "No check-in for this event."
                  : "Generate a code students scan to check in."
            : selectedEvent?.checkin_mode === "toggle"
              ? "Staff will mark you present."
              : selectedEvent?.checkin_mode === "none"
                ? "No check-in for this event."
                : "Scan the code at the door."}
        </p>
      </div>

      {!selectedEvent ? (
        <Card className="p-6 text-center">
          <Music className="mx-auto mb-2 size-8 text-gold" />
          <p className="text-sm font-semibold text-ink dark:text-zinc-200">
            No upcoming events
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Add one from the Calendar to get started.
          </p>
        </Card>
      ) : (
        <>
          {/* event picker */}
          {upcomingEvents.length > 1 && (
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
              {upcomingEvents.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => selectEvent(ev)}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    selectedEvent?.id === ev.id
                      ? "bg-forest text-white dark:bg-mid"
                      : "bg-white text-zinc-500 ring-1 ring-black/5 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-white/10"
                  )}
                >
                  {ev.name} · {fmtTime(ev.date)}
                </button>
              ))}
            </div>
          )}

          {/* selected event hero */}
          <Card className="mb-4 overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", getEventTypeChip(selectedEvent.event_type || selectedEvent.type))}>
                <Music className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink dark:text-zinc-100">
                  {selectedEvent.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <Clock className="size-3.5" /> {selectedEvent.all_day ? "All day" : fmtTime(selectedEvent.date)}
                  {selectedEvent.location && (
                    <>
                      <span>·</span>
                      <MapPin className="size-3.5" /> {selectedEvent.location}
                    </>
                  )}
                </p>
              </div>
              <Badge className={getEventTypeChip(selectedEvent.event_type || selectedEvent.type)}>
                {getEventTypeLabel(selectedEvent.event_type || selectedEvent.type)}
              </Badge>
            </div>

            {/* staff: check-in controls */}
            {isStaff && (
              <div className="border-t border-black/5 bg-cream p-4 dark:border-white/10 dark:bg-zinc-950/40">
                {/* director/secretary: choose how attendance is collected */}
                {isCheckinManager && (
                  <div className="mb-3">
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                      Check-in method
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => void setCheckinMode("qr")}
                        className={cn(
                          "flex min-h-10 items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors",
                          selectedEvent.checkin_mode === "qr"
                            ? "bg-forest text-white dark:bg-mid"
                            : "bg-white text-zinc-500 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10"
                        )}
                      >
                        <QrCode className="size-4" /> QR
                      </button>
                      <button
                        type="button"
                        onClick={() => void setCheckinMode("toggle")}
                        className={cn(
                          "flex min-h-10 items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors",
                          selectedEvent.checkin_mode === "toggle"
                            ? "bg-gold text-ink dark:bg-gold/80"
                            : "bg-white text-zinc-500 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10"
                        )}
                      >
                        <ListChecks className="size-4" /> Toggle
                      </button>
                      <button
                        type="button"
                        onClick={() => void setCheckinMode("both")}
                        className={cn(
                          "flex min-h-10 items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors",
                          selectedEvent.checkin_mode === "both"
                            ? "bg-gold text-ink dark:bg-gold/80"
                            : "bg-white text-zinc-500 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10"
                        )}
                      >
                        <Layers className="size-4" /> Both
                      </button>
                      <button
                        type="button"
                        onClick={() => void setCheckinMode("none")}
                        className={cn(
                          "flex min-h-10 items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors",
                          selectedEvent.checkin_mode === "none"
                            ? "bg-gold text-ink dark:bg-gold/80"
                            : "bg-white text-zinc-500 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10"
                        )}
                      >
                        <Ban className="size-4" /> None
                      </button>
                    </div>
                  </div>
                )}

                {staffError && (
                  <Alert tone="error" className="mb-3">
                    {staffError}
                  </Alert>
                )}

                {selectedEvent.checkin_mode === "none" ? (
                  <div className="rounded-xl bg-white/60 px-4 py-3 text-center dark:bg-zinc-800">
                    <Ban className="mx-auto mb-1 size-6 text-zinc-400" />
                    <p className="text-sm font-semibold text-ink dark:text-zinc-200">
                      No check-in for this event
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      Attendance isn't being collected for this event.
                    </p>
                  </div>
                ) : (
                  <>
                {/* QR portion */}
                {selectedEvent.checkin_mode !== "toggle" && (
                  <div
                    className={
                      selectedEvent.checkin_mode === "both" ? "mb-4" : ""
                    }
                  >
                {!session ? (
                  <Button size="lg" className="w-full" onClick={generate} loading={generating}>
                    <QrCode className="size-5" /> Generate Code
                  </Button>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="rounded-2xl bg-white p-4 shadow-inner ring-1 ring-black/10">
                      <QRCodeSVG value={qrUrl} size={200} level="M" marginSize={2} />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                        {expired ? "Code expired" : "Code expires in"}
                      </p>
                      <p
                        className={cn(
                          "font-mono text-4xl font-black tabular-nums",
                          expired
                            ? "text-red-500"
                            : secondsLeft <= 10
                              ? "text-red-500"
                              : "text-forest dark:text-gold"
                        )}
                      >
                        {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
                        {String(secondsLeft % 60).padStart(2, "0")}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        Students scan this with their phone camera.
                      </p>
                    </div>
                    {session.entry_code && !expired && (
                      <div className="w-full rounded-2xl bg-forest/5 px-4 py-3 text-center ring-1 ring-forest/15 dark:bg-forest/20 dark:ring-forest/40">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Camera not working? Manual code
                        </p>
                        <p className="mt-1 font-mono text-3xl font-black tracking-[0.3em] text-forest dark:text-gold">
                          {session.entry_code}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Students can type this on their Check-In screen.
                        </p>
                      </div>
                    )}
                    <Button
                      variant={expired ? "primary" : "outline"}
                      size="sm"
                      onClick={generate}
                      loading={generating}
                    >
                      <RefreshCw className="size-4" /> Regenerate
                    </Button>
                  </div>
                )}
                  </div>
                )}

                {/* live view */}
                {selectedEvent.checkin_mode === "qr" ? (
                  session && !expired && (
                    <div className="mt-4">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">
                        <Users className="size-3.5" /> Checked in · {checkedInIds.size} of {relevantMembers.length}
                      </p>
                      {relevantMembers.length === 0 ? (
                        <p className="rounded-xl bg-white/60 px-3 py-2 text-xs text-zinc-400 dark:bg-zinc-800">
                          No one to check in yet.
                        </p>
                      ) : (
                        <div className="max-h-52 space-y-1 overflow-y-auto">
                          {relevantMembers.map((p) => {
                            const rec = liveCheckins.find(
                              (r) => r.student_id === p.id
                            );
                            const done = Boolean(rec);
                            return (
                              <div
                                key={p.id}
                                className={
                                  "flex items-center gap-2 rounded-xl px-3 py-1.5 " +
                                  (done
                                    ? "bg-moss/70 dark:bg-forest/40"
                                    : "bg-white/60 dark:bg-zinc-800")
                                }
                              >
                                <Avatar name={p.display_name || "?"} url={p.avatar_url} size="xs" />
                                <span className="flex-1 truncate text-xs font-semibold text-ink dark:text-zinc-200">
                                  {p.display_name || p.full_name}
                                </span>
                                {done ? (
                                  <span className="flex items-center gap-1 text-[11px] font-bold text-forest dark:text-moss">
                                    <CheckCircle2 className="size-3.5" />
                                    {rec?.checked_in_at ? fmtTime(rec.checked_in_at) : "In"}
                                    {rec?.is_late && (
                                      <Badge className="ml-1 bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300">
                                        Late
                                      </Badge>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold text-zinc-400">
                                    Not yet
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  /* toggle / both */
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">
                      <Users className="size-3.5" /> Present · {checkedInIds.size} of{" "}
                      {relevantMembers.length}
                    </p>
                    {relevantMembers.length === 0 ? (
                      <p className="rounded-xl bg-white/60 px-3 py-2 text-xs text-zinc-400 dark:bg-zinc-800">
                        No one to check in yet.
                      </p>
                    ) : (
                      <div className="max-h-80 space-y-1 overflow-y-auto">
                        {relevantMembers.map((p) => {
                          const rec = liveCheckins.find(
                            (r) => r.student_id === p.id
                          );
                          const done = Boolean(rec);
                          const isExcused = rec?.status === "excused";
                          const isLate = rec?.status === "late" || rec?.is_late;
                          return (
                            <div
                              key={p.id}
                              className={
                                "flex items-center gap-2 rounded-xl px-3 py-2 " +
                                (isExcused
                                  ? "bg-amber-50 dark:bg-amber-950/30"
                                  : done
                                    ? "bg-moss/70 dark:bg-forest/40"
                                    : "bg-white/60 dark:bg-zinc-800")
                              }
                            >
                              <Avatar
                                name={p.display_name || "?"}
                                url={p.avatar_url}
                                size="xs"
                              />
                              <span className="flex-1 truncate text-xs font-semibold text-ink dark:text-zinc-200">
                                {p.display_name || p.full_name}
                              </span>
                              <div className="flex items-center gap-1">
                                {isLate && done && (
                                  <Badge className="bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300">
                                    Late
                                  </Badge>
                                )}
                                {isExcused && (
                                  <Badge className="bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
                                    Excused
                                  </Badge>
                                )}
                                {!isExcused && (
                                  <button
                                    onClick={() => void toggleAttendance(p.id, done)}
                                    className={cn(
                                      "min-h-8 rounded-lg px-3 text-xs font-bold transition-colors",
                                      done
                                        ? "bg-forest text-white dark:bg-mid"
                                        : "bg-white text-forest ring-1 ring-forest/30 dark:bg-zinc-700 dark:text-moss dark:ring-forest/50"
                                    )}
                                  >
                                    {done ? "Present" : "Mark present"}
                                  </button>
                                )}
                                {isCheckinManager && !isExcused && (
                                  <button
                                    onClick={() => setExcusedModal({ studentId: p.id, studentName: p.display_name || p.full_name })}
                                    className="min-h-8 rounded-lg px-2 text-xs font-bold text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                                    title="Mark excused"
                                  >
                                    Excuse
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                  </>
                )}
              </div>
            )}

            {/* student: status + scan */}
            {!isStaff && (
              <div className="border-t border-black/5 bg-cream p-4 dark:border-white/10 dark:bg-zinc-950/40">
                {myRecord?.attended || myRecord?.status === "excused" ? (
                  <div className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3",
                    myRecord.status === "excused"
                      ? "bg-amber-50 dark:bg-amber-950/30"
                      : "bg-moss dark:bg-forest/30"
                  )}>
                    {myRecord.status === "excused" ? (
                      <CheckCircle2 className="size-7 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <CheckCircle2 className="size-7 shrink-0 text-forest dark:text-gold" />
                    )}
                    <div>
                      <p className={cn(
                        "text-sm font-bold",
                        myRecord.status === "excused"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-forest dark:text-moss"
                      )}>
                        {myRecord.status === "excused"
                          ? "You're excused"
                          : myRecord.is_late
                            ? "You're checked in (late)"
                            : "You're checked in!"}
                      </p>
                      <p className="text-xs text-forest/70 dark:text-moss/70">
                        {myRecord.status === "excused"
                          ? `Excused: ${myRecord.excuse_reason || "No reason given"}`
                          : myRecord.checked_in_at
                            ? `Checked in at ${fmtTime(myRecord.checked_in_at)}`
                            : "Marked present"}
                      </p>
                    </div>
                  </div>
                ) : selectedEvent.checkin_mode === "toggle" ? (
                  <div className="rounded-xl bg-white/60 px-4 py-3 text-center dark:bg-zinc-800">
                    <ListChecks className="mx-auto mb-1 size-6 text-gold" />
                    <p className="text-sm font-semibold text-ink dark:text-zinc-200">
                      Staff will mark you present
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      This event uses toggle check-in — no code needed.
                    </p>
                  </div>
                ) : selectedEvent.checkin_mode === "none" ? (
                  <div className="rounded-xl bg-white/60 px-4 py-3 text-center dark:bg-zinc-800">
                    <Ban className="mx-auto mb-1 size-6 text-zinc-400" />
                    <p className="text-sm font-semibold text-ink dark:text-zinc-200">
                      No check-in for this event
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      This event doesn't collect attendance.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button size="lg" className="w-full" onClick={() => setScanOpen(true)}>
                      <Camera className="size-5" /> Scan QR Code
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setManualCode("");
                        setManualState("idle");
                        setManualMessage(null);
                        setManualOpen(true);
                      }}
                    >
                      <Keyboard className="size-4" /> Camera not working? Enter code
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* Excused modal */}
      <Modal
        open={excusedModal !== null}
        onClose={() => setExcusedModal(null)}
        title="Mark excused"
      >
        <div className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Mark <span className="font-semibold text-ink dark:text-zinc-200">{excusedModal?.studentName}</span> as excused for this event.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Reason
            </label>
            <Select value={excuseReason} onChange={(e) => setExcuseReason(e.target.value)}>
              {EXCUSE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Staff note (optional)
            </label>
            <input
              value={excuseNote}
              onChange={(e) => setExcuseNote(e.target.value)}
              placeholder="Additional details..."
              className="w-full min-h-11 rounded-xl bg-cream px-4 text-base text-ink placeholder:text-zinc-400 ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-mid dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10 dark:focus:ring-mid"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setExcusedModal(null)}>
              Cancel
            </Button>
            <Button className="flex-1" loading={excusing} onClick={() => void markExcused()}>
              Mark excused
            </Button>
          </div>
        </div>
      </Modal>

      {/* scanner overlay */}
      {scanOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <p className="text-sm font-semibold">
              {scanState === "success"
                ? "Checked in"
                : scanState === "error"
                  ? "Scan failed"
                  : "Point at the code"}
            </p>
            <button
              onClick={() => setScanOpen(false)}
              className="rounded-full bg-white/10 p-2"
              aria-label="Close scanner"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center px-6">
            <div className="relative w-full max-w-72">
              <div className="overflow-hidden rounded-2xl ring-4 ring-white/20">
                <div id="qr-reader" className="[&_video]:w-full [&_video]:object-cover" />
              </div>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-2 top-2 size-8 rounded-tl-lg border-l-4 border-t-4 border-gold" />
                <div className="absolute right-2 top-2 size-8 rounded-tr-lg border-r-4 border-t-4 border-gold" />
                <div className="absolute bottom-2 left-2 size-8 rounded-bl-lg border-b-4 border-l-4 border-gold" />
                <div className="absolute bottom-2 right-2 size-8 rounded-br-lg border-b-4 border-r-4 border-gold" />
              </div>
            </div>
          </div>

          <div className="px-6 pb-10">
            {scanState === "success" ? (
              <div className="rounded-2xl bg-moss p-5 text-center dark:bg-forest/40">
                <CheckCircle2 className="mx-auto mb-2 size-10 text-forest dark:text-gold" />
                <p className="text-base font-black text-forest dark:text-moss">
                  You're checked in!
                </p>
                <p className="mt-1 text-sm text-forest/80 dark:text-moss/80">{scanMessage}</p>
                <Button className="mt-4 w-full" onClick={() => setScanOpen(false)}>
                  Done
                </Button>
              </div>
            ) : scanState === "error" ? (
              <div className="rounded-2xl bg-red-950/60 p-5 text-center">
                <CameraOff className="mx-auto mb-2 size-10 text-red-400" />
                <p className="text-sm font-bold text-white">{scanMessage}</p>
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 !text-white !ring-white/40"
                    onClick={() => setScanOpen(false)}
                  >
                    Close
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setScanState("scanning");
                      setScanMessage(null);
                      setScanAttempt((n) => n + 1);
                    }}
                  >
                    Try again
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-sm text-white/60">
                Hold your phone steady over the QR code
              </p>
            )}
          </div>
        </div>
      )}

      {/* manual code modal */}
      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Enter check-in code"
      >
        <form onSubmit={submitManualCode} className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Type the 6–8 character code your teacher is displaying.
          </p>
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            placeholder="e.g. ABCD1234"
            autoCapitalize="characters"
            className="w-full rounded-xl bg-cream px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.2em] text-ink ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-mid dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10"
            autoFocus
          />
          {manualState === "success" && (
            <div className="rounded-xl bg-moss px-4 py-3 text-center dark:bg-forest/30">
              <p className="text-sm font-bold text-forest dark:text-moss">{manualMessage}</p>
            </div>
          )}
          {manualState === "error" && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-center dark:bg-red-950/60">
              <p className="text-sm font-bold text-red-600 dark:text-red-300">{manualMessage}</p>
            </div>
          )}
          <Button type="submit" size="lg" loading={manualState === "processing"} className="w-full">
            Check in
          </Button>
        </form>
      </Modal>
    </div>
  );
}
