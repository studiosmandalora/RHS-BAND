import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarDays,
  ClipboardCheck,
  KeyRound,
  LogOut,
  MessageSquare,
  QrCode,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { Alert, Button, Field, Input, cn } from "./ui";
import type { Profile, Role } from "../lib/types";

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

  const role = profile.role;
  const tabs = TABS.filter((t) => t.roles.includes(role));

  return (
    <div className="flex h-dvh flex-col bg-cream dark:bg-zinc-950">
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