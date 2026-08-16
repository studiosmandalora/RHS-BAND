import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Music } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { demoAccounts, INSTRUMENTS } from "../lib/constants";
import { Alert, Button, Field, Input, Select } from "../components/ui";

type Mode = "signin" | "signup";

export default function WelcomeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();

  // Already signed in? Skip the auth screen.
  if (session) {
    return <Navigate to="/" replace />;
  }
  const from =
    (location.state as { from?: string } | null)?.from ?? "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [instrument, setInstrument] = useState<string>(INSTRUMENTS[0]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate(from, { replace: true });
      } else {
        if (!fullName.trim()) {
          setError("Please enter your full name.");
          setBusy(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: fullName.trim(),
              instrument,
            },
          },
        });
        if (error) throw error;
        if (data.session) {
          // Email confirmation disabled → straight in.
          navigate(from, { replace: true });
        } else {
          setNotice(
            "Account created! Check your email to confirm, then sign in."
          );
          setMode("signin");
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setBusy(false);
    }
  }

  function quickFill(em: string) {
    setEmail(em);
    setPassword("band1234");
    setMode("signin");
    setError(null);
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-forest dark:bg-forest-deep">
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-mid/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-gold/20 blur-3xl" />

      <div className="relative z-10 flex flex-1 flex-col px-6 pb-8 pt-14">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <Music className="size-8 text-gold" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              RHS Band Attendance
            </h1>
            <p className="mt-1 text-sm font-medium text-white/70">
              Check in, track attendance, and chat by section.
            </p>
          </div>
        </div>

        <div className="w-full max-w-sm self-center rounded-3xl bg-white p-5 shadow-xl dark:bg-zinc-900">
          {/* mode toggle */}
          <div className="mb-5 grid grid-cols-2 rounded-full bg-cream p-1 dark:bg-zinc-800">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={
                  "min-h-9 rounded-full text-sm font-semibold transition-colors " +
                  (mode === m
                    ? "bg-forest text-white shadow dark:bg-mid"
                    : "text-zinc-500 dark:text-zinc-400")
                }
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <Field label="Full name">
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Jamie Rivera"
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@rhsband.org"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </Field>
            {mode === "signup" && (
              <Field label="Instrument / section">
                <Select
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                >
                  {INSTRUMENTS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {error && <Alert tone="error">{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}

            <Button
              type="submit"
              size="lg"
              loading={busy}
              className="w-full"
            >
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>

        {/* demo accounts */}
        <details className="mt-6 w-full max-w-sm self-center rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
          <summary className="cursor-pointer text-sm font-semibold text-white/90">
            Demo accounts (password: band1234)
          </summary>
          <div className="mt-3 space-y-1.5">
            {demoAccounts().map((acc) => (
              <button
                key={acc.email}
                onClick={() => quickFill(acc.email)}
                className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/10"
              >
                <span className="font-mono">{acc.email}</span>
                <span className="shrink-0 text-white/60">{acc.note}</span>
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}