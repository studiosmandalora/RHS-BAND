import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

export interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  async function refreshProfile() {
    setTick((t) => t + 1);
  }

  const loadProfile = useCallback(
    async (userId: string | null | undefined) => {
      if (!userId) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle<Profile>();
      setProfile((data as Profile) ?? null);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      void loadProfile(data.session?.user.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      void loadProfile(nextSession?.user.id ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // When the app is restored from the back/forward cache or returns to the
  // foreground (e.g. it was suspended on the home screen), re-sync the session
  // and profile so it doesn't come back with a stale or expired token.
  useEffect(() => {
    function resync() {
      if (document.visibilityState !== "visible") return;
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        void loadProfile(data.session?.user.id ?? null);
      });
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) resync();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") resync();
    }

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadProfile]);

  // Re-fetch the profile row when asked (e.g. after an edit).
  useEffect(() => {
    const uid = session?.user.id;
    if (tick === 0 || !uid) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle<Profile>()
      .then(({ data }) => {
        if (!cancelled) setProfile((data as Profile) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [tick, session?.user.id]);

  return { session, profile, loading, refreshProfile };
}