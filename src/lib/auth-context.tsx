import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiClient, ApiError } from "@/lib/api-client";

export type Profile = {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  availability: string;
  isSuperAdmin: boolean;
  createdAt: string;
};

export type Membership = { accountId: string; role: "admin" | "agent" } | null;

type AuthContextValue = {
  // `session`/`user` point at the same profile — kept as two fields only to
  // avoid touching every call site that checks `session` truthiness vs.
  // reads `user.id`/`user.email` (carried over from the Supabase-backed
  // shape this replaces).
  session: Profile | null;
  user: Profile | null;
  membership: Membership;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<Membership>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const data = await apiClient.get<{ profile: Profile; membership: Membership }>("/auth/me");
      setProfile(data.profile);
      setMembership(data.membership);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        console.warn("[auth] failed to load session", error);
      }
      setProfile(null);
      setMembership(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value: AuthContextValue = {
    session: profile,
    user: profile,
    membership,
    loading,
    refresh,
    signOut: async () => {
      try {
        await apiClient.post("/auth/logout");
      } finally {
        setProfile(null);
        setMembership(null);
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
