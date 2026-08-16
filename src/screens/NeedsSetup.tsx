import { Database } from "lucide-react";

export default function NeedsSetup() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cream px-6 text-center dark:bg-zinc-950">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-forest text-gold">
        <Database className="size-8" />
      </div>
      <h1 className="text-lg font-bold text-ink dark:text-zinc-100">
        Supabase isn't connected yet
      </h1>
      <p className="max-w-sm text-sm text-zinc-500">
        Create a <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env</code> file at the
        project root with your project URL and anon key, then restart the dev
        server. See <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.example</code> and
        the README for the full setup steps.
      </p>
    </div>
  );
}