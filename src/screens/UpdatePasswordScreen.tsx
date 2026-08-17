import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { Alert, Button, Field, Input } from "../components/ui";

export default function UpdatePasswordScreen() {
  const navigate = useNavigate();
  const { session, profile, loading, refreshProfile } = useAuth();

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    // If the account was flagged for a forced change, clear the flag now that
    // a real password is set.
    if (profile) {
      await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", profile.id);
      await refreshProfile();
    }
    setBusy(false);
    setNotice("Password updated.");
    setTimeout(() => navigate("/", { replace: true }), 900);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-forest px-6 py-10 dark:bg-forest-deep">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="mb-4 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gold/15">
            <KeyRound className="size-6 text-gold" />
          </div>
          <h1 className="text-lg font-black text-ink dark:text-zinc-100">
            Choose a new password
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Enter a new password for your account.
          </p>
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-zinc-400">
            Checking your reset link…
          </p>
        ) : session ? (
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
            {notice && <Alert tone="success">{notice}</Alert>}
            <Button type="submit" size="lg" loading={busy} className="w-full">
              Save new password
            </Button>
          </form>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              This reset link is invalid or has expired. You can request a new
              one from the sign-in screen.
            </p>
            <Link
              to="/welcome"
              className="inline-block rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-mid"
            >
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
