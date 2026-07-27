import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/lib/auth-context";
import { AccountProvider } from "@/lib/account-context";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { RouteErrorBoundary } from "@/components/layout/RouteErrorBoundary";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  errorComponent: ({ error, reset }) => (
    <div className="min-h-screen bg-background">
      <RouteErrorBoundary error={error} reset={reset} />
    </div>
  ),
});

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
    }
  }, [session, loading, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AccountProvider>
      <OnboardingGate>
        <AppShell>
          <Outlet />
        </AppShell>
      </OnboardingGate>
    </AccountProvider>
  );
}
