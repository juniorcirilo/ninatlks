import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAccount } from "@/lib/account-context";
import {
  dismissOnboarding,
  getOnboardingState,
  isOnboardingTrulyComplete,
  type OnboardingState,
} from "@/lib/onboarding";
import { OnboardingWizard } from "./OnboardingWizard";

/**
 * Mostra o wizard de configuração apenas UMA VEZ — no primeiro login do
 * admin do workspace primário. Se ele fechar/concluir, gravamos
 * `org_onboarding_state.dismissed_at` no banco e o wizard nunca mais reaparece
 * automaticamente. O admin pode reabrir manualmente em /configuracoes.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { accountId, role, loading: accountLoading } = useAccount();
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accountLoading || !accountId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getOnboardingState(accountId).then((state) => {
      if (!cancelled) {
        setOnboarding(state);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, accountLoading]);

  if (loading || accountLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Mostra só se: é admin, não foi dispensado, e não foi truly completed.
  const trulyComplete = isOnboardingTrulyComplete(onboarding);
  const shouldShow =
    role === "admin" &&
    onboarding &&
    !onboarding.dismissed_at &&
    !trulyComplete;

  if (shouldShow && accountId) {
    return (
      <OnboardingWizard
        state={onboarding}
        onComplete={async () => {
          // Marca dispensado de forma persistente — não reabre mais sozinho.
          try {
            await dismissOnboarding(accountId);
          } catch (err) {
            console.error("[onboarding-gate] failed to dismiss:", err);
          }
          setOnboarding({
            ...onboarding,
            dismissed_at: new Date().toISOString(),
          });
        }}
      />
    );
  }

  return <>{children}</>;
}
