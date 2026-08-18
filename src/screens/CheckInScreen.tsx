import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { Html5Qrcode } from "html5-qrcode";
import { QRCodeSVG } from "qrcode.react";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Keyboard,
  MapPin,
  Music,
  QrCode,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  recordAttendance,
  recordAttendanceByCode,
  startCheckinSession,
} from "../lib/rpc";
import type { AttendanceRow, EventRow, Profile } from "../lib/types";
import { fmtTime, parseTokenFromString, startOfDay } from "../lib/date";
import { EVENT_TYPE_CHIP, EVENT_TYPE_LABEL } from "../lib/constants";
import { Alert, Badge, Button, Card, Modal, cn } from "../components/ui";
import { Avatar } from "../components/Avatar";

interface ActiveSession {
  token: string;
  entry_code?: string;
  expires_at: string;
  event_id: string;
}

export default function CheckInScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const isStaff =
    profile.role === "director" ||
    profile.role === "secretary" ||
    profile.role === "section_leader";

  const [upcomingEvents, setUpcomingEvents] = useState<EventRow[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [myRecord, setMyRecord] = useState<AttendanceRow | null>(null);

  // staff: QR generation
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [generating, setGenerating] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [liveCheckins, setLiveCheckins] = useState<AttendanceRow[]>([]);
  const [roster, setRoster] = useState<Record<string, Profile>>({});

  // student: scanner
  const [scanOpen, setScanOpen] = useState(false);
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

  const [searchParams, setSearchParams] = useSearchParams();
  const urlToken = searchParams.get("token");

  /* ------------------------- upcoming events ----------------------------- */
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("events")
      .select("*")
      .gte("date", startOfDay(new Date()).toISOString())
      .order("date", { ascending: true })
      .limit(20)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as EventRow[]) ?? [];
        setUpcomingEvents(rows);
        setSelectedEvent((prev) => {
          // Keep the current pick if it's still upcoming; otherwise default to
          // the earliest. Two events can share a date, so we never collapse to
          // a single "next" event.
          if (prev && rows.some((e) => e.id === prev.id)) return prev;
          return rows[0] ?? null;
        });
      });
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

  /** Switch which event this screen is running check-in for. */
  function selectEvent(ev: EventRow) {
    setSelectedEvent(ev);
    setQrError(null);
    // A QR code belongs to one event — drop it when switching so a code is
    // never shown against the wrong event's header.
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
          event: "INSERT",
          schema: "public",
          table: "attendance_records",
          filter: `event_id=eq.${selectedEvent.id}`,
        },
        (payload) => {
          setLiveCheckins((prev) => [
            ...prev.filter((r) => r.student_id !== (payload.new as AttendanceRow).student_id),
            payload.new as AttendanceRow,
          ]);
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

  /* the roster relevant to this check-in: their section, or everyone */
  const relevantMembers = useMemo(() => {
    const list = Object.values(roster).filter(
      (p) => p.role === "student" || p.role === "section_leader"
    );
    if (profile.role === "section_leader") {
      return list.filter((p) => p.instrument === profile.instrument);
    }
    return list;
  }, [roster, profile.role, profile.instrument]);

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
    setQrError(null);
    const { result, error } = await startCheckinSession(selectedEvent.id);
    setGenerating(false);
    if (error || !result?.ok) {
      setQrError(error?.message ?? result?.message ?? "Could not generate a code.");
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
    setScanMessage(
      `${result.event_name} · checked in at ${result.checked_in_at ? fmtTime(result.checked_in_at) : ""}`
    );
    // Show the event they actually checked in for (not just the earliest one).
    const ev = upcomingEvents.find((e) => e.id === result.event_id);
    if (ev) setSelectedEvent(ev);
    void refreshMyRecord(result.event_id);
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
    setManualMessage(
      `${result.event_name} · checked in at ${result.checked_in_at ? fmtTime(result.checked_in_at) : ""}`
    );
    // Show the event they actually checked in for.
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
    // html5-qrcode (~400 kB) is dynamically imported so phones don't pay for
    // the scanner bundle unless a student actually opens the camera.
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
  }, [scanOpen]);

  /* ------------------------------- render -------------------------------- */
  return (
    <div className="px-4 pb-6 pt-5">
      <div className="mb-4">
        <h1 className="text-xl font-black text-ink dark:text-zinc-100">Check-In</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {isStaff ? "Generate a code students scan to check in." : "Scan the code at the door."}
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
          {/* event picker — two events can share a date, so pick which one */}
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
              <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", EVENT_TYPE_CHIP[selectedEvent.type])}>
                <Music className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink dark:text-zinc-100">
                  {selectedEvent.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <Clock className="size-3.5" /> {fmtTime(selectedEvent.date)}
                  {selectedEvent.location && (
                    <>
                      <span>·</span>
                      <MapPin className="size-3.5" /> {selectedEvent.location}
                    </>
                  )}
                </p>
              </div>
              <Badge className={EVENT_TYPE_CHIP[selectedEvent.type]}>
                {EVENT_TYPE_LABEL[selectedEvent.type]}
              </Badge>
            </div>

            {/* staff: generate / QR */}
            {isStaff && (
              <div className="border-t border-black/5 bg-cream p-4 dark:border-white/10 dark:bg-zinc-950/40">
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
                {qrError && <Alert tone="error" className="mt-3">{qrError}</Alert>}

                {/* live check-ins: who has & hasn't checked in yet */}
                {session && !expired && (
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
                )}
              </div>
            )}

            {/* student: status + scan */}
            {!isStaff && (
              <div className="border-t border-black/5 bg-cream p-4 dark:border-white/10 dark:bg-zinc-950/40">
                {myRecord?.attended ? (
                  <div className="flex items-center gap-3 rounded-xl bg-moss px-4 py-3 dark:bg-forest/30">
                    <CheckCircle2 className="size-7 shrink-0 text-forest dark:text-gold" />
                    <div>
                      <p className="text-sm font-bold text-forest dark:text-moss">
                        You're checked in!
                      </p>
                      <p className="text-xs text-forest/70 dark:text-moss/70">
                        {myRecord.checked_in_at
                          ? `Scanned in at ${fmtTime(myRecord.checked_in_at)}`
                          : "Marked present"}
                      </p>
                    </div>
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
              {/* corner brackets */}
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
                    variant="gold"
                    className="flex-1"
                    onClick={() => {
                      setScanState("scanning");
                      setScanMessage(null);
                    }}
                  >
                    Try again
                  </Button>
                </div>
                <Button
                  variant="gold"
                  className="mt-3 w-full"
                  onClick={() => {
                    setScanOpen(false);
                    setManualCode("");
                    setManualState("idle");
                    setManualMessage(null);
                    setManualOpen(true);
                  }}
                >
                  <Keyboard className="size-4" /> Enter code manually
                </Button>
              </div>
            ) : (
              <p className="text-center text-xs text-white/60">
                Scanning for a check-in code…
              </p>
            )}
          </div>
        </div>
      )}

      {/* manual code entry fallback */}
      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title={manualState === "success" ? "Checked in" : "Enter check-in code"}
      >
        {manualState === "success" ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto mb-2 size-10 text-forest dark:text-gold" />
            <p className="text-base font-black text-ink dark:text-zinc-100">
              You're checked in!
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {manualMessage}
            </p>
            <Button className="mt-5 w-full" onClick={() => setManualOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submitManualCode} className="space-y-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              The staff member at the door shows a short code on their screen.
              Type it here to check in.
            </p>
            <input
              value={manualCode}
              onChange={(e) => {
                setManualCode(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                );
                if (manualState === "error") {
                  setManualState("idle");
                  setManualMessage(null);
                }
              }}
              placeholder="e.g. K7Q2P3M9"
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
              className="w-full min-h-13 rounded-xl bg-cream px-4 text-center font-mono text-2xl font-black tracking-[0.35em] text-ink placeholder:text-zinc-300 ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-mid dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10 dark:focus:ring-mid"
            />
            {manualState === "error" && manualMessage && (
              <Alert tone="error">{manualMessage}</Alert>
            )}
            <Button
              type="submit"
              size="lg"
              loading={manualState === "processing"}
              className="w-full"
            >
              Check in
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}