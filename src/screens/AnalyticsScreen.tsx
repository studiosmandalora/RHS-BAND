import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  BarChart3,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { AttendanceRow, EventRow, Profile } from "../lib/types";
import { endOfDay, relativeDay } from "../lib/date";
import {
  getEventTypeChip,
  getEventTypeLabel,
} from "../lib/constants";
import { Badge, Card, EmptyState, cn } from "../components/ui";

interface SectionStats {
  section: string;
  member_count: number;
  avg_attendance_pct: number;
}

interface EventTrend {
  id: string;
  name: string;
  type: string;
  date: string;
  event_type: string;
  roster_size: number;
  present_count: number;
  excused_count: number;
  late_count: number;
}

export default function AnalyticsScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const isDirector = profile.roles.includes("director");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [sectionStats, setSectionStats] = useState<SectionStats[]>([]);
  const [trend, setTrend] = useState<EventTrend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isDirector) return;
    void loadData();
  }, [isDirector]);

  async function loadData() {
    setLoading(true);
    const [ev, pr, rec] = await Promise.all([
      supabase.from("events").select("*").order("date", { ascending: true }),
      supabase.from("profiles").select("*").order("display_name"),
      supabase.from("attendance_records").select("*"),
    ]);
    setEvents((ev.data as EventRow[]) ?? []);
    setProfiles((pr.data as Profile[]) ?? []);
    setRecords((rec.data as AttendanceRow[]) ?? []);

    // Load section stats and trend via RPCs
    const [sectionRes, trendRes] = await Promise.all([
      supabase.rpc("get_section_attendance_stats"),
      supabase.rpc("get_attendance_trend", { p_limit: 10 }),
    ]);
    setSectionStats((sectionRes.data as SectionStats[]) ?? []);
    setTrend((trendRes.data as EventTrend[]) ?? []);
    setLoading(false);
  }

  // Past required events
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

  // Overall stats
  const overallStats = useMemo(() => {
    const roster = profiles.filter(
      (p) => p.roles.includes("student") || p.roles.includes("section_leader")
    );
    const totalStudents = roster.length;
    const totalEvents = pastEvents.length;

    // Count across all past required events
    let totalPresent = 0;
    let totalLate = 0;
    let totalExcused = 0;
    let totalAbsent = 0;

    for (const ev of pastEvents) {
      for (const student of roster) {
        const rec = records.find(
          (r) => r.event_id === ev.id && r.student_id === student.id
        );
        if (!rec || rec.status === "absent") totalAbsent++;
        else if (rec.status === "present") totalPresent++;
        else if (rec.status === "late") totalLate++;
        else if (rec.status === "excused") totalExcused++;
      }
    }

    const overallPct =
      totalStudents > 0 && totalEvents > 0
        ? Math.round((totalPresent / (totalStudents * totalEvents)) * 100)
        : 0;

    return {
      totalStudents,
      totalEvents,
      totalPresent,
      totalLate,
      totalExcused,
      totalAbsent,
      overallPct,
    };
  }, [profiles, pastEvents, records]);

  // Attendance by event type
  const byEventType = useMemo(() => {
    const map = new Map<string, { total: number; present: number }>();
    for (const ev of pastEvents) {
      const type = ev.event_type || ev.type;
      const existing = map.get(type) ?? { total: 0, present: 0 };
      const eventRecs = records.filter((r) => r.event_id === ev.id);
      existing.total += eventRecs.length;
      existing.present += eventRecs.filter(
        (r) => r.attended && r.status !== "excused"
      ).length;
      map.set(type, existing);
    }
    return Array.from(map.entries())
      .map(([type, stats]) => ({
        type,
        pct: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0,
        count: stats.total,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [pastEvents, records]);

  if (!isDirector) {
    return (
      <div className="px-4 pb-6 pt-5">
        <EmptyState
          icon={<BarChart3 className="size-6" />}
          title="Director access only"
          subtitle="Analytics are available to directors and staff."
        />
      </div>
    );
  }

  return (
    <div className="px-4 pb-6 pt-5">
      <div className="mb-4">
        <h1 className="text-xl font-black text-ink dark:text-zinc-100">
          Analytics
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Band attendance overview and trends
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ) : (
        <>
          {/* Overall stats */}
          <Card className="mb-4 p-5">
            <h2 className="mb-3 text-sm font-bold text-ink dark:text-zinc-100">
              Overall Attendance
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-moss/50 p-3 text-center dark:bg-forest/20">
                <p className="text-2xl font-black text-forest dark:text-moss">
                  {overallStats.overallPct}%
                </p>
                <p className="text-[10px] font-semibold uppercase text-forest/70 dark:text-moss/70">
                  Present
                </p>
              </div>
              <div className="rounded-xl bg-red-50 p-3 text-center dark:bg-red-950/30">
                <p className="text-2xl font-black text-red-600 dark:text-red-300">
                  {overallStats.totalAbsent}
                </p>
                <p className="text-[10px] font-semibold uppercase text-red-500">
                  Absent
                </p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-center dark:bg-amber-950/30">
                <p className="text-2xl font-black text-amber-600 dark:text-amber-300">
                  {overallStats.totalExcused}
                </p>
                <p className="text-[10px] font-semibold uppercase text-amber-500">
                  Excused
                </p>
              </div>
              <div className="rounded-xl bg-orange-50 p-3 text-center dark:bg-orange-950/30">
                <p className="text-2xl font-black text-orange-600 dark:text-orange-300">
                  {overallStats.totalLate}
                </p>
                <p className="text-[10px] font-semibold uppercase text-orange-500">
                  Late
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>{overallStats.totalStudents} students</span>
              <span>{overallStats.totalEvents} required events</span>
            </div>
          </Card>

          {/* Section attendance */}
          {sectionStats.length > 0 && (
            <Card className="mb-4 p-5">
              <h2 className="mb-3 text-sm font-bold text-ink dark:text-zinc-100">
                Section Attendance
              </h2>
              <div className="space-y-2">
                {sectionStats.map((s) => (
                  <div
                    key={s.section}
                    className="flex items-center gap-3 rounded-xl bg-cream/50 px-3 py-2 dark:bg-zinc-800/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink dark:text-zinc-100">
                        {s.section}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {s.member_count} student{s.member_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            s.avg_attendance_pct >= 80
                              ? "bg-forest"
                              : s.avg_attendance_pct >= 50
                                ? "bg-gold"
                                : "bg-red-500"
                          )}
                          style={{ width: `${s.avg_attendance_pct}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-black",
                          s.avg_attendance_pct >= 80
                            ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
                            : s.avg_attendance_pct >= 50
                              ? "bg-gold/15 text-gold-deep dark:text-gold"
                              : "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300"
                        )}
                      >
                        {s.avg_attendance_pct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Attendance by event type */}
          {byEventType.length > 0 && (
            <Card className="mb-4 p-5">
              <h2 className="mb-3 text-sm font-bold text-ink dark:text-zinc-100">
                By Event Type
              </h2>
              <div className="space-y-2">
                {byEventType.map(({ type, pct }) => (
                  <div
                    key={type}
                    className="flex items-center gap-3 rounded-xl bg-cream/50 px-3 py-2 dark:bg-zinc-800/50"
                  >
                    <Badge className={getEventTypeChip(type)}>
                      {getEventTypeLabel(type)}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            pct >= 80 ? "bg-forest" : pct >= 50 ? "bg-gold" : "bg-red-500"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-bold text-zinc-500">{pct}%</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Recent event trend */}
          {trend.length > 0 && (
            <Card className="mb-4 p-5">
              <h2 className="mb-3 text-sm font-bold text-ink dark:text-zinc-100">
                Recent Events (Last 10)
              </h2>
              <div className="space-y-2">
                {trend.map((ev) => {
                  const pct =
                    ev.roster_size > 0
                      ? Math.round((ev.present_count / ev.roster_size) * 100)
                      : 0;
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 rounded-xl bg-cream/50 px-3 py-2 dark:bg-zinc-800/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink dark:text-zinc-100">
                          {ev.name}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {relativeDay(ev.date)} · {getEventTypeLabel(ev.event_type || ev.type)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {ev.late_count > 0 && (
                          <Badge className="bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300">
                            {ev.late_count} late
                          </Badge>
                        )}
                        {ev.excused_count > 0 && (
                          <Badge className="bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
                            {ev.excused_count} excused
                          </Badge>
                        )}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-black",
                            pct >= 80
                              ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
                              : pct >= 50
                                ? "bg-gold/15 text-gold-deep dark:text-gold"
                                : "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300"
                          )}
                        >
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
