import { useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardCheck,
  KeyRound,
  LogOut,
  QrCode,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { Alert, Button, Field, Input, cn } from "./ui";
import type { NotificationRow, Profile, Role } from "../lib/types";

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-forest">
      <img src="/logo-dark.svg" alt="RHS Band" className="h-56 w-auto" />
      <p className="text-sm font-semibold text-white/80">Band Attendance</p>
      <div className="loader" role="status" aria-label="Loading">
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className="orbe"
            style={{ "--index": index } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forced password change — shown when the director added this member and
/* must_change_password is still true. The rest of the app is unreachable until
/* they set their own password and the flag is cleared.                       */
/* -------------------------------------------------------------------------- */
function ForcePasswordChange({
  profile,
  refreshProfile,
}: {
  profile: Profile;
  refreshProfile: () => Promise<void>;
}) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw1.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error: uErr } = await supabase.auth.updateUser({ password: pw1 });
    if (uErr) {
      setError(uErr.message);
      setBusy(false);
      return;
    }
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", profile.id);
    setBusy(false);
    if (pErr) {
      setError(pErr.message);
      return;
    }
    setPw1("");
    setPw2("");
    await refreshProfile();
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-forest px-6 py-10 dark:bg-forest-deep">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="mb-4 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gold/15">
            <KeyRound className="size-6 text-gold" />
          </div>
          <h1 className="text-lg font-black text-ink dark:text-zinc-100">
            Set your own password
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Hi {profile.display_name || profile.full_name}! You're using a
            temporary password — choose a new one before you continue.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password">
            <Input
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              autoFocus
            />
          </Field>
          <Field label="Repeat new password">
            <Input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" size="lg" loading={busy} className="w-full">
            Save password
          </Button>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="w-full text-center text-xs font-semibold text-zinc-400 hover:text-forest dark:hover:text-moss"
          >
            <LogOut className="mr-1 inline size-3.5" /> Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* In-app notification bell — realtime, with an unread badge.                  */
/* -------------------------------------------------------------------------- */
function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function NotificationBell({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const [notifs, setNotifs] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) setNotifs((data as NotificationRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  // Realtime: new notifications + read-state changes stream in.
  useEffect(() => {
    const channel = supabase
      .channel(`notifs-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setNotifs((prev) =>
              [payload.new as NotificationRow, ...prev].slice(0, 50)
            );
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as NotificationRow;
            setNotifs((prev) =>
              prev.map((n) => (n.id === updated.id ? updated : n))
            );
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id]);

  const unreadCount = notifs.filter((n) => !n.read).length;

  function markAllRead() {
    const ids = notifs.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    void supabase.from("notifications").update({ read: true }).in("id", ids);
    setNotifs((prev) =>
      prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n))
    );
  }

  function openNotification(n: NotificationRow) {
    setOpen(false);
    if (n.type === "new_event") navigate("/calendar");
    else if (n.type === "checkin_open") navigate("/checkin");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5 dark:border-white/10">
              <p className="text-sm font-bold text-ink dark:text-zinc-100">
                Notifications
              </p>
              <button
                onClick={markAllRead}
                className="text-xs font-semibold text-zinc-400 hover:text-forest dark:hover:text-moss"
              >
                Mark all read
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {notifs.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-zinc-400">
                  No notifications yet.
                </p>
              ) : (
                notifs.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-cream dark:hover:bg-zinc-800",
                      !n.read && "bg-moss/30 dark:bg-forest/20"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink dark:text-zinc-100">
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {n.body}
                      </p>
                      <p className="mt-1 text-[10px] font-semibold uppercase text-zinc-400">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const TABS: { to: string; label: string; icon: typeof CalendarDays; roles: Role[] }[] =
  [
    { to: "/", label: "Calendar", icon: CalendarDays, roles: ["student", "section_leader", "secretary", "director"] },
    { to: "/checkin", label: "Check-In", icon: QrCode, roles: ["student", "section_leader", "secretary", "director"] },
    { to: "/attendance", label: "Attendance", icon: ClipboardCheck, roles: ["student", "section_leader", "secretary", "director"] },
    { to: "/roster", label: "Roster", icon: Users, roles: ["section_leader", "director"] },
    { to: "/analytics", label: "Analytics", icon: BarChart3, roles: ["director"] },
    { to: "/profile", label: "Profile", icon: User, roles: ["student", "section_leader", "secretary", "director"] },
  ];

export default function AppShell() {
  const { session, profile, loading, refreshProfile } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Splash />;
  }

  if (!session) {
    const from = location.pathname + location.search;
    return <Navigate to="/welcome" replace state={{ from }} />;
  }

  // Signed in but not on the roster (e.g. the director removed them).
  if (!profile) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cream px-6 text-center dark:bg-zinc-950">
        <h1 className="text-lg font-bold text-ink dark:text-zinc-100">
          Not on the roster
        </h1>
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
          Your account isn't linked to the band roster. Ask your director to
          add you, or sign in with a different account.
        </p>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-mid"
        >
          Sign out
        </button>
      </div>
    );
  }

  // Signed in with a director-issued temporary password → force a change
  // before any other screen is reachable.
  if (profile.must_change_password) {
    return (
      <ForcePasswordChange
        profile={profile}
        refreshProfile={refreshProfile}
      />
    );
  }

  // Deactivated by the director (soft-delete): block the app even if a
  // session outlived the deactivation.
  if (profile.deactivated) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cream px-6 text-center dark:bg-zinc-950">
        <h1 className="text-lg font-bold text-ink dark:text-zinc-100">
          Account deactivated
        </h1>
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
          Your account has been deactivated by the director. Contact them if
          you think this is a mistake.
        </p>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-mid"
        >
          Sign out
        </button>
      </div>
    );
  }

  const tabs = TABS.filter((t) =>
    t.roles.some((r) => profile.roles.includes(r))
  );

  return (
    <div className="flex h-dvh flex-col bg-cream dark:bg-zinc-950">
      {/* Top bar with notification bell */}
      <header className="shrink-0 border-b border-black/5 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95">
        <div className="mx-auto flex h-32 w-full max-w-3xl items-center justify-between px-4">
          <img
            src="/logo-light.svg"
            alt="RHS Band"
            className="h-28 w-auto dark:hidden"
          />
          <img
            src="/logo-dark.svg"
            alt="RHS Band"
            className="hidden h-28 w-auto dark:block"
          />
          <NotificationBell profile={profile} />
        </div>
      </header>

      {/* Content scrolls; the tab bar stays pinned to the bottom */}
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="mx-auto h-full w-full max-w-3xl">
          <Outlet context={{ profile, refreshProfile }} />
        </div>
      </main>

      {/* Bottom tab bar */}
      <nav className="shrink-0 border-t border-black/5 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95">
        <div className="mx-auto w-full max-w-3xl">
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
          >
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 text-[10px] font-semibold",
                    isActive
                      ? "text-forest dark:text-gold"
                      : "text-zinc-400 dark:text-zinc-500"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full transition-colors",
                        isActive &&
                          "bg-moss text-forest dark:bg-forest/40 dark:text-gold"
                      )}
                    >
                      <tab.icon className="size-[18px]" strokeWidth={2.2} />
                    </span>
                    {tab.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}