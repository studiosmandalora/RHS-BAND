import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarDays,
  ClipboardCheck,
  MessageSquare,
  QrCode,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { cn } from "./ui";
import type { Role } from "../lib/types";

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-forest">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-white/10 text-2xl font-black text-gold ring-1 ring-white/20">
        RHS
      </div>
      <p className="text-sm font-semibold text-white/80">Band Attendance</p>
      <div className="size-2 animate-pulse rounded-full bg-gold" />
    </div>
  );
}

const TABS: { to: string; label: string; icon: typeof CalendarDays; roles: Role[] }[] =
  [
    { to: "/", label: "Calendar", icon: CalendarDays, roles: ["student", "section_leader", "director"] },
    { to: "/checkin", label: "Check-In", icon: QrCode, roles: ["student", "section_leader", "director"] },
    { to: "/attendance", label: "Attendance", icon: ClipboardCheck, roles: ["student", "section_leader", "director"] },
    { to: "/chat", label: "Chat", icon: MessageSquare, roles: ["student", "section_leader", "director"] },
    { to: "/roster", label: "Roster", icon: Users, roles: ["section_leader", "director"] },
    { to: "/profile", label: "Profile", icon: User, roles: ["student", "section_leader", "director"] },
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

  const role = profile.role;
  const tabs = TABS.filter((t) => t.roles.includes(role));

  return (
    <div className="min-h-dvh bg-zinc-200 dark:bg-black md:flex md:items-stretch md:justify-center md:py-6">
      <div className="relative flex w-full max-w-[430px] flex-col overflow-hidden bg-cream dark:bg-zinc-950 md:min-h-[min(880px,calc(100dvh-3rem))] md:rounded-[2.2rem] md:shadow-2xl md:ring-1 md:ring-black/10 dark:md:ring-white/10">
        {/* Content scrolls inside the phone frame */}
        <main className="flex-1 overflow-y-auto overscroll-contain">
          <Outlet context={{ profile, refreshProfile }} />
        </main>

        {/* Bottom tab bar */}
        <nav className="shrink-0 border-t border-black/5 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95">
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
        </nav>
      </div>
    </div>
  );
}