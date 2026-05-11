import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const clearInvalidSession = async () => {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // noop — local cleanup is best effort only
      }

      if (!active) return;
      setSession(null);
      setLoading(false);
    };

    // CRITICAL: register listener BEFORE getSession to avoid race
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;

      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && !newSession?.user?.id) {
        void clearInvalidSession();
        return;
      }

      setSession(newSession);
      setLoading(false);
    });

    void supabase.auth
      .getSession()
      .then(async ({ data: { session: existing }, error }) => {
        if (error) throw error;

        if (!existing?.access_token) {
          if (!active) return;
          setSession(null);
          setLoading(false);
          return;
        }

        const { data: userData, error: userError } = await supabase.auth.getUser(existing.access_token);

        if (userError || !userData.user?.id) {
          console.warn("[auth] invalid cached session cleared", userError?.message ?? "missing user id");
          await clearInvalidSession();
          return;
        }

        if (!active) return;
        setSession(existing);
        setLoading(false);
      })
      .catch(async (error) => {
        console.warn("[auth] failed to restore session", error);
        await clearInvalidSession();
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
