import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Check,
  ClipboardCheck,
  Download,
  Users,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  getCachedEvents,
  setCachedEvents,
  isEventsStale,
} from "../lib/eventCache";
import { overrideAttendance } from "../lib/rpc";
import type { AttendanceRow, EventRow, Profile } from "../lib/types";
import { endOfDay, fmtDate, relativeDay } from "../lib/date";
import { INSTRUMENTS } from "../lib/constants";
import {
  EXCUSE_REASONS,
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
import { Avatar } from "../components/Avatar";
import { ProgressRing } from "../components/ProgressRing";

export default function AttendanceScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const isStaff =
    profile.roles.includes("director") ||
    profile.roles.includes("secretary") ||
    profile.roles.includes("section_leader");
  const isDirector = profile.roles.includes("director");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    profile.roles.includes("director") ? null : profile.id
  );
  const [filter, setFilter] = useState<string>("All");
  const [error, setError] = useState<string | null>(null);

  // Excused modal
  const [excusedModal, setExcusedModal] = useState<{
    studentId: string;
    eventId: string;
    studentName: string;
  } | null>(null);
  const [excuseReason, setExcuseReason] = useState("Sick");
  const [excuseNote, setExcuseNote] = useState("");
  const [excusing, setExcusing] = useState(false);

  useEffect(() => {
    // Use cached events for instant display
    const cached = getCachedEvents();
    if (cached.length > 0) setEvents(cached);

    // Fetch profiles and attendance records
    void Promise.all([
      isEventsStale()
        ? supabase.from("events").select("*").order("date", { ascending: true })
        : Promise.resolve({ data: null }),
      supabase.from("profiles").select("*").order("display_name"),
      supabase.from("attendance_records").select("*"),
    ]).then(([ev, pr, rec]) => {
      if (ev.data) {
        setEvents(ev.data as EventRow[]);
        setCachedEvents(ev.data as EventRow[]);
      }
      setProfiles((pr.data as Profile[]) ?? []);
      setRecords((rec.data as AttendanceRow[]) ?? []);
    });
  }, []);

  // Only required events that have already ended
  const pastEvents = useMemo(
    () =>
      events
        .filter(
          (e) =>
            new Date(e.date) < endOfDay(new Date()) &&
            e.checkin_mode !== "none" &&
            e.attendance_requirement === "required" &&
            !e.archived
        )
        .sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    [events]
  );

  const staffMembers = useMemo(() => {
    if (!isStaff) return [];
    const base = profiles.filter(
      (p) => p.roles.includes("student") || p.roles.includes("section_leader")
    );
    if (profile.roles.includes("section_leader")) {
      return base.filter((p) => p.instrument === profile.instrument);
    }
    return filter === "All"
      ? base
      : base.filter((p) => p.instrument === filter);
  }, [isStaff, profiles, filter, profile]);

  const filterChips = useMemo(() => {
    if (!isStaff) return [];
    if (profile.roles.includes("section_leader"))
      return ["All", profile.instrument].filter(Boolean);
    return ["All", ...INSTRUMENTS];
  }, [isStaff, profile]);

  function percentOf(memberId: string): number {
    if (pastEvents.length === 0) return 0;
    const attended = records.filter(
      (r) =>
        r.student_id === memberId &&
        (r.attended || r.status === "excused") &&
        r.status !== "excused"  // Don't count excused as attended for percentage
    ).length;
    const excused = records.filter(
      (r) => r.student_id === memberId && r.status === "excused"
    ).length;
    const denominator = pastEvents.length - excused;
    if (denominator <= 0) return 100;
    return Math.round((attended / denominator) * 100);
  }

  function historyOf(memberId: string) {
    return pastEvents.map((ev) => ({
      event: ev,
      rec: records.find(
        (r) => r.event_id === ev.id && r.student_id === memberId
      ),
    }));
  }

  async function markExcused() {
    if (!excusedModal) return;
    setExcusing(true);
    const { result, error } = await overrideAttendance(
      excusedModal.eventId,
      excusedModal.studentId,
      "excused",
      excuseReason,
      excuseNote
    );
    setExcusing(false);
    if (error || !result?.ok) {
      setError(error?.message ?? result?.message ?? "Could not mark excused.");
      return;
    }
    // Refresh records
    const { data } = await supabase.from("attendance_records").select("*");
    setRecords((data as AttendanceRow[]) ?? []);
    setExcusedModal(null);
    setExcuseReason("Sick");
    setExcuseNote("");
  }

  async function toggle(
    memberId: string,
    eventId: string,
    currentlyAttended: boolean
  ) {
    const next = !currentlyAttended;
    setError(null);
    setRecords((prev) =>
      next
        ? [
            ...prev.filter(
              (r) => !(r.event_id === eventId && r.student_id === memberId)
            ),
            {
              id: `tmp-${eventId}-${memberId}`,
              event_id: eventId,
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
        : prev.filter(
            (r) => !(r.event_id === eventId && r.student_id === memberId)
          )
    );
    const { result, error } = await overrideAttendance(
      eventId,
      memberId,
      next
    );
    if (error || !result?.ok) {
      setError(error?.message ?? result?.message ?? "Override failed.");
      const { data } = await supabase.from("attendance_records").select("*");
      setRecords((data as AttendanceRow[]) ?? []);
    }
  }

  const isDirectorView = profile.roles.includes("director");
  const myPercent = isDirectorView ? 0 : percentOf(profile.id);
  const myHistory = isDirectorView ? [] : historyOf(profile.id);

  function exportCsv() {
    const roster = profiles.filter(
      (p) => p.roles.includes("student") || p.roles.includes("section_leader")
    );
    const headers = [
      "Name",
      "Instrument",
      ...pastEvents.map(
        (e) => `${e.name} (${fmtDate(new Date(e.date))})`
      ),
      "Attendance %",
    ];
    const rows = roster.map((m) => {
      const mExcused = records.filter(
        (r) => r.student_id === m.id && r.status === "excused"
      ).length;
      const mAttended = records.filter(
        (r) => r.student_id === m.id && r.attended && r.status !== "excused"
      ).length;
      const cells = pastEvents.map((ev) => {
        const rec = records.find(
          (r) => r.event_id === ev.id && r.student_id === m.id
        );
        if (!rec) return "Absent";
        if (rec.status === "excused") return "Excused";
        if (rec.status === "late") return "Late";
        return rec.attended ? "Present" : "Absent";
      });
      const denominator = pastEvents.length - mExcused;
      const pct = denominator > 0
        ? Math.round((mAttended / denominator) * 100)
        : 100;
      return [
        m.display_name || m.full_name,
        m.instrument,
        ...cells,
        `${pct}%`,
      ];
    });
    const escape = (v: string) =>
      /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [headers, ...rows]
      .map((row) => row.map(escape).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "attendance.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="px-4 pb-6 pt-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-ink dark:text-zinc-100">
            Attendance
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pastEvents.length} required event{pastEvents.length === 1 ? "" : "s"} tracked
          </p>
        </div>
        {isDirector && pastEvents.length > 0 && (
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        )}
      </div>

      {/* personal card */}
      {!isDirectorView && (
        <Card className="flex items-center gap-5 p-5">
          <ProgressRing percent={myPercent}>
            <span className="text-2xl font-black text-ink dark:text-zinc-100">
              {myPercent}%
            </span>
            <span className="text-[10px] font-semibold uppercase text-zinc-400">
              attended
            </span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink dark:text-zinc-100">
              {profile.display_name || profile.full_name}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {records.filter((r) => r.student_id === profile.id && r.attended && r.status !== "excused")
                .length}{" "}
              of {pastEvents.length} events attended
            </p>
            {records.filter((r) => r.student_id === profile.id && r.status === "excused").length > 0 && (
              <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                {records.filter((r) => r.student_id === profile.id && r.status === "excused").length} excused absence{records.filter((r) => r.student_id === profile.id && r.status === "excused").length === 1 ? "" : "s"}
              </p>
            )}
            {pastEvents.length === 0 && (
              <p className="mt-1 text-xs text-zinc-400">
                No past events yet — attendance starts after the first one.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* my history */}
      {!isDirectorView && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
            My history
          </p>
          {myHistory.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="size-6" />}
              title="Nothing to show yet"
              subtitle="Past events will appear here with present / excused / missed status."
            />
          ) : (
            <div className="space-y-2">
              {myHistory.map(({ event, rec }) => (
                <HistoryRow
                  key={event.id}
                  event={event}
                  record={rec}
                  editable={false}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* staff roster overview */}
      {isStaff && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
            Roster overview
          </p>

          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {filterChips.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  filter === f
                    ? "bg-forest text-white dark:bg-mid"
                    : "bg-white text-zinc-500 ring-1 ring-black/5 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-white/10"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {staffMembers.length === 0 ? (
            <EmptyState
              icon={<Users className="size-6" />}
              title="No members"
              subtitle={
                profile.roles.includes("section_leader")
                  ? "Your section has no students yet."
                  : "Add members from the Roster tab."
              }
            />
          ) : (
            <div className="space-y-2">
              {staffMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 transition-colors dark:bg-zinc-900",
                    selectedId === m.id
                      ? "ring-2 ring-mid"
                      : "ring-black/5 dark:ring-white/10"
                  )}
                >
                  <Avatar name={m.display_name || m.full_name} url={m.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink dark:text-zinc-100">
                      {m.display_name || m.full_name}
                    </p>
                    <p className="text-xs text-zinc-400">{m.instrument || "—"}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-black",
                      percentOf(m.id) >= 80
                        ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
                        : percentOf(m.id) >= 50
                          ? "bg-gold/15 text-gold-deep dark:text-gold"
                          : "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300"
                    )}
                  >
                    {percentOf(m.id)}%
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* selected member detail */}
          {selectedId && (
            <div className="mt-4">
              {error && (
                <Alert tone="error" className="mb-3">
                  {error}
                </Alert>
              )}
              {historyOf(selectedId).length > 0 && (
                <div className="space-y-2">
                  {historyOf(selectedId).map(({ event, rec }) => (
                    <HistoryRow
                      key={event.id}
                      event={event}
                      record={rec}
                      editable
                      onToggle={() =>
                        void toggle(selectedId, event.id, rec?.attended ?? false)
                      }
                      onExcuse={() =>
                        setExcusedModal({
                          studentId: selectedId,
                          eventId: event.id,
                          studentName: profiles.find((p) => p.id === selectedId)?.display_name || "Student",
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Excused modal */}
      <Modal
        open={excusedModal !== null}
        onClose={() => setExcusedModal(null)}
        title="Mark excused"
      >
        <div className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Mark <span className="font-semibold text-ink dark:text-zinc-200">{excusedModal?.studentName}</span> as excused.
          </p>
          <Field label="Reason">
            <Select value={excuseReason} onChange={(e) => setExcuseReason(e.target.value)}>
              {EXCUSE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Staff note (optional)">
            <Input
              value={excuseNote}
              onChange={(e) => setExcuseNote(e.target.value)}
              placeholder="Additional details..."
            />
          </Field>
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
    </div>
  );
}

function HistoryRow({
  event,
  record,
  editable,
  onToggle,
  onExcuse,
}: {
  event: EventRow;
  record?: AttendanceRow;
  editable: boolean;
  onToggle?: () => void;
  onExcuse?: () => void;
}) {
  const attended = record?.attended ?? false;
  const status = record?.status ?? "absent";
  const isLate = record?.is_late ?? status === "late";
  const isExcused = status === "excused";

  const statusColor = isExcused
    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
    : isLate
      ? "bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300"
      : attended
        ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
        : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800";

  const iconColor = isExcused
    ? "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300"
    : isLate
      ? "bg-orange-50 text-orange-500 dark:bg-orange-950/60 dark:text-orange-300"
      : attended
        ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
        : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800";

  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            iconColor
          )}
        >
          {isExcused ? (
            <span className="text-sm">✓</span>
          ) : isLate ? (
            <span className="text-sm">⏰</span>
          ) : attended ? (
            <Check className="size-5" />
          ) : (
            <X className="size-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink dark:text-zinc-100">
            {event.name}
          </p>
          <p className="text-xs text-zinc-400">
            {getEventTypeLabel(event.event_type || event.type)} · {relativeDay(event.date)} · {fmtDate(new Date(event.date))}
          </p>
          {record?.checked_in_at && (
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Checked in: {new Date(record.checked_in_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </p>
          )}
          {isExcused && record?.excuse_reason && (
            <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
              Excused: {record.excuse_reason}
            </p>
          )}
          {record?.staff_note && (
            <p className="mt-0.5 text-[11px] text-zinc-400 italic">
              Note: {record.staff_note}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isLate && (
            <Badge className="bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300">
              Late
            </Badge>
          )}
          {editable ? (
            <>
              <Button
                size="sm"
                variant={attended ? "outline" : "gold"}
                onClick={onToggle}
              >
                {attended ? "Mark absent" : "Mark present"}
              </Button>
              {onExcuse && !isExcused && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onExcuse}
                >
                  Excuse
                </Button>
              )}
            </>
          ) : (
            <Badge className={statusColor}>
              {isExcused ? "Excused" : isLate ? "Late" : attended ? "Present" : "Absent"}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
