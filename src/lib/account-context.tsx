import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type AccountContextValue = {
  accountId: string | null;
  role: "admin" | "agent" | null;
  loading: boolean;
};

const AccountContext = createContext<AccountContextValue | undefined>(undefined);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "agent" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAccountId(null);
      setRole(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const { data: au, error: accountError } = await supabase
          .from("account_users")
          .select("account_id")
          .eq("user_id", user!.id)
          .limit(1)
          .maybeSingle();

        if (accountError) throw accountError;

        if (cancelled || !au) {
          if (!cancelled) {
            setAccountId(null);
            setRole(null);
            setLoading(false);
          }
          return;
        }

        const { data: ur, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("account_id", au.account_id)
          .limit(1)
          .maybeSingle();

        if (roleError) throw roleError;

        if (!cancelled) {
          setAccountId(au.account_id);
          setRole(ur?.role ?? "agent");
          setLoading(false);
        }
      } catch (error) {
        console.error("[account-context] failed to resolve workspace", error);
        if (!cancelled) {
          setAccountId(null);
          setRole(null);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <AccountContext.Provider value={{ accountId, role, loading }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount deve ser usado dentro de <AccountProvider>");
  return ctx;
}
