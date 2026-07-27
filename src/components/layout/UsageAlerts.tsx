// Discreet banner that warns when Twilio balance is low or ElevenLabs
// char usage is over 90%. Renders once (not per page). Dismissable per
// session — comes back if the numbers change for the worse.
//
// Cheapest possible: piggy-backs on the /settings Integrações dashboard
// endpoint integrations-status. Polls every 10 minutes.

import { useEffect, useState } from "react";
import { AlertTriangle, X, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";
import { fetchIntegrationsStatus, type IntegrationsStatusReport } from "@/lib/integrations-status-cache";

type Severity = "warning" | "critical";
interface Alert {
  key: string;
  severity: Severity;
  message: string;
  href?: string;
}

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const DISMISS_STORAGE_KEY = "usage-alerts:dismissed";

export function UsageAlerts() {
  const { accountId } = useAccount();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const data = await fetchIntegrationsStatus(accountId, { ttlMs: POLL_INTERVAL_MS });
        if (cancelled || !data) return;
        setAlerts(computeAlerts(data));
      } catch {
        // Silent — if the endpoint is down, we just don't show alerts.
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [accountId]);

  const visible = alerts.filter((a) => !dismissed.has(a.key));
  if (visible.length === 0) return null;

  // Show highest severity first, one banner at a time to avoid noise.
  const alert = visible.sort((a, b) => (a.severity === "critical" ? -1 : 1))[0];

  const handleDismiss = () => {
    const next = new Set(dismissed);
    next.add(alert.key);
    setDismissed(next);
    persistDismissed(next);
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-40 flex items-center gap-2 border-b px-4 py-2 text-[12px]",
        alert.severity === "critical"
          ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-200"
          : "border-amber-500/30 bg-amber-500/[0.08] text-amber-200",
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{alert.message}</span>
      {alert.href && (
        <Link to={alert.href} className="inline-flex items-center gap-1 underline hover:no-underline">
          resolver <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dispensar"
        className="text-current opacity-60 hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function computeAlerts(data: IntegrationsStatusReport): Alert[] {
  const alerts: Alert[] = [];
  const providers = data.providers ?? [];

  // Twilio balance
  const twilio = providers.find((p) => p.key === "twilio");
  if (twilio?.configured && twilio.ok) {
    const raw = String(twilio.usage?.saldo ?? "");
    const match = raw.match(/([\d.]+)/);
    const bal = match ? parseFloat(match[1]) : NaN;
    if (!Number.isNaN(bal)) {
      if (bal < 2) {
        alerts.push({
          key: "twilio_balance_critical",
          severity: "critical",
          message: `Saldo Twilio criticamente baixo: ${raw} — ligações vão falhar.`,
          href: "/settings",
        });
      } else if (bal < 5) {
        alerts.push({
          key: "twilio_balance_low",
          severity: "warning",
          message: `Saldo Twilio baixo: ${raw} — considere recarregar.`,
          href: "/settings",
        });
      }
    }
  }

  // ElevenLabs char usage
  const el = providers.find((p) => p.key === "elevenlabs");
  if (el?.configured && el.ok && el.usage) {
    const pctStr = String(el.usage.percentual ?? "");
    const pct = parseFloat(pctStr.replace("%", ""));
    if (!Number.isNaN(pct)) {
      if (pct >= 95) {
        alerts.push({
          key: "el_usage_critical",
          severity: "critical",
          message: `ElevenLabs ${pct}% do plano usado — voz para quando bater 100%.`,
          href: "/settings",
        });
      } else if (pct >= 85) {
        alerts.push({
          key: "el_usage_warning",
          severity: "warning",
          message: `ElevenLabs ${pct}% do plano usado.`,
          href: "/settings",
        });
      }
    }
  }

  // Provider with failing ping
  for (const p of providers) {
    if (p.configured && p.ok === false) {
      alerts.push({
        key: `${p.key}_fail`,
        severity: "critical",
        message: `${p.key}: ${p.detail ?? "sem acesso"}`,
        href: "/settings",
      });
    }
  }

  return alerts;
}

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function persistDismissed(s: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(Array.from(s)));
  } catch {
    /* ignore */
  }
}
