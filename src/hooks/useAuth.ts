import { useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;

    async function load(userId: string | null | undefined) {
      if (!userId) {
        if (!cancelled) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle<Profile>();
      if (!cancelled) {
        setProfile((data as Profile) ?? null);
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      void load(data.session?.user.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      void load(nextSession?.user.id ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

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