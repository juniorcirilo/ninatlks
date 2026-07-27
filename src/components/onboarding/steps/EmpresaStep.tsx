import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INDUSTRY_OPTIONS,
  TIMEZONE_OPTIONS,
  type OnboardingState,
} from "@/lib/onboarding";

export interface EmpresaPayload {
  name: string;
  industry: string;
  timezone: string;
  support_email: string;
}

export function EmpresaStep({
  accountId,
  state,
  onPayloadChange,
}: {
  accountId: string;
  state: OnboardingState | null;
  onPayloadChange: (p: EmpresaPayload | null) => void;
}) {
  const saved = (state?.metadata?.empresa ?? {}) as Partial<EmpresaPayload>;
  const [name, setName] = useState(saved.name ?? "");
  const [industry, setIndustry] = useState(saved.industry ?? "outro");
  const [timezone, setTimezone] = useState(saved.timezone ?? "America/Sao_Paulo");
  const [supportEmail, setSupportEmail] = useState(saved.support_email ?? "");
  const [loading, setLoading] = useState(true);

  // Pre-fill from accounts row if not in metadata
  useEffect(() => {
    if (saved.name) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiClient
      .get<{ name: string; supportEmail: string; settings: Record<string, any> }>(`/accounts/${accountId}`)
      .then((data) => {
        if (cancelled || !data) {
          setLoading(false);
          return;
        }
        if (data.name) setName(data.name);
        if (data.supportEmail) setSupportEmail(data.supportEmail);
        const s = data.settings ?? {};
        if (s.industry) setIndustry(s.industry);
        if (s.timezone) setTimezone(s.timezone);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Bubble up the current values so the wizard's "Avançar" can persist them.
  useEffect(() => {
    if (!name.trim()) {
      onPayloadChange(null);
      return;
    }
    onPayloadChange({ name: name.trim(), industry, timezone, support_email: supportEmail.trim() });
  }, [name, industry, timezone, supportEmail, onPayloadChange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Sua empresa</h2>
        <p className="text-sm text-muted-foreground">
          Esses dados aparecem em mensagens enviadas pela IA e em relatórios.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="empresa-name">Nome da empresa *</Label>
          <Input
            id="empresa-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Clínica Vida Saudável"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="empresa-industry">Setor</Label>
            <Select value={industry} onValueChange={setIndustry}>
              <SelectTrigger id="empresa-industry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="empresa-tz">Fuso horário</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="empresa-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="empresa-email">E-mail de contato (opcional)</Label>
          <Input
            id="empresa-email"
            type="email"
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            placeholder="contato@suaempresa.com"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Side effect: write to accounts. Called by the wizard right before
 * advanceOnboardingStep("empresa", payload).
 */
export async function persistEmpresa(accountId: string, payload: EmpresaPayload) {
  const data = await apiClient.get<{ settings: Record<string, any> }>(`/accounts/${accountId}`);
  const settings = { ...(data.settings ?? {}) };
  settings.industry = payload.industry;
  settings.timezone = payload.timezone;
  await apiClient.patch(`/accounts/${accountId}`, {
    name: payload.name,
    supportEmail: payload.support_email || null,
    settings,
  });
}
