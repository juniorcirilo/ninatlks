import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";

type AccountContextValue = {
  accountId: string | null;
  role: "admin" | "agent" | null;
  loading: boolean;
};

const AccountContext = createContext<AccountContextValue | undefined>(undefined);

export function AccountProvider({ children }: { children: ReactNode }) {
  // membership already comes bundled with /auth/me (see auth-context.tsx) —
  // no separate query needed here anymore.
  const { membership, loading } = useAuth();

  const value: AccountContextValue = {
    accountId: membership?.accountId ?? null,
    role: membership?.role ?? null,
    loading,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount deve ser usado dentro de <AccountProvider>");
  return ctx;
}
