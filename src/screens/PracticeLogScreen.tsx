import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Clock,
  Music,
  Plus,
  Timer,
  Trash2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { PracticeLogRow, Profile } from "../lib/types";
import { INSTRUMENTS, PRACTICE_CATEGORIES } from "../lib/constants";
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
} from "../components/ui";
import { Avatar } from "../components/Avatar";

export default function PracticeLogScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();

  const [logs, setLogs] = useState<PracticeLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [instrument, setInstrument] = useState(profile.instrument || "");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");

  const isDirector = profile.roles.includes("director");
  const isStaff = profile.roles.includes("director") || profile.roles.includes("section_leader");

  // All profiles for director view
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    void loadLogs();
  }, [profile.id]);

  async function loadLogs() {
    setLoading(true);
    let query = supabase
      .from("practice_logs")
      .select("*")
      .order("date", { ascending: false });

    // Directors see all practice logs; others see only their own
    if (!isDirector) {
      query = query.eq("owner_id", profile.id);
    }

    const { data } = await query;
    setLogs((data as PracticeLogRow[]) ?? []);

    // Load profiles for director view
    if (isDirector) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .order("display_name");
      setProfiles((profileData as Profile[]) ?? []);
    }
    setLoading(false);
  }

  // Stats (only for own logs)
  const myLogs = useMemo(() => {
    return logs.filter((l) => l.owner_id === profile.id);
  }, [logs, profile.id]);

  const stats = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisWeek = myLogs.filter(
      (l) => new Date(l.date) >= weekStart
    ).reduce((sum, l) => sum + l.duration_minutes, 0);
    const thisMonth = myLogs.filter(
      (l) => new Date(l.date) >= monthStart
    ).reduce((sum, l) => sum + l.duration_minutes, 0);
    const totalSessions = myLogs.length;

    return { thisWeek, thisMonth, totalSessions };
  }, [myLogs]);

  // Group logs by student for director view
  const logsByStudent = useMemo(() => {
    if (!isDirector) return [];
    const map = new Map<string, PracticeLogRow[]>();
    for (const log of logs) {
      const existing = map.get(log.owner_id) ?? [];
      existing.push(log);
      map.set(log.owner_id, existing);
    }
    return Array.from(map.entries())
      .map(([ownerId, studentLogs]) => {
        const prof = profiles.find((p) => p.id === ownerId);
        const totalMinutes = studentLogs.reduce((s, l) => s + l.duration_minutes, 0);
        return {
          ownerId,
          name: prof?.display_name || prof?.full_name || "Unknown",
          instrument: prof?.instrument || "",
          avatarUrl: prof?.avatar_url || "",
          logs: studentLogs,
          totalMinutes,
          totalSessions: studentLogs.length,
        };
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [logs, profiles, isDirector]);

  async function submitLog(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (duration <= 0 || duration > 480) {
      setFormError("Practice duration must be between 1 and 480 minutes.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("practice_logs").insert({
      owner_id: profile.id,
      instrument: instrument || profile.instrument || "",
      date,
      duration_minutes: duration,
      notes: notes.trim(),
      category,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setShowForm(false);
    resetForm();
    void loadLogs();
  }

  function resetForm() {
    setInstrument(profile.instrument || "");
    setDate(new Date().toISOString().split("T")[0]);
    setDuration(30);
    setNotes("");
    setCategory("");
  }

  async function deleteLog(id: string) {
    if (!window.confirm("Delete this practice log entry?")) return;
    await supabase.from("practice_logs").delete().eq("id", id);
    void loadLogs();
  }

  function formatMinutes(mins: number): string {
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  return (
    <div className="px-4 pb-6 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-ink dark:text-zinc-100">
            Practice Log
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {isDirector ? "View your students' practice logs" : "Track your practice sessions"}
          </p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="size-4" /> Log practice
        </Button>
      </div>

      {/* Stats cards (own logs only) */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Card className="p-3 text-center">
          <Timer className="mx-auto mb-1 size-5 text-gold" />
          <p className="text-lg font-black text-ink dark:text-zinc-100">
            {formatMinutes(stats.thisWeek)}
          </p>
          <p className="text-[10px] font-semibold uppercase text-zinc-400">
            This week
          </p>
        </Card>
        <Card className="p-3 text-center">
          <Clock className="mx-auto mb-1 size-5 text-forest" />
          <p className="text-lg font-black text-ink dark:text-zinc-100">
            {formatMinutes(stats.thisMonth)}
          </p>
          <p className="text-[10px] font-semibold uppercase text-zinc-400">
            This month
          </p>
        </Card>
        <Card className="p-3 text-center">
          <Music className="mx-auto mb-1 size-5 text-purple-500" />
          <p className="text-lg font-black text-ink dark:text-zinc-100">
            {stats.totalSessions}
          </p>
          <p className="text-[10px] font-semibold uppercase text-zinc-400">
            Sessions
          </p>
        </Card>
      </div>

      {/* Log list */}
      {loading ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-16 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<Timer className="size-6" />}
          title="No practice logged yet"
          subtitle={isDirector ? "Your students haven't logged any practice yet." : "Start logging your practice sessions to track your progress."}
        />
      ) : isDirector ? (
        /* Director view: grouped by student */
        <div className="space-y-4">
          {logsByStudent.map((student) => (
            <Card key={student.ownerId} className="p-4">
              <div className="mb-3 flex items-center gap-3">
                <Avatar name={student.name} url={student.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink dark:text-zinc-100">
                    {student.name}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {student.instrument || "No section"} · {student.totalSessions} session{student.totalSessions === 1 ? "" : "s"} · {formatMinutes(student.totalMinutes)} total
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                {student.logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="flex items-center gap-3 rounded-xl bg-cream/50 px-3 py-2 dark:bg-zinc-800/50">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-moss text-forest dark:bg-forest/40 dark:text-moss">
                      <Timer className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-ink dark:text-zinc-100">
                          {formatMinutes(log.duration_minutes)}
                        </p>
                        {log.category && (
                          <Badge className="bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-300">
                            {log.category}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        {new Date(log.date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                      {log.notes && (
                        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">
                          {log.notes}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {student.logs.length > 5 && (
                  <p className="text-center text-[11px] text-zinc-400">
                    +{student.logs.length - 5} more session{student.logs.length - 5 === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        /* Student/section leader view: own logs */
        <div className="space-y-2">
          {logs.map((log) => (
            <Card key={log.id} className="flex items-center gap-3 p-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-moss text-forest dark:bg-forest/40 dark:text-moss">
                <Timer className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-ink dark:text-zinc-100">
                    {formatMinutes(log.duration_minutes)}
                  </p>
                  {log.instrument && (
                    <Badge className="bg-moss text-forest dark:bg-forest/40 dark:text-moss">
                      {log.instrument}
                    </Badge>
                  )}
                  {log.category && (
                    <Badge className="bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-300">
                      {log.category}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-zinc-400">
                  {new Date(log.date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                {log.notes && (
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
                    {log.notes}
                  </p>
                )}
              </div>
              <button
                onClick={() => void deleteLog(log.id)}
                className="rounded-full p-2 text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                aria-label="Delete log"
              >
                <Trash2 className="size-4" />
              </button>
            </Card>
          ))}
        </div>
      )}

      {/* Add practice log modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Log practice"
      >
        <form onSubmit={submitLog} className="space-y-4">
          <Field label="Instrument">
            <Select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
              <option value="">—</option>
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Duration (minutes)">
            <Input
              type="number"
              min={1}
              max={480}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </Field>
          <Field label="Category (optional)">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              {PRACTICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you practice?"
            />
          </Field>
          {formError && <Alert tone="error">{formError}</Alert>}
          <Button type="submit" size="lg" loading={saving} className="w-full">
            Save practice log
          </Button>
        </form>
      </Modal>
    </div>
  );
}
