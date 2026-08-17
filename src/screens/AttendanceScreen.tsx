import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Check, ClipboardCheck, Download, Users, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { overrideAttendance } from "../lib/rpc";
import type { AttendanceRow, EventRow, Profile } from "../lib/types";
import { endOfDay, fmtDate, relativeDay } from "../lib/date";
import { INSTRUMENTS } from "../lib/constants";
import { Alert, Badge, Button, Card, EmptyState, cn } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { ProgressRing } from "../components/ProgressRing";

export default function AttendanceScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const isStaff =
    profile.role === "director" || profile.role === "section_leader";
  const isDirector = profile.role === "director";

  const [events, setEvents] = useState<EventRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>(profile.id);
  const [filter, setFilter] = useState<string>("All");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      supabase.from("events").select("*").order("date", { ascending: true }),
      supabase.from("profiles").select("*").order("display_name"),
      supabase.from("attendance_records").select("*"),
    ]).then(([ev, pr, rec]) => {
      setEvents((ev.data as EventRow[]) ?? []);
      setProfiles((pr.data as Profile[]) ?? []);
      setRecords((rec.data as AttendanceRow[]) ?? []);
    });
  }, []);

  const pastEvents = useMemo(
    () =>
      events
        .filter((e) => new Date(e.date) < endOfDay(new Date()))
        .sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    [events]
  );

  /* staff member lists (section leaders scoped to their own section) */
  const staffMembers = useMemo(() => {
    if (!isStaff) return [];
    const base = profiles.filter(
      (p) => p.role === "student" || p.role === "section_leader"
    );
    if (profile.role === "section_leader") {
      return base.filter((p) => p.instrument === profile.instrument);
    }
    return filter === "All"
      ? base
      : base.filter((p) => p.instrument === filter);
  }, [isStaff, profiles, filter, profile]);

  const filterChips = useMemo(() => {
    if (!isStaff) return [];
    if (profile.role === "section_leader")
      return ["All", profile.instrument].filter(Boolean);
    return ["All", ...INSTRUMENTS];
  }, [isStaff, profile]);

  function percentOf(memberId: string): number {
    if (pastEvents.length === 0) return 0;
    const attended = records.filter(
      (r) => r.student_id === memberId && r.attended
    ).length;
    return Math.round((attended / pastEvents.length) * 100);
  }

  function historyOf(memberId: string) {
    return pastEvents.map((ev) => ({
      event: ev,
      rec: records.find(
        (r) => r.event_id === ev.id && r.student_id === memberId
      ),
    }));
  }

  async function toggle(
    memberId: string,
    eventId: string,
    currentlyAttended: boolean
  ) {
    const next = !currentlyAttended;
    setError(null);
    // optimistic update
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
      // refetch the authoritative state to undo the optimistic change
      const { data } = await supabase.from("attendance_records").select("*");
      setRecords((data as AttendanceRow[]) ?? []);
    }
  }

  const myPercent = percentOf(profile.id);
  const myHistory = historyOf(profile.id);

  /* --------------- director: full-roster season CSV export --------------- */
  function exportCsv() {
    // The whole roster (students + section leaders), regardless of the filter
    // chip, with one column per past event plus an attendance percentage.
    const roster = profiles.filter(
      (p) => p.role === "student" || p.role === "section_leader"
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
      const attended = records.filter(
        (r) => r.student_id === m.id && r.attended
      ).length;
      const cells = pastEvents.map((ev) => {
        const rec = records.find(
          (r) => r.event_id === ev.id && r.student_id === m.id
        );
        return rec?.attended ? "Present" : "Missed";
      });
      const pct = pastEvents.length
        ? Math.round((attended / pastEvents.length) * 100)
        : 0;
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
            {pastEvents.length} past event{pastEvents.length === 1 ? "" : "s"} tracked
          </p>
        </div>
        {isDirector && pastEvents.length > 0 && (
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        )}
      </div>

      {/* personal card */}
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
            {records.filter((r) => r.student_id === profile.id && r.attended)
              .length}{" "}
            of {pastEvents.length} events attended
          </p>
          {pastEvents.length === 0 && (
            <p className="mt-1 text-xs text-zinc-400">
              No past events yet — attendance starts after the first one.
            </p>
          )}
        </div>
      </Card>

      {/* my history */}
      <div className="mt-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
          My history
        </p>
        {myHistory.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="size-6" />}
            title="Nothing to show yet"
            subtitle="Past events will appear here with present / missed status."
          />
        ) : (
          <div className="space-y-2">
            {myHistory.map(({ event, rec }) => (
              <HistoryRow
                key={event.id}
                event={event}
                attended={rec?.attended ?? false}
                editable={false}
              />
            ))}
          </div>
        )}
      </div>

      {/* staff roster overview */}
      {isStaff && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
            Roster overview
          </p>

          {/* filter chips */}
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
                profile.role === "section_leader"
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

          {/* selected member detail with toggles */}
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
                      attended={rec?.attended ?? false}
                      editable
                      onToggle={() =>
                        void toggle(selectedId, event.id, rec?.attended ?? false)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  event,
  attended,
  editable,
  onToggle,
}: {
  event: EventRow;
  attended: boolean;
  editable: boolean;
  onToggle?: () => void;
}) {
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          attended
            ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
            : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
        )}
      >
        {attended ? <Check className="size-5" /> : <X className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink dark:text-zinc-100">
          {event.name}
        </p>
        <p className="text-xs text-zinc-400">
          {relativeDay(event.date)} · {fmtDate(new Date(event.date))}
        </p>
      </div>
      {editable ? (
        <Button
          size="sm"
          variant={attended ? "outline" : "gold"}
          onClick={onToggle}
        >
          {attended ? "Missed" : "Present"}
        </Button>
      ) : (
        <Badge
          className={
            attended
              ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
              : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
          }
        >
          {attended ? "Present" : "Missed"}
        </Badge>
      )}
    </Card>
  );
}